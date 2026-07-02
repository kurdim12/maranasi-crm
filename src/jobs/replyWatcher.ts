import type { Env, Lead } from '../env';
import { nowIso } from '../env';
import { logActivity, logError } from '../lib/activity';
import { llmText, parseJsonLoose } from '../lib/llm';
import {
  gmailConfigured,
  gmailGetMessage,
  gmailGetProfile,
  gmailListHistory,
  gmailListRecentInbox,
  sendOwnerEmail,
  type ParsedMessage,
} from '../lib/gmail';
import { isSendingPaused, setSendingPaused } from '../lib/kvconf';
import { ensureDealForInterested, triageForInbound } from '../lib/pipelineHooks';
import { transitionLead, type LeadStatus } from '../lib/stateMachine';
import { CLASSIFIER_PROMPT } from '../prompts/classifier';

export type ReplyClass = 'interested' | 'not_interested' | 'ooo' | 'bounce' | 'opt_out' | 'other';

const CURSOR_KEY = 'gmail:historyId';

// Deliverability circuit breaker: if the trailing-7-day bounce rate crosses
// this threshold (with a minimum send volume so one bounce can't trip it),
// sending auto-pauses and the owner is alerted. Resume is manual, from the
// dashboard, after investigating.
const BOUNCE_RATE_LIMIT = 0.03;
const BOUNCE_MIN_SENDS = 20;

export async function checkBounceCircuitBreaker(env: Env): Promise<{ tripped: boolean; rate: number; sent: number; bounces: number }> {
  const db = env.DB;
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const sent = (
    await db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE direction = 'out' AND dry_run = 0 AND created_at >= ?")
      .bind(since)
      .first<{ n: number }>()
  )?.n ?? 0;
  const bounces = (
    await db
      .prepare("SELECT COUNT(*) AS n FROM email_log WHERE direction = 'in' AND classification = 'bounce' AND created_at >= ?")
      .bind(since)
      .first<{ n: number }>()
  )?.n ?? 0;
  const rate = sent > 0 ? bounces / sent : 0;
  if (sent < BOUNCE_MIN_SENDS || rate <= BOUNCE_RATE_LIMIT) return { tripped: false, rate, sent, bounces };
  if (await isSendingPaused(env)) return { tripped: true, rate, sent, bounces }; // already paused

  await setSendingPaused(env, true);
  await logActivity(db, 'system', 'auto_paused_bounce_rate', null, {
    sent_7d: sent,
    bounces_7d: bounces,
    rate: Math.round(rate * 1000) / 10,
    threshold_pct: BOUNCE_RATE_LIMIT * 100,
  });
  await sendOwnerEmail(
    env,
    `⚠ Sending auto-paused: bounce rate ${(rate * 100).toFixed(1)}%`,
    `The trailing 7-day bounce rate hit ${(rate * 100).toFixed(1)}% (${bounces} bounces / ${sent} sends), above the ${BOUNCE_RATE_LIMIT * 100}% safety threshold.\n\nSending is now PAUSED. Before resuming from the dashboard:\n- check which domains bounced (Suppression tab, reason=bounce)\n- consider enabling the external verifier (VERIFIER_API_KEY)\n- re-verify the remaining queue\n\nResuming without fixing the list risks the sender domain's reputation.`,
  );
  return { tripped: true, rate, sent, bounces };
}

async function classifyReply(env: Env, subject: string, body: string): Promise<{ label: ReplyClass; summary: string }> {
  try {
    const raw = await llmText(
      env,
      'fast',
      CLASSIFIER_PROMPT,
      `Subject: ${subject}\n\nReply:\n${body.slice(0, 6000)}`,
      256,
    );
    if (raw === null) return { label: 'other', summary: 'classifier unavailable (no LLM provider configured)' };
    const parsed = parseJsonLoose<{ label: string; confidence: number; summary: string }>(raw);
    const valid: ReplyClass[] = ['interested', 'not_interested', 'ooo', 'bounce', 'opt_out', 'other'];
    if (parsed && valid.includes(parsed.label as ReplyClass)) {
      return { label: parsed.label as ReplyClass, summary: parsed.summary ?? '' };
    }
    return { label: 'other', summary: 'classifier returned unparseable output' };
  } catch (err) {
    await logError(env.DB, 'classify reply', err);
    return { label: 'other', summary: 'classifier error' };
  }
}

