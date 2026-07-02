// Cron job health: heartbeats, consecutive-failure tracking, and owner
// alerting. Heartbeats live in KV (health:{job} = ISO timestamp of the last
// successful run); failures are counted per job and an alert email goes out
// after 3 consecutive failures (deduped to one alert per 6h per job).
import type { Env } from '../env';
import { logActivity } from './activity';
import { sendOwnerEmail } from './gmail';

export const JOBS = ['tick', 'watcher', 'sequence', 'sourcing', 'recap'] as const;
export type Job = (typeof JOBS)[number];

const FAILURE_ALERT_THRESHOLD = 3;
const ALERT_DEDUPE_TTL = 6 * 3600;

export async function recordHeartbeat(env: Env, job: Job): Promise<void> {
  await env.KV.put(`health:${job}`, new Date().toISOString());
}

export async function reportJobSuccess(env: Env, job: Job): Promise<void> {
  await recordHeartbeat(env, job);
  await env.KV.delete(`errstreak:${job}`);
}

export async function reportJobFailure(env: Env, job: Job, err: unknown): Promise<void> {
  const key = `errstreak:${job}`;
  const streak = parseInt((await env.KV.get(key)) ?? '0', 10) + 1;
  await env.KV.put(key, String(streak), { expirationTtl: 24 * 3600 });
  if (streak < FAILURE_ALERT_THRESHOLD) return;

  const dedupeKey = `alerted:${job}`;
  if (await env.KV.get(dedupeKey)) return; // already alerted recently
  await env.KV.put(dedupeKey, '1', { expirationTtl: ALERT_DEDUPE_TTL });
  await logActivity(env.DB, 'system', 'job_failure_alert', null, { job, consecutive_failures: streak });
  await sendOwnerEmail(
    env,
    `⚠ Outreach engine: ${job} has failed ${streak} times in a row`,
    `The '${job}' cron job has now failed ${streak} consecutive times.\n\nLatest error:\n${String(err).slice(0, 1500)}\n\nCheck the Activity tab on the dashboard (action = 'error') for the full trail. This alert repeats at most once every 6 hours.`,
  );
}

export interface HealthSnapshot {
  jobs: Record<string, string | null>;
  errors_24h: number;
}

export async function getHealth(env: Env): Promise<HealthSnapshot> {
  const jobs: Record<string, string | null> = {};
  for (const job of JOBS) {
    jobs[job] = await env.KV.get(`health:${job}`);
  }
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const errors = await env.DB.prepare("SELECT COUNT(*) AS n FROM activities WHERE action = 'error' AND created_at >= ?")
    .bind(since)
    .first<{ n: number }>();
  return { jobs, errors_24h: errors?.n ?? 0 };
}
