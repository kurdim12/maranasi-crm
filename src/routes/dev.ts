import { Hono } from 'hono';
import type { Env, Lead } from '../env';
import { nowIso } from '../env';
import { executeTool } from '../agent/tools';
import { runDailyRecap } from '../jobs/recap';
import { checkBounceCircuitBreaker, runReplyWatcher } from '../jobs/replyWatcher';
import { runSequenceEngine } from '../jobs/sequence';
import { runScrape } from '../jobs/sourcing';

// Dev helpers (auth-gated like the rest of /api). These exist so the 72h
// sequence cadence and each cron job can be exercised without waiting.
export const dev = new Hono<{ Bindings: Env }>();

/** Rewind next_action_at into the past to simulate 72h elapsing. */
dev.post('/advance/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
  if (!lead) return c.json({ error: 'not found' }, 404);
  const past = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19);
  await c.env.DB.prepare('UPDATE leads SET next_action_at = ?, updated_at = ? WHERE id = ?')
    .bind(past, nowIso(), id)
    .run();
  return c.json({ ok: true, id, next_action_at: past });
});

/** Manually run one of the cron jobs. ?force_window=1 bypasses the send window (sequence only). */
dev.post('/run/:job', async (c) => {
  const job = c.req.param('job');
  switch (job) {
    case 'sequence': {
      const ignoreWindow = c.req.query('force_window') === '1';
      return c.json(await runSequenceEngine(c.env, { ignoreWindow }));
    }
    case 'watcher':
      return c.json(await runReplyWatcher(c.env));
    case 'sourcing':
      return c.json(await runScrape(c.env, 'manual'));
    case 'recap':
      return c.json(await runDailyRecap(c.env));
    case 'bounce-check':
      return c.json(await checkBounceCircuitBreaker(c.env));
    default:
      return c.json({ error: 'unknown job; use sequence | watcher | sourcing | recap | bounce-check' }, 400);
  }
});

/** Invoke a CRM-agent tool directly (testing the tool layer without the LLM). */
dev.post('/tool/:name', async (c) => {
  const name = c.req.param('name');
  const input = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await executeTool(c.env, name, input);
  return c.json({ tool: name, result });
});
