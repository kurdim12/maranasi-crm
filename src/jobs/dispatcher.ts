import type { Env } from '../env';
import { logError } from '../lib/activity';
import { recordHeartbeat, reportJobFailure, reportJobSuccess } from '../lib/health';
import { runDailyRecap } from './recap';
import { runReplyWatcher } from './replyWatcher';
import { runScrape } from './sourcing';
import { runSequenceEngine } from './sequence';

/**
 * Single cron trigger (every 15 min); this dispatcher decides what runs.
 *
 *   every tick            -> Reply Watcher
 *   minute 0 and 30       -> Sequence Engine
 *   hour 1, minute 0 UTC  -> Sourcing (daily scrape)
 *   hour 3, minute 30 UTC -> Daily Recap (06:30 Amman)
 *
 * Every job records a heartbeat on success; 3 consecutive failures of the
 * same job trigger an owner alert email (deduped to one per 6h).
 */
export async function dispatch(env: Env, scheduledTime: number): Promise<void> {
  const invocationStart = Date.now();
  const d = new Date(scheduledTime);
  const hour = d.getUTCHours();
  // Cron fires on quarter hours; snap to the nearest one to be robust.
  const minute = Math.round(d.getUTCMinutes() / 15) * 15 % 60;

  await recordHeartbeat(env, 'tick');

  try {
    const w = await runReplyWatcher(env);
    console.log(`[cron] reply watcher: ${JSON.stringify(w)}`);
    await reportJobSuccess(env, 'watcher');
  } catch (err) {
    await logError(env.DB, 'cron reply watcher', err);
    await reportJobFailure(env, 'watcher', err);
  }

  if (minute === 0 || minute === 30) {
    try {
      const s = await runSequenceEngine(env);
      console.log(`[cron] sequence engine: ${JSON.stringify(s)}`);
      await reportJobSuccess(env, 'sequence');
    } catch (err) {
      await logError(env.DB, 'cron sequence engine', err);
      await reportJobFailure(env, 'sequence', err);
    }
  }

  if (hour === 1 && minute === 0) {
    try {
      // Budget from the invocation start, not the scrape start: the watcher
      // and sequence engine already used part of the 15-min scheduled limit.
      const r = await runScrape(env, 'cron', undefined, invocationStart + 13 * 60_000);
      console.log(`[cron] sourcing: ${JSON.stringify(r)}`);
      await reportJobSuccess(env, 'sourcing');
    } catch (err) {
      await logError(env.DB, 'cron sourcing', err);
      await reportJobFailure(env, 'sourcing', err);
    }
  }

  if (hour === 3 && minute === 30) {
    try {
      const r = await runDailyRecap(env);
      console.log(`[cron] daily recap: ${JSON.stringify(r)}`);
      await reportJobSuccess(env, 'recap');
    } catch (err) {
      await logError(env.DB, 'cron daily recap', err);
      await reportJobFailure(env, 'recap', err);
    }
  }
}
