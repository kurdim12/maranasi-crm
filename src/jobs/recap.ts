import type { Env } from '../env';
import { logActivity, logError } from '../lib/activity';
import { claudeClient, MODEL_AGENT, parseJsonLoose, textOf } from '../lib/anthropic';
import { sendOwnerEmail } from '../lib/gmail';
import { getDailyCap, getSentToday } from '../lib/kvconf';
import { RECAP_PROMPT } from '../prompts/recap';

interface RecapData {
  date: string;
  new_leads_by_city: Record<string, number>;
  verified_count: number;
  sent_by_step: Record<string, number>;
  replies_by_classification: Record<string, number>;
  interested_leads: unknown[];
  bounces: number;
  needs_call: unknown[];
  drops: unknown[];
  cap_usage: string;
  scrape_runs: unknown[];
  errors: unknown[];
}

async function gatherRecapData(env: Env): Promise<RecapData> {
  const db = env.DB;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  const newByCity = await db
    .prepare(
      `SELECT COALESCE(city, 'unknown') AS city, COUNT(*) AS n FROM leads WHERE created_at >= ? GROUP BY city`,
    )
    .bind(since)
    .all<{ city: string; n: number }>();

  const verified = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM activities WHERE action = 'status_change' AND created_at >= ?
       AND detail LIKE '%"to":"verified"%'`,
    )
    .bind(since)
    .first<{ n: number }>();

  const sentByStep = await db
    .prepare(
      `SELECT sequence_step AS step, COUNT(*) AS n FROM email_log
       WHERE direction = 'out' AND created_at >= ? GROUP BY sequence_step`,
    )
    .bind(since)
    .all<{ step: number; n: number }>();

  const replies = await db
    .prepare(
      `SELECT COALESCE(classification, 'other') AS c, COUNT(*) AS n FROM email_log
       WHERE direction = 'in' AND created_at >= ? GROUP BY classification`,
    )
    .bind(since)
    .all<{ c: string; n: number }>();

  const interested = await db
    .prepare(
      `SELECT id, company_name, contact_name, email, phone, city, country, website FROM leads
       WHERE status = 'interested' AND updated_at >= ?`,
    )
    .bind(since)
    .all();

  const needsCall = await db
    .prepare(`SELECT id, company_name, phone, city, country FROM leads WHERE needs_call = 1`)
    .all();

  const drops = await db
    .prepare(`SELECT id, company_name, drop_reason FROM leads WHERE status = 'dropped' AND updated_at >= ?`)
    .bind(since)
    .all();

  const runs = await db
    .prepare(
      `SELECT id, trigger, queries_run, places_found, new_leads, skipped_dupes, status, error
       FROM scrape_runs WHERE started_at >= ?`,
    )
    .bind(since)
    .all();

  const errors = await db
    .prepare(`SELECT action, detail, created_at FROM activities WHERE action = 'error' AND created_at >= ? LIMIT 20`)
    .bind(since)
    .all();

  const bounces = replies.results.find((r) => r.c === 'bounce')?.n ?? 0;
  const sentToday = await getSentToday(env);
  const cap = await getDailyCap(env);

  return {
    date: new Date().toISOString().slice(0, 10),
    new_leads_by_city: Object.fromEntries(newByCity.results.map((r) => [r.city, r.n])),
    verified_count: verified?.n ?? 0,
    sent_by_step: Object.fromEntries(sentByStep.results.map((r) => [`step_${r.step}`, r.n])),
    replies_by_classification: Object.fromEntries(replies.results.map((r) => [r.c, r.n])),
    interested_leads: interested.results,
    bounces,
    needs_call: needsCall.results,
    drops: drops.results,
    cap_usage: `${sentToday}/${cap}`,
    scrape_runs: runs.results,
    errors: errors.results,
  };
}

/** Deterministic fallback when the Claude API is unavailable. */
function plainRecap(data: RecapData): { subject: string; body: string } {
  const sent = Object.values(data.sent_by_step).reduce((a, b) => a + b, 0);
  const replies = Object.values(data.replies_by_classification).reduce((a, b) => a + b, 0);
  const interested = data.interested_leads.length;
  const lines = [
    `INTERESTED (${interested}):`,
    data.interested_leads.length ? JSON.stringify(data.interested_leads, null, 1) : 'None.',
    '',
    `Pipeline: new=${JSON.stringify(data.new_leads_by_city)} verified=${data.verified_count} sent=${JSON.stringify(data.sent_by_step)} replies=${JSON.stringify(data.replies_by_classification)}`,
    '',
    `Needs call (${data.needs_call.length}):`,
    data.needs_call.length ? JSON.stringify(data.needs_call, null, 1) : 'None.',
    '',
    `Drops: ${data.drops.length ? JSON.stringify(data.drops) : 'None.'}`,
    `Errors: ${data.errors.length ? JSON.stringify(data.errors) : 'None.'}`,
    `Cap usage: ${data.cap_usage}`,
    `Scrape runs: ${data.scrape_runs.length ? JSON.stringify(data.scrape_runs) : 'None.'}`,
  ];
  return {
    subject: `Outreach recap — ${data.date}: ${sent} sent, ${replies} replies, ${interested} interested`,
    body: lines.join('\n'),
  };
}

export async function runDailyRecap(env: Env): Promise<{ sent: boolean }> {
  const db = env.DB;
  try {
    const data = await gatherRecapData(env);
    let email = plainRecap(data);

    const client = claudeClient(env);
    if (client) {
      try {
        const msg = await client.messages.create({
          model: MODEL_AGENT,
          max_tokens: 1024,
          system: RECAP_PROMPT,
          messages: [{ role: 'user', content: JSON.stringify(data) }],
        });
        const parsed = parseJsonLoose<{ subject: string; body: string }>(textOf(msg));
        if (parsed?.subject && parsed?.body) email = parsed;
      } catch (err) {
        await logError(db, 'recap writer', err);
      }
    }

    // Recap always sends for real, even in DRY_RUN (no lead-facing content).
    const sent = await sendOwnerEmail(env, email.subject, email.body);
    await logActivity(db, 'system', 'recap_sent', null, { sent, date: data.date });
    return { sent };
  } catch (err) {
    await logError(db, 'daily recap', err);
    return { sent: false };
  }
}
