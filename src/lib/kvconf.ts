import type { Env } from '../env';

// KV keys:
//   sent:{YYYY-MM-DD}      daily send counter
//   gmail:historyId        inbox cursor for the reply watcher
//   config:sending_paused  kill switch ("true" pauses all sending)
//   config:daily_cap       overrides env DAILY_SEND_CAP when set

export function todayKey(d = new Date()): string {
  return `sent:${d.toISOString().slice(0, 10)}`;
}

export async function isSendingPaused(env: Env): Promise<boolean> {
  return (await env.KV.get('config:sending_paused')) === 'true';
}

export async function setSendingPaused(env: Env, paused: boolean): Promise<void> {
  await env.KV.put('config:sending_paused', paused ? 'true' : 'false');
}

export async function getDailyCap(env: Env): Promise<number> {
  const override = await env.KV.get('config:daily_cap');
  const fromKv = override ? parseInt(override, 10) : NaN;
  if (!Number.isNaN(fromKv) && fromKv >= 0) return fromKv;
  const fromEnv = parseInt(env.DAILY_SEND_CAP || '20', 10);
  return Number.isNaN(fromEnv) ? 20 : fromEnv;
}

/**
 * Sends so far today (UTC). KV alone is a non-atomic read-modify-write and is
 * eventually consistent across colos, so the cap check is backed by a D1
 * count of today's outbound email_log rows (D1 writes are serialized) — the
 * max of the two can under-count only if BOTH mechanisms missed a send.
 */
export async function getSentToday(env: Env): Promise<number> {
  const v = await env.KV.get(todayKey());
  const kvCount = v ? parseInt(v, 10) || 0 : 0;
  const today = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM email_log WHERE direction = 'out' AND created_at >= ?",
  )
    .bind(`${today} 00:00:00`)
    .first<{ n: number }>();
  return Math.max(kvCount, row?.n ?? 0);
}

// The per-lead conditional UPDATE (idempotency claim) is the hard guard
// against double sends; this counter only feeds the cap check and reporting.
export async function incrementSentToday(env: Env): Promise<number> {
  const next = (await getSentToday(env)) + 1;
  await env.KV.put(todayKey(), String(next), { expirationTtl: 3 * 24 * 3600 });
  return next;
}
