import type { Env, Lead } from '../env';
import { isDryRun, isoPlus, nowIso } from '../env';
import { logActivity, logError } from '../lib/activity';
import { llmText, parseJsonLoose } from '../lib/llm';
import { GmailSendError, gmailConfigured, gmailSend, gmailThreadReplyHeaders } from '../lib/gmail';
import { getDailyCap, getSentToday, incrementSentToday, isSendingPaused } from '../lib/kvconf';
import { createCallTask } from '../lib/pipelineHooks';
import { assertTransition, type LeadStatus } from '../lib/stateMachine';
import { isWithinSendWindow } from '../lib/time';
import { PERSONALIZER_PROMPT } from '../prompts/personalizer';

interface TemplateRow {
  id: number;
  name: string;
  sequence_step: number;
  subject_template: string;
  body_template: string;
}

export interface SequenceStats {
  sent: number;
  exhausted: number;
  skipped: { window: number; cap: number; other: number };
  paused: boolean;
}

function fillTemplate(tpl: string, lead: Lead, env: Env): string {
  const values: Record<string, string> = {
    company_name: lead.company_name ?? '',
    city: lead.city ?? 'your city',
    category: lead.category ?? 'events',
    contact_name: lead.contact_name || 'there',
    sender_name: env.SENDER_NAME ?? 'Maranasi Events',
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? '');
}

/**
 * Personalize with Haiku; on any failure fall back to a plain placeholder
 * fill (the template is owner-approved copy, so the fallback is always safe).
 */
async function personalize(
  env: Env,
  lead: Lead,
  template: TemplateRow,
): Promise<{ subject: string; body: string; personalized: boolean }> {
  const fallback = {
    subject: fillTemplate(template.subject_template, lead, env),
    body: fillTemplate(template.body_template, lead, env),
    personalized: false,
  };
  try {
    // The P4 brief gives the personalizer a text-grounded hook to work with.
    let brief: Record<string, unknown> | null = null;
    try {
      brief = lead.brief ? (JSON.parse(lead.brief) as Record<string, unknown>) : null;
    } catch {
      brief = null;
    }
    const raw = await llmText(
      env,
      'fast',
      PERSONALIZER_PROMPT,
      JSON.stringify({
        template: { subject: fallback.subject, body: fallback.body },
        lead: {
          company_name: lead.company_name,
          city: lead.city,
          country: lead.country,
          category: lead.category,
          contact_name: lead.contact_name,
          website: lead.website,
        },
        ...(brief
          ? {
              company_brief: {
                what_they_do: brief.what_they_do,
                event_types: brief.event_types,
                hook_angle: brief.hook_angle,
              },
            }
          : {}),
      }),
      1024,
    );
    if (raw === null) return fallback; // no LLM provider configured
    const parsed = parseJsonLoose<{ subject: string; body: string }>(raw);
    if (parsed?.subject && parsed?.body) {
      return { subject: parsed.subject, body: parsed.body, personalized: true };
    }
    return fallback;
  } catch (err) {
    await logError(env.DB, `personalize lead ${lead.id}`, err);
    return fallback;
  }
}

/**
 * Preview what the sequence engine would send next for a lead — same template
 * lookup and personalization, but no claim, no send, no logging.
 */
export async function previewNextEmail(
  env: Env,
  lead: Lead,
): Promise<{ ok: true; step: number; subject: string; body: string; personalized: boolean } | { ok: false; reason: string }> {
  if (!['verified', 'contacted'].includes(lead.status)) {
    return { ok: false, reason: `lead status is '${lead.status}' — only verified/contacted leads are in the sequence` };
  }
  if (lead.sequence_step >= 3) return { ok: false, reason: 'sequence already completed (3/3 sent)' };
  const step = lead.sequence_step + 1;
  const template = await env.DB.prepare(
    'SELECT * FROM templates WHERE sequence_step = ? AND active = 1 ORDER BY id LIMIT 1',
  )
    .bind(step)
    .first<TemplateRow>();
  if (!template) return { ok: false, reason: `no active template for step ${step}` };
  const content = await personalize(env, lead, template);
  return { ok: true, step, subject: content.subject, body: content.body, personalized: content.personalized };
}

/**
 * A/B variant pick for a step template. The base row is implicitly variant
 * 'A'; template_variants rows (active=1) compete with it at equal odds.
 */
export async function pickVariant(
  db: D1Database,
  base: TemplateRow,
): Promise<{ template: TemplateRow; variantLabel: string }> {
  const variants = await db
    .prepare('SELECT * FROM template_variants WHERE template_id = ? AND active = 1 ORDER BY id')
    .bind(base.id)
    .all<{ id: number; label: string; subject_template: string; body_template: string }>();
  if (!variants.results.length) return { template: base, variantLabel: 'A' };
  const pool = [
    { label: 'A', subject: base.subject_template, body: base.body_template },
    ...variants.results.map((v) => ({ label: v.label, subject: v.subject_template, body: v.body_template })),
  ];
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return {
    template: { ...base, subject_template: pick.subject, body_template: pick.body },
    variantLabel: pick.label,
  };
}

