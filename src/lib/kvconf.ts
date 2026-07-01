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

export async function getSentToday(env: Env): Promise<number> {
  const v = await env.KV.get(todayKey());
  const n = v ? parseInt(v, 10) : 0;
  return Number.isNaN(n) ? 0 : n;
}

// KV has no atomic increment. The sequence engine is the only writer and runs
// single-threaded inside one cron invocation, so read-modify-write is safe in
// practice; the per-lead conditional UPDATE (idempotency claim) is the hard
// guard against double sends.
export async function incrementSentToday(env: Env): Promise<number> {
  const next = (await getSentToday(env)) + 1;
  await env.KV.put(todayKey(), String(next), { expirationTtl: 3 * 24 * 3600 });
  return next;
}