async function addSuppression(db: D1Database, email: string, reason: string): Promise<void> {
  const domain = email.split('@')[1] ?? null;
  await db
    .prepare('INSERT INTO suppression (email, domain, reason) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING')
    .bind(email.toLowerCase(), domain, reason)
    .run();
}

async function matchLead(db: D1Database, msg: ParsedMessage): Promise<Lead | null> {
  // 1) by thread id
  const byThread = await db
    .prepare('SELECT lead_id FROM email_log WHERE gmail_thread_id = ? ORDER BY id DESC LIMIT 1')
    .bind(msg.threadId)
    .first<{ lead_id: number }>();
  if (byThread) {
    return db.prepare('SELECT * FROM leads WHERE id = ?').bind(byThread.lead_id).first<Lead>();
  }
  // 2) by sender email
  if (msg.fromEmail) {
    return db.prepare('SELECT * FROM leads WHERE email = ?').bind(msg.fromEmail).first<Lead>();
  }
  return null;
}

async function applyClassification(
  env: Env,
  lead: Lead,
  cls: { label: ReplyClass; summary: string },
  msg: ParsedMessage,
): Promise<void> {
  const db = env.DB;
  const status = lead.status as LeadStatus;

  switch (cls.label) {
    case 'interested': {
      if (status !== 'interested') {
        await transitionLead(db, lead, 'interested', {
          actor: 'system',
          set: { next_action_at: null },
          detail: { via: 'reply', summary: cls.summary },
        });
      }
      // Post-reply loop: an interested lead always has an open deal + a task.
      await ensureDealForInterested(db, lead).catch((e) => console.error('[deal hook]', e));
      // Immediate owner notification — this is owner-facing, sends for real.
      const notified = await sendOwnerEmail(
        env,
        `\u{1F525} Reply from ${lead.company_name} (${lead.city ?? 'unknown city'})`,
        `Lead #${lead.id} ${lead.company_name} replied and looks interested.\n\nFrom: ${msg.fromEmail}\nSubject: ${msg.subject}\n\n--- reply ---\n${msg.bodyText.slice(0, 4000)}`,
      );
      await logActivity(db, 'system', 'owner_notified', lead.id, { sent: notified, kind: 'interested_reply' });
      break;
    }
    case 'not_interested': {
      if (status !== 'not_interested') {
        await transitionLead(db, lead, 'not_interested', {
          actor: 'system',
          set: { next_action_at: null },
          detail: { via: 'reply', summary: cls.summary },
        });
      }
      if (lead.email) await addSuppression(db, lead.email, 'not_interested');
      break;
    }
    case 'opt_out': {
      if (status !== 'opted_out') {
        await transitionLead(db, lead, 'opted_out', {
          actor: 'system',
          set: { next_action_at: null },
          detail: { via: 'reply', summary: cls.summary },
        });
      }
      if (lead.email) await addSuppression(db, lead.email, 'opt_out');
      break;
    }
    case 'ooo': {
      // Not a real reply: keep status, push the next step out by 5 days.
      const base = lead.next_action_at ? new Date(lead.next_action_at.replace(' ', 'T') + 'Z') : new Date();
      const pushed = new Date(base.getTime() + 5 * 24 * 3600 * 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
      await db
        .prepare('UPDATE leads SET next_action_at = ?, updated_at = ? WHERE id = ?')
        .bind(pushed, nowIso(), lead.id)
        .run();
      await logActivity(db, 'system', 'sequence_delayed', lead.id, { reason: 'ooo reply', next_action_at: pushed });
      break;
    }
    case 'bounce': {
      if (status !== 'invalid_email') {
        await transitionLead(db, lead, 'invalid_email', {
          actor: 'system',
          set: { email_status: 'bounced', next_action_at: null },
          detail: { via: 'bounce', summary: cls.summary },
        });
      }
      if (lead.email) await addSuppression(db, lead.email, 'bounce');
      await checkBounceCircuitBreaker(env);
      break;
    }
    case 'other': {
      // Store for owner review; pause the sequence.
      await db
        .prepare('UPDATE leads SET needs_call = 0, next_action_at = NULL, updated_at = ? WHERE id = ?')
        .bind(nowIso(), lead.id)
        .run();
      await logActivity(db, 'system', 'reply_needs_review', lead.id, { summary: cls.summary });
      break;
    }
  }
}

export interface WatcherStats {
  processed: number;
  matched: number;
  skipped: number;
}

export async function runReplyWatcher(env: Env): Promise<WatcherStats> {
  const db = env.DB;
  const stats: WatcherStats = { processed: 0, matched: 0, skipped: 0 };
  if (!gmailConfigured(env)) {
    console.log('[watcher] gmail not configured, skipping');
    return stats;
  }

  let messageIds: string[] = [];
  let newCursor: string | null = null;
  const cursor = await env.KV.get(CURSOR_KEY);

  if (!cursor) {
    // First run (or cursor wiped): seed the cursor and scan recent inbox once.
    const profile = await gmailGetProfile(env);
    newCursor = profile.historyId;
    messageIds = await gmailListRecentInbox(env);
  } else {
    const hist = await gmailListHistory(env, cursor);
    if (hist.invalidCursor) {
      // Cursor loss fallback: recent-inbox scan, dedupe via email_log.
      const profile = await gmailGetProfile(env);
      newCursor = profile.historyId;
      messageIds = await gmailListRecentInbox(env);
      await logActivity(db, 'system', 'gmail_cursor_reset', null, { old: cursor });
    } else {
      messageIds = hist.messageIds;
      newCursor = hist.historyId ?? cursor;
    }
  }

  const senderEmail = env.SENDER_EMAIL?.toLowerCase();
  let failures = 0;

  for (const id of messageIds) {
    try {
      // Dedupe against already-processed messages.
      const seen = await db.prepare('SELECT id FROM email_log WHERE gmail_message_id = ?').bind(id).first();
      if (seen) {
        stats.skipped++;
        continue;
      }
      const msg = await gmailGetMessage(env, id);
      if (msg.labelIds.includes('SENT') || msg.labelIds.includes('DRAFT')) {
        stats.skipped++;
        continue;
      }
      if (senderEmail && msg.fromEmail === senderEmail) {
        stats.skipped++;
        continue;
      }
      const lead = await matchLead(db, msg);
      if (!lead) {
        stats.skipped++; // unmatched -> skip
        continue;
      }

      const cls = await classifyReply(env, msg.subject, msg.bodyText);

      // Record the reply FIRST — this row is both the audit record and the
      // dedupe key, so a failing side effect can never lose the reply.
      await db
        .prepare(
          `INSERT INTO email_log (lead_id, direction, subject, body, gmail_message_id, gmail_thread_id, classification, dry_run, triage)
           VALUES (?, 'in', ?, ?, ?, ?, ?, 0, ?)`,
        )
        .bind(lead.id, msg.subject, msg.bodyText.slice(0, 20000), msg.id, msg.threadId, cls.label, triageForInbound(cls.label))
        .run();
      await logActivity(db, 'system', 'reply_received', lead.id, {
        classification: cls.label,
        summary: cls.summary,
        gmail_message_id: msg.id,
      });

      try {
        await applyClassification(env, lead, cls, msg);
      } catch (err) {
        // The reply is already recorded (deduped); surface the failed effect
        // for owner review instead of dropping the message.
        await logError(db, `apply classification lead ${lead.id} msg ${id}`, err);
        await logActivity(db, 'system', 'reply_effect_failed', lead.id, {
          classification: cls.label,
          gmail_message_id: id,
          error: String(err),
        });
      }
      stats.processed++;
      stats.matched++;
    } catch (err) {
      failures++;
      await logError(db, `watcher message ${id}`, err);
    }
  }

  // Cursor policy: advance only when every message was either processed or
  // deliberately skipped. On transient failures hold the cursor so the batch
  // is re-listed next tick (already-processed messages dedupe via email_log).
  // A poison message can't stall forever: after 3 held runs, advance and log.
  const STALL_KEY = 'gmail:cursorStall';
  if (newCursor) {
    if (failures === 0) {
      await env.KV.put(CURSOR_KEY, newCursor);
      await env.KV.delete(STALL_KEY);
    } else {
      const stall = parseInt((await env.KV.get(STALL_KEY)) ?? '0', 10) + 1;
      if (stall >= 3) {
        await env.KV.put(CURSOR_KEY, newCursor);
        await env.KV.delete(STALL_KEY);
        await logActivity(db, 'system', 'watcher_cursor_forced', null, {
          failures,
          note: 'cursor advanced past repeatedly-failing messages after 3 stalled runs',
        });
      } else {
        await env.KV.put(STALL_KEY, String(stall), { expirationTtl: 24 * 3600 });
        await logActivity(db, 'system', 'watcher_cursor_held', null, { failures, stall });
      }
    }
  }
  return stats;
}