/** Flag leads whose 3-step sequence ran dry: NEVER dropped, only flagged. */
async function flagExhaustedLeads(env: Env): Promise<number> {
  const db = env.DB;
  const now = nowIso();
  const rows = await db
    .prepare(
      `SELECT * FROM leads WHERE status = 'contacted' AND sequence_step >= 3
       AND next_action_at IS NOT NULL AND next_action_at <= ? AND source != 'demo'`,
    )
    .bind(now)
    .all<Lead>();
  let count = 0;
  for (const lead of rows.results) {
    assertTransition(lead.status as LeadStatus, 'unresponsive_email');
    const res = await db
      .prepare(
        `UPDATE leads SET status = 'unresponsive_email', needs_call = 1,
         next_action_at = NULL, updated_at = ? WHERE id = ? AND status = 'contacted'`,
      )
      .bind(now, lead.id)
      .run();
    if (!res.meta.changes) continue; // status moved on (e.g. a reply landed) — nothing happened, log nothing
    await logActivity(db, 'system', 'email_sequence_exhausted', lead.id, {
      from: 'contacted',
      to: 'unresponsive_email',
      needs_call: 1,
    });
    await createCallTask(db, lead).catch((e) => console.error('[call task hook]', e));
    count++;
  }
  return count;
}

export interface SequenceOptions {
  /** dev-only: skip the send-window check so the flow can be tested any time */
  ignoreWindow?: boolean;
}

