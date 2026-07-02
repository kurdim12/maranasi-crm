import { Hono } from 'hono';
import type { Env, Lead } from '../env';
import { nowIso } from '../env';
import { runCrmAgent } from '../agent/loop';
import { markCallOutcome } from '../agent/tools';
import { logActivity } from '../lib/activity';
import { getDailyCap, getSentToday, isSendingPaused, setSendingPaused } from '../lib/kvconf';
import { verifyLead } from '../lib/verify';
import { runScrape } from '../jobs/sourcing';

const PATCH_WHITELIST = new Set([
  'contact_name',
  'phone',
  'phone_status',
  'notes',
  'city',
  'category',
  'confirmed',
]);

export const api = new Hono<{ Bindings: Env }>();

api.get('/leads', async (c) => {
  const { status, country, city, needs_call, q } = c.req.query();
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);
  const offset = parseInt(c.req.query('offset') ?? '0', 10) || 0;
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (status) {
    clauses.push('status = ?');
    binds.push(status);
  }
  if (country) {
    clauses.push('country = ?');
    binds.push(country);
  }
  if (city) {
    clauses.push('city LIKE ?');
    binds.push(`%${city}%`);
  }
  if (needs_call === '1' || needs_call === 'true') clauses.push('needs_call = 1');
  if (q) {
    clauses.push('(company_name LIKE ? OR notes LIKE ? OR email LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(
    `SELECT * FROM leads ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<Lead>();
  return c.json({ leads: rows.results });
});

api.get('/leads/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
  if (!lead) return c.json({ error: 'not found' }, 404);
  const emails = await c.env.DB.prepare('SELECT * FROM email_log WHERE lead_id = ? ORDER BY id DESC LIMIT 50')
    .bind(id)
    .all();
  const activities = await c.env.DB.prepare(
    'SELECT * FROM activities WHERE lead_id = ? ORDER BY id DESC LIMIT 50',
  )
    .bind(id)
    .all();
  return c.json({ lead, emails: emails.results, activities: activities.results });
});

api.patch('/leads/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
  if (!lead) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);
  const accepted = Object.entries(body).filter(([k]) => PATCH_WHITELIST.has(k));
  const rejected = Object.keys(body).filter((k) => !PATCH_WHITELIST.has(k));
  if (!accepted.length) {
    return c.json({ error: 'no whitelisted fields', rejected, whitelist: [...PATCH_WHITELIST] }, 400);
  }
  const sets = accepted.map(([k]) => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE leads SET ${sets}, updated_at = ? WHERE id = ?`)
    .bind(...accepted.map(([, v]) => v), nowIso(), id)
    .run();
  await logActivity(c.env.DB, 'owner', 'lead_updated', id, { fields: Object.fromEntries(accepted) });
  return c.json({ ok: true, updated: Object.fromEntries(accepted), rejected });
});

api.post('/leads/:id/verify', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
  if (!lead) return c.json({ error: 'not found' }, 404);
  const result = await verifyLead(c.env, c.env.DB, lead);
  return c.json(result);
});

api.post('/leads/:id/call-outcome', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = (await c.req.json().catch(() => ({}))) as { outcome?: string };
  if (body.outcome !== 'reached' && body.outcome !== 'unresponsive') {
    return c.json({ error: "outcome must be 'reached' or 'unresponsive'" }, 400);
  }
  const result = await markCallOutcome(c.env, id, body.outcome, 'owner');
  return c.json(result, 'error' in result ? 404 : 200);
});

api.post('/scrape/run', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { query_id?: number };
  // A full scrape can take minutes — far longer than a browser keeps the
  // request open. Run it detached so a client disconnect can't kill it
  // mid-run; progress lands in scrape_runs.
  c.executionCtx.waitUntil(runScrape(c.env, 'manual', body.query_id));
  return c.json({ ok: true, started: true, note: 'run started; watch GET /api/scrape/runs' }, 202);
});

api.get('/scrape/runs', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 20').all();
  return c.json({ runs: rows.results });
});

