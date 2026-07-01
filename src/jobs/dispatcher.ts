import type { Env } from '../env';
import { logError } from '../lib/activity';
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
 */
export async function dispatch(env: Env, scheduledTime: number): Promise<void> {
  const d = new Date(scheduledTime);
  const hour = d.getUTCHours();
  // Cron fires on quarter hours; snap to the nearest one to be robust.
  const minute = Math.round(d.getUTCMinutes() / 15) * 15 % 60;

  try {
    const w = await runReplyWatcher(env);
    console.log(`[cron] reply watcher: ${JSON.stringify(w)}`);
  } catch (err) {
    await logError(env.DB, 'cron reply watcher', err);
  }

  if (minute === 0 || minute === 30) {
    try {
      const s = await runSequenceEngine(env);
      console.log(`[cron] sequence engine: ${JSON.stringify(s)}`);
    } catch (err) {
      await logError(env.DB, 'cron sequence engine', err);
    }
  }

  if (hour === 1 && minute === 0) {
    try {
      const r = await runScrape(env, 'cron');
      console.log(`[cron] sourcing: ${JSON.stringify(r)}`);
    } catch (err) {
      await logError(env.DB, 'cron sourcing', err);
    }
  }

  if (hour === 3 && minute === 30) {
    try {
      const r = await runDailyRecap(env);
      console.log(`[cron] daily recap: ${JSON.stringify(r)}`);
    } catch (err) {
      await logError(env.DB, 'cron daily recap', err);
    }
  }
}