export async function runSequenceEngine(env: Env, opts: SequenceOptions = {}): Promise<SequenceStats> {
  const db = env.DB;
  const stats: SequenceStats = { sent: 0, exhausted: 0, skipped: { window: 0, cap: 0, other: 0 }, paused: false };

  stats.exhausted = await flagExhaustedLeads(env);

  // Guardrail 2: kill switch.
  if (await isSendingPaused(env)) {
    stats.paused = true;
    console.log('[sequence] sending paused via kill switch, skipping');
    return stats;
  }

  const now = nowIso();
  // Guardrail 1: eligibility (verified email, inside sequence, due, not suppressed).
  const eligible = await db
    .prepare(
      `SELECT l.* FROM leads l
       WHERE l.status IN ('verified','contacted')
         AND l.sequence_step < 3
         AND l.email_status = 'verified'
         AND l.email IS NOT NULL
         AND l.next_action_at IS NOT NULL AND l.next_action_at <= ?
         AND l.email NOT IN (SELECT email FROM suppression)
         AND l.source != 'demo'
       ORDER BY COALESCE(l.fit_score, 0) DESC, l.next_action_at ASC
       LIMIT 50`,
    )
    .bind(now)
    .all<Lead>();

  const dryRun = isDryRun(env);
  const cap = await getDailyCap(env);

  for (const lead of eligible.results) {
    try {
      // Guardrail 3: send window (Mon-Fri, 09:00-16:30 lead-local).
      if (!opts.ignoreWindow && !isWithinSendWindow(lead.timezone)) {
        stats.skipped.window++;
        continue;
      }

      // Guardrail 4: daily cap (KV override wins over env).
      const sentToday = await getSentToday(env);
      if (sentToday >= cap) {
        stats.skipped.cap++;
        await logActivity(db, 'system', 'send_skipped', lead.id, { reason: 'daily cap reached', cap });
        break; // no point iterating further this tick
      }

      const step = lead.sequence_step + 1;
      const baseTemplate = await db
        .prepare('SELECT * FROM templates WHERE sequence_step = ? AND active = 1 ORDER BY id LIMIT 1')
        .bind(step)
        .first<TemplateRow>();
      if (!baseTemplate) {
        stats.skipped.other++;
        await logActivity(db, 'system', 'send_skipped', lead.id, { reason: `no active template for step ${step}` });
        continue;
      }
      // A/B: the base template is variant 'A'; active rows in template_variants
      // are challengers. Pick uniformly at random, stamp the label on the log.
      const { template, variantLabel } = await pickVariant(db, baseTemplate);

      if (!dryRun && !gmailConfigured(env)) {
        stats.skipped.other++;
        await logActivity(db, 'system', 'send_skipped', lead.id, { reason: 'gmail not configured' });
        break;
      }

      // Threading context for steps 2-3: reply within the step-1 thread.
      let threadId: string | undefined;
      let replySubject: string | undefined;
      if (step > 1) {
        // Real threads only: dry-run rows carry synthetic thread ids that
        // Gmail would reject after go-live. When DRY_RUN itself is on, thread
        // continuity within the dry run is simulated below instead.
        const prevOut = await db
          .prepare(
            `SELECT gmail_thread_id, subject FROM email_log
             WHERE lead_id = ? AND direction = 'out' AND dry_run = ?
             ORDER BY id DESC LIMIT 1`,
          )
          .bind(lead.id, dryRun ? 1 : 0)
          .first<{ gmail_thread_id: string | null; subject: string | null }>();
        threadId = prevOut?.gmail_thread_id ?? undefined;
        if (prevOut?.subject) {
          replySubject = prevOut.subject.startsWith('Re:') ? prevOut.subject : `Re: ${prevOut.subject}`;
        }
      }

      const content = await personalize(env, lead, template);
      const subject = step > 1 && replySubject ? replySubject : content.subject;

      // Guardrail 5: idempotency claim FIRST. If another tick already advanced
      // this lead — or a reply moved it out of the sequence (opted_out,
      // interested, ...) since the eligibility SELECT — changes = 0 and we skip.
      const nextActionAt = isoPlus(72);
      const sentAt = nowIso();
      assertTransition(lead.status as LeadStatus, 'contacted'); // state machine check
      const claim = await db
        .prepare(
          `UPDATE leads SET sequence_step = sequence_step + 1, status = 'contacted',
           last_contacted_at = ?, next_action_at = ?, updated_at = ?
           WHERE id = ? AND sequence_step = ? AND status IN ('verified','contacted')`,
        )
        .bind(sentAt, nextActionAt, sentAt, lead.id, lead.sequence_step)
        .run();
      if (!claim.meta.changes) {
        stats.skipped.other++;
        continue;
      }

      let gmailMessageId: string | null = null;
      let gmailThreadId: string | null = null;
      if (dryRun) {
        gmailThreadId = threadId ?? `dryrun-thread-${lead.id}`;
        gmailMessageId = `dryrun-${lead.id}-step${step}`;
        console.log(`[DRY_RUN] would send step ${step} to ${lead.email} | subject: ${subject}`);
      } else {
        try {
          const replyHeaders = threadId ? await gmailThreadReplyHeaders(env, threadId) : {};
          const sent = await gmailSend(env, {
            to: lead.email!,
            subject,
            body: content.body,
            threadId,
            listUnsubscribe: true,
            ...replyHeaders,
          });
          gmailMessageId = sent.id;
          gmailThreadId = sent.threadId;
        } catch (err) {
          if (err instanceof GmailSendError && err.ambiguous) {
            // Gmail may have accepted the message (5xx / network drop after
            // the request left). Reverting would risk a duplicate send, which
            // is worse than a possibly-skipped step — keep the claim, record
            // what was (maybe) sent, and flag it for the owner.
            await db
              .prepare(
                `INSERT INTO email_log (lead_id, direction, sequence_step, subject, body, gmail_message_id, gmail_thread_id, dry_run, variant_label)
                 VALUES (?, 'out', ?, ?, ?, NULL, NULL, 0, ?)`,
              )
              .bind(lead.id, step, subject, content.body, variantLabel)
              .run();
            await logActivity(db, 'system', 'send_uncertain', lead.id, {
              step,
              error: err.message,
              note: 'gmail returned an ambiguous error; claim kept to avoid a duplicate send',
            });
            stats.sent++; // counts against the cap: it may have gone out
            await incrementSentToday(env);
            continue;
          }
          // Unambiguous failure (4xx, auth, thread lookup): nothing was sent.
          // Revert the claim so the lead retries — but only if the row is
          // still exactly as we claimed it (no concurrent transition).
          await db
            .prepare(
              `UPDATE leads SET sequence_step = ?, status = ?, last_contacted_at = ?,
               next_action_at = ?, updated_at = ?
               WHERE id = ? AND sequence_step = ? AND status = 'contacted'`,
            )
            .bind(
              lead.sequence_step,
              lead.status,
              lead.last_contacted_at,
              lead.next_action_at,
              nowIso(),
              lead.id,
              lead.sequence_step + 1,
            )
            .run();
          await logError(db, `send step ${step} lead ${lead.id}`, err);
          stats.skipped.other++;
          continue;
        }
      }

      await db
        .prepare(
          `INSERT INTO email_log (lead_id, direction, sequence_step, subject, body, gmail_message_id, gmail_thread_id, dry_run, variant_label)
           VALUES (?, 'out', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(lead.id, step, subject, content.body, gmailMessageId, gmailThreadId, dryRun ? 1 : 0)
        .run();

      await incrementSentToday(env);
      await logActivity(db, 'system', 'email_sent', lead.id, {
        step,
        dry_run: dryRun,
        personalized: content.personalized,
        from: lead.status,
        to: 'contacted',
        next_action_at: nextActionAt,
      });
      stats.sent++;
    } catch (err) {
      stats.skipped.other++;
      await logError(db, `sequence lead ${lead.id}`, err);
    }
  }

  return stats;
}