api.get('/stats', async (c) => {
  const db = c.env.DB;
  const byStatus = await db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all();
  const total = await db.prepare('SELECT COUNT(*) AS n FROM leads').first<{ n: number }>();
  const needsCall = await db.prepare('SELECT COUNT(*) AS n FROM leads WHERE needs_call = 1').first<{ n: number }>();
  const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const sent7 = await db
    .prepare("SELECT COUNT(*) AS n FROM email_log WHERE direction = 'out' AND created_at >= ?")
    .bind(since7)
    .first<{ n: number }>();
  const replies7 = await db
    .prepare("SELECT COUNT(*) AS n FROM email_log WHERE direction = 'in' AND created_at >= ?")
    .bind(since7)
    .first<{ n: number }>();
  return c.json({
    total: total?.n ?? 0,
    by_status: Object.fromEntries(byStatus.results.map((r) => [r.status as string, r.n])),
    needs_call: needsCall?.n ?? 0,
    sent_7d: sent7?.n ?? 0,
    replies_7d: replies7?.n ?? 0,
    sent_today: await getSentToday(c.env),
    daily_cap: await getDailyCap(c.env),
    sending_paused: await isSendingPaused(c.env),
    dry_run: c.env.DRY_RUN !== 'false',
  });
});

api.post('/sending/pause', async (c) => {
  await setSendingPaused(c.env, true);
  await logActivity(c.env.DB, 'owner', 'sending_paused', null);
  return c.json({ ok: true, sending_paused: true });
});

api.post('/sending/resume', async (c) => {
  await setSendingPaused(c.env, false);
  await logActivity(c.env.DB, 'owner', 'sending_resumed', null);
  return c.json({ ok: true, sending_paused: false });
});

api.post('/agent', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    message?: string;
    history?: unknown[];
  } | null;
  if (!body?.message) return c.json({ error: 'message required' }, 400);
  const result = await runCrmAgent(c.env, body.message, Array.isArray(body.history) ? body.history : []);
  return c.json(result);
});

// ---- templates (the owner must be able to replace placeholder copy) ----

api.get('/templates', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM templates ORDER BY sequence_step, id').all();
  return c.json({ templates: rows.results });
});

api.put('/templates/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const existing = await c.env.DB.prepare('SELECT id FROM templates WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'not found' }, 404);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);
  const whitelist = ['name', 'subject_template', 'body_template', 'active'];
  const accepted = Object.entries(body).filter(([k]) => whitelist.includes(k));
  if (!accepted.length) return c.json({ error: 'no editable fields', whitelist }, 400);
  const sets = accepted.map(([k]) => `${k} = ?`).join(', ');
  await c.env.DB.prepare(`UPDATE templates SET ${sets} WHERE id = ?`)
    .bind(...accepted.map(([, v]) => v), id)
    .run();
  await logActivity(c.env.DB, 'owner', 'template_updated', null, {
    template_id: id,
    fields: accepted.map(([k]) => k),
  });
  return c.json({ ok: true });
});

// ---- suppression list ----

api.get('/suppression', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM suppression ORDER BY created_at DESC LIMIT 500').all();
  return c.json({ suppression: rows.results });
});

api.post('/suppression', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: string };
  const email = (body.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return c.json({ error: 'valid email required' }, 400);
  await c.env.DB.prepare(
    "INSERT INTO suppression (email, domain, reason) VALUES (?, ?, 'manual') ON CONFLICT(email) DO NOTHING",
  )
    .bind(email, email.split('@')[1])
    .run();
  await logActivity(c.env.DB, 'owner', 'suppression_added', null, { email, reason: 'manual' });
  return c.json({ ok: true, email });
});

api.delete('/suppression/:email', async (c) => {
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();
  const row = await c.env.DB.prepare('SELECT reason FROM suppression WHERE email = ?')
    .bind(email)
    .first<{ reason: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (row.reason !== 'manual') {
    return c.json(
      { error: `only manual entries can be removed; this one is '${row.reason}' (opt-outs and bounces are permanent)` },
      403,
    );
  }
  await c.env.DB.prepare('DELETE FROM suppression WHERE email = ?').bind(email).run();
  await logActivity(c.env.DB, 'owner', 'suppression_removed', null, { email });
  return c.json({ ok: true });
});

// ---- recent activity feed ----

api.get('/activities', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 300);
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.actor, a.action, a.lead_id, a.detail, a.created_at, l.company_name
     FROM activities a LEFT JOIN leads l ON l.id = a.lead_id
     ORDER BY a.id DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return c.json({ activities: rows.results });
});
