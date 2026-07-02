import { Hono } from 'hono';
import type { Env, Lead } from '../env';
import { nowIso } from '../env';
import { runCrmAgent } from '../agent/loop';
import { markCallOutcome } from '../agent/tools';
import { logActivity } from '../lib/activity';
import { isManagedKey, listSettings, putSetting } from '../lib/config';
import { parseLeadsCsv, toCsv } from '../lib/csv';
import { normalizeDomain } from '../lib/crawler';
import { removeDemoData, seedDemoData } from '../lib/demoData';
import { createTaskOnce } from '../lib/pipelineHooks';
import { gmailConfigured, gmailGetProfile, gmailSend, gmailThreadReplyHeaders } from '../lib/gmail';
import { getHealth } from '../lib/health';
import { getDailyCap, getSentToday, isSendingPaused, setSendingPaused } from '../lib/kvconf';
import { llmProvider, llmText } from '../lib/llm';
import { placesTextSearch } from '../lib/places';
import { verifyLead } from '../lib/verify';
import { previewNextEmail } from '../jobs/sequence';
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

/** Manually add one lead. */
api.post('/leads', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, string> | null;
  if (!body) return c.json({ error: 'invalid JSON body' }, 400);
  const company = (body.company_name ?? '').trim();
  const email = (body.email ?? '').trim().toLowerCase() || null;
  if (!company && !email) return c.json({ error: 'company_name or email required' }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return c.json({ error: 'invalid email' }, 400);
  if (email) {
    const dupe = await c.env.DB.prepare('SELECT id FROM leads WHERE email = ?').bind(email).first<{ id: number }>();
    if (dupe) return c.json({ error: `email already on lead #${dupe.id}` }, 409);
    const sup = await c.env.DB.prepare('SELECT reason FROM suppression WHERE email = ?').bind(email).first();
    if (sup) return c.json({ error: 'email is on the suppression list' }, 409);
  }
  const country = (body.country ?? '').trim().toUpperCase() || null;
  const inserted = await c.env.DB.prepare(
    `INSERT INTO leads (company_name, contact_name, email, phone, website, domain, category, city, country, timezone, source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?) RETURNING id`,
  )
    .bind(
      company || (email ? email.split('@')[1] : 'Unknown'),
      body.contact_name?.trim() || null,
      email,
      body.phone?.trim() || null,
      body.website?.trim() || null,
      normalizeDomain(body.website ?? null),
      body.category?.trim() || null,
      body.city?.trim() || null,
      country,
      country === 'VN' ? 'Asia/Ho_Chi_Minh' : 'Asia/Bangkok',
      email ? 'enriched' : 'new',
    )
    .first<{ id: number }>();
  const id = inserted!.id;
  await logActivity(c.env.DB, 'owner', 'lead_created', id, { source: 'manual' });
  // Verify inline so a manual lead is sendable right away.
  if (email) {
    const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
    if (lead) await verifyLead(c.env, c.env.DB, lead).catch(() => null);
  }
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
  return c.json({ ok: true, lead });
});

/** Import leads from pasted CSV. */
api.post('/leads/import', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { csv?: string; verify?: boolean };
  if (!body.csv) return c.json({ error: 'csv text required' }, 400);
  const { rows, errors } = parseLeadsCsv(body.csv);
  let imported = 0;
  let skipped = 0;
  const importedIds: number[] = [];
  for (const row of rows) {
    const domain = normalizeDomain(row.website);
    if (row.email) {
      const dupe = await c.env.DB.prepare('SELECT id FROM leads WHERE email = ?').bind(row.email).first();
      const sup = await c.env.DB.prepare('SELECT email FROM suppression WHERE email = ?').bind(row.email).first();
      if (dupe || sup) {
        skipped++;
        continue;
      }
    }
    if (domain) {
      const dupe = await c.env.DB.prepare('SELECT id FROM leads WHERE domain = ?').bind(domain).first();
      if (dupe) {
        skipped++;
        continue;
      }
    }
    const inserted = await c.env.DB.prepare(
      `INSERT INTO leads (company_name, contact_name, email, phone, website, domain, category, city, country, timezone, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?) RETURNING id`,
    )
      .bind(
        row.company_name,
        row.contact_name,
        row.email,
        row.phone,
        row.website,
        domain,
        row.category,
        row.city,
        row.country,
        row.country === 'VN' ? 'Asia/Ho_Chi_Minh' : 'Asia/Bangkok',
        row.email ? 'enriched' : 'new',
      )
      .first<{ id: number }>();
    imported++;
    importedIds.push(inserted!.id);
  }
  await logActivity(c.env.DB, 'owner', 'leads_imported', null, { imported, skipped, parse_errors: errors.length });
  // Verify imported emails (default on) so they enter the sequence.
  let verified = 0;
  if (body.verify !== false) {
    for (const id of importedIds.slice(0, 100)) {
      const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
      if (lead?.email) {
        const r = await verifyLead(c.env, c.env.DB, lead).catch(() => null);
        if (r?.ok) verified++;
      }
    }
  }
  return c.json({ ok: true, imported, skipped, verified, errors });
});

/** Export all leads as CSV. */
api.get('/leads/export', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM leads ORDER BY id').all<Lead>();
  const headers = [
    'id', 'company_name', 'contact_name', 'email', 'email_status', 'phone', 'phone_status', 'website',
    'category', 'city', 'country', 'status', 'sequence_step', 'needs_call', 'next_action_at',
    'last_contacted_at', 'drop_reason', 'notes', 'created_at',
  ];
  const csv = toCsv(headers, rows.results as unknown as Record<string, unknown>[]);
  return c.body(csv, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="maranasi-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
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

/** Preview the next sequence email for a lead (no send, no state change). */
api.get('/leads/:id/preview-next', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
  if (!lead) return c.json({ error: 'not found' }, 404);
  return c.json(await previewNextEmail(c.env, lead));
});

/** Pause / resume automated follow-ups for one lead (status unchanged). */
api.post('/leads/:id/sequence/:action', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const action = c.req.param('action');
  if (action !== 'pause' && action !== 'resume') return c.json({ error: 'action must be pause or resume' }, 400);
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
  if (!lead) return c.json({ error: 'not found' }, 404);
  if (!['verified', 'contacted'].includes(lead.status)) {
    return c.json({ error: `lead status is '${lead.status}' — only verified/contacted leads are in the sequence` }, 400);
  }
  if (action === 'resume' && lead.sequence_step >= 3) {
    return c.json({ error: 'sequence already completed (3/3)' }, 400);
  }
  const next = action === 'pause' ? null : nowIso();
  await c.env.DB.prepare('UPDATE leads SET next_action_at = ?, updated_at = ? WHERE id = ?')
    .bind(next, nowIso(), id)
    .run();
  await logActivity(c.env.DB, 'owner', `sequence_${action}d`, id, { next_action_at: next });
  return c.json({ ok: true, id, next_action_at: next });
});

/**
 * Owner-composed manual email to a lead (e.g. replying to an interested
 * lead). Owner-initiated, so it sends for real when Gmail is connected —
 * DRY_RUN only gates the automated sequence. Threads into the existing
 * conversation when one exists.
 */
api.post('/leads/:id/email', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
  if (!lead) return c.json({ error: 'not found' }, 404);
  if (!lead.email) return c.json({ error: 'lead has no email' }, 400);
  if (lead.source === 'demo') return c.json({ error: 'this is a demo lead — nothing can be sent to it' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { subject?: string; body?: string };
  if (!body.subject?.trim() || !body.body?.trim()) return c.json({ error: 'subject and body required' }, 400);
  const suppressed = await c.env.DB.prepare('SELECT reason FROM suppression WHERE email = ?')
    .bind(lead.email.toLowerCase())
    .first<{ reason: string }>();
  if (suppressed) {
    return c.json({ error: `this address is suppressed (${suppressed.reason}) — it opted out or bounced` }, 403);
  }
  if (!gmailConfigured(c.env)) return c.json({ error: 'Gmail is not connected — Settings → Connect Gmail' }, 400);

  const prevOut = await c.env.DB.prepare(
    'SELECT gmail_thread_id FROM email_log WHERE lead_id = ? AND gmail_thread_id IS NOT NULL AND dry_run = 0 ORDER BY id DESC LIMIT 1',
  )
    .bind(id)
    .first<{ gmail_thread_id: string }>();
  const threadId = prevOut?.gmail_thread_id ?? undefined;
  const replyHeaders = threadId ? await gmailThreadReplyHeaders(c.env, threadId) : {};
  const sent = await gmailSend(c.env, {
    to: lead.email,
    subject: body.subject.trim(),
    body: body.body,
    threadId,
    ...replyHeaders,
  });
  await c.env.DB.prepare(
    `INSERT INTO email_log (lead_id, direction, sequence_step, subject, body, gmail_message_id, gmail_thread_id, dry_run)
     VALUES (?, 'out', NULL, ?, ?, ?, ?, 0)`,
  )
    .bind(id, body.subject.trim(), body.body, sent.id, sent.threadId)
    .run();
  await logActivity(c.env.DB, 'owner', 'manual_email_sent', id, { subject: body.subject.trim() });
  return c.json({ ok: true, gmail_message_id: sent.id });
});

/** Unified mailbox for the Mail tab: every logged email joined with its lead. */
api.get('/emails', async (c) => {
  const q = c.req.query();
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (q.direction === 'in' || q.direction === 'out') {
    conds.push('e.direction = ?');
    binds.push(q.direction);
  }
  if (q.kind === 'real') conds.push('e.dry_run = 0');
  else if (q.kind === 'test') conds.push('e.dry_run = 1');
  if (q.q) {
    conds.push('(e.subject LIKE ? OR e.body LIKE ? OR l.company_name LIKE ?)');
    const like = `%${q.q}%`;
    binds.push(like, like, like);
  }
  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
  const limit = Math.min(Math.max(parseInt(q.limit ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(q.offset ?? '0', 10) || 0, 0);
  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM email_log e JOIN leads l ON l.id = e.lead_id${where}`)
    .bind(...binds)
    .first<{ n: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT e.id, e.lead_id, e.direction, e.sequence_step, e.subject, substr(e.body, 1, 200) AS snippet,
            e.classification, e.dry_run, e.created_at, l.company_name, l.email AS lead_email, l.status AS lead_status
     FROM email_log e JOIN leads l ON l.id = e.lead_id${where}
     ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all();
  return c.json({ emails: rows.results, total: total?.n ?? 0, offset, limit });
});

/** Showcase data: fill every screen with sample leads/mail/activity. */
api.post('/demo/seed', async (c) => {
  const result = await seedDemoData(c.env.DB);
  if ('error' in result) return c.json(result, 409);
  return c.json({ ok: true, ...result });
});

/** Remove the showcase data (only rows keyed as demo — real leads untouched). */
api.post('/demo/remove', async (c) => {
  const counts = await removeDemoData(c.env.DB);
  return c.json({ ok: true, ...counts });
});

/** Everything the Today home screen needs, in one request. */
api.get('/today', async (c) => {
  const db = c.env.DB;
  const needsReply = await db
    .prepare(
      `SELECT e.id AS email_id, e.lead_id, e.subject, substr(e.body,1,160) AS snippet, e.classification, e.created_at,
              l.company_name, l.email AS lead_email, l.status AS lead_status
       FROM email_log e JOIN leads l ON l.id = e.lead_id
       WHERE e.direction = 'in' AND e.triage = 'needs_reply'
         AND (e.snoozed_until IS NULL OR e.snoozed_until <= datetime('now'))
       ORDER BY e.created_at DESC LIMIT 20`,
    )
    .all();
  const callsDue = await db
    .prepare(
      `SELECT l.id, l.company_name, l.phone, l.city, l.country, l.status, l.updated_at,
              (SELECT t.id FROM tasks t WHERE t.lead_id = l.id AND t.done_at IS NULL AND t.title LIKE 'Call %' LIMIT 1) AS task_id
       FROM leads l WHERE l.needs_call = 1 ORDER BY l.updated_at DESC LIMIT 20`,
    )
    .all();
  const tasks = await db
    .prepare(
      `SELECT t.id, t.lead_id, t.deal_id, t.title, t.due_at, t.source, t.created_at, l.company_name
       FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
       WHERE t.done_at IS NULL ORDER BY t.due_at IS NULL, t.due_at ASC, t.id DESC LIMIT 30`,
    )
    .all();
  const hotLeads = await db
    .prepare(
      `SELECT id, company_name, city, country, status, fit_score, updated_at
       FROM leads WHERE fit_score >= 4 AND status NOT IN ('dropped','opted_out','not_interested')
       ORDER BY updated_at DESC LIMIT 10`,
    )
    .all();
  const pipeline = await db
    .prepare(
      `SELECT COUNT(*) AS open_deals, COALESCE(SUM(value_usd), 0) AS open_value
       FROM deals WHERE stage NOT IN ('won','lost')`,
    )
    .first<{ open_deals: number; open_value: number }>();
  return c.json({
    needs_reply: needsReply.results,
    calls_due: callsDue.results,
    tasks: tasks.results,
    hot_leads: hotLeads.results,
    pipeline,
  });
});

/** Tasks: quick-add and complete. */
api.get('/tasks', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.*, l.company_name FROM tasks t LEFT JOIN leads l ON l.id = t.lead_id
     WHERE t.done_at IS NULL ORDER BY t.due_at IS NULL, t.due_at ASC LIMIT 100`,
  ).all();
  return c.json({ tasks: rows.results });
});

api.post('/tasks', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { title?: string; lead_id?: number; due_at?: string };
  const title = body.title?.trim();
  if (!title) return c.json({ error: 'title required' }, 400);
  const id = await createTaskOnce(c.env.DB, body.lead_id ?? null, null, title, 'manual', body.due_at ?? null);
  if (!id) return c.json({ error: 'an identical open task already exists for that lead' }, 409);
  return c.json({ ok: true, id });
});

api.post('/tasks/:id/done', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const res = await c.env.DB.prepare("UPDATE tasks SET done_at = datetime('now') WHERE id = ? AND done_at IS NULL")
    .bind(id)
    .run();
  if (!res.meta.changes) return c.json({ error: 'task not found or already done' }, 404);
  const task = await c.env.DB.prepare('SELECT lead_id, title FROM tasks WHERE id = ?').bind(id).first<{ lead_id: number | null; title: string }>();
  await logActivity(c.env.DB, 'owner', 'task_completed', task?.lead_id ?? null, { task_id: id, title: task?.title });
  return c.json({ ok: true });
});

/** Aggregates for the Analytics tab. */
api.get('/analytics', async (c) => {
  const db = c.env.DB;
  const funnelOrder = ['new', 'enriched', 'verified', 'contacted', 'interested'];
  const byStatus = await db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all<{ status: string; n: number }>();
  const statusMap = Object.fromEntries(byStatus.results.map((r) => [r.status, r.n]));

  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const daily = await db
    .prepare(
      `SELECT date(created_at) AS d,
              SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN direction = 'in' AND COALESCE(classification,'') != 'bounce' THEN 1 ELSE 0 END) AS replies
       FROM email_log WHERE date(created_at) >= ? GROUP BY d ORDER BY d`,
    )
    .bind(since30)
    .all<{ d: string; sent: number; replies: number }>();

  const totals = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN direction = 'in' AND COALESCE(classification,'') NOT IN ('bounce','ooo') THEN 1 ELSE 0 END) AS replies,
         SUM(CASE WHEN direction = 'in' AND classification = 'bounce' THEN 1 ELSE 0 END) AS bounces,
         SUM(CASE WHEN direction = 'in' AND classification = 'interested' THEN 1 ELSE 0 END) AS interested
       FROM email_log`,
    )
    .first<{ sent: number; replies: number; bounces: number; interested: number }>();

  const byCountry = await db
    .prepare(
      `SELECT COALESCE(country, '??') AS country, COUNT(*) AS total,
              SUM(CASE WHEN status = 'interested' THEN 1 ELSE 0 END) AS interested
       FROM leads GROUP BY country ORDER BY total DESC LIMIT 8`,
    )
    .all<{ country: string; total: number; interested: number }>();

  const sent = totals?.sent ?? 0;
  return c.json({
    funnel: funnelOrder.map((s) => ({ status: s, n: statusMap[s] ?? 0 })),
    others: {
      not_interested: statusMap.not_interested ?? 0,
      unresponsive_email: statusMap.unresponsive_email ?? 0,
      opted_out: statusMap.opted_out ?? 0,
      invalid_email: statusMap.invalid_email ?? 0,
      dropped: statusMap.dropped ?? 0,
    },
    daily: daily.results,
    rates: {
      sent,
      replies: totals?.replies ?? 0,
      bounces: totals?.bounces ?? 0,
      interested: totals?.interested ?? 0,
      reply_rate: sent ? Math.round(((totals?.replies ?? 0) / sent) * 1000) / 10 : 0,
      bounce_rate: sent ? Math.round(((totals?.bounces ?? 0) / sent) * 1000) / 10 : 0,
    },
    by_country: byCountry.results,
  });
});

/** Daily send cap control (KV override; empty resets to the env default). */
api.get('/config/daily-cap', async (c) => {
  const kv = await c.env.KV.get('config:daily_cap');
  return c.json({ cap: await getDailyCap(c.env), source: kv ? 'dashboard' : 'default', default: parseInt(c.env.DAILY_SEND_CAP || '20', 10) });
});

api.put('/config/daily-cap', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { cap?: number | string | null };
  const raw = body.cap;
  if (raw === null || raw === '' || raw === undefined) {
    await c.env.KV.delete('config:daily_cap');
    await logActivity(c.env.DB, 'owner', 'daily_cap_reset', null, {});
    return c.json({ ok: true, cap: await getDailyCap(c.env), source: 'default' });
  }
  const cap = parseInt(String(raw), 10);
  if (Number.isNaN(cap) || cap < 0 || cap > 500) return c.json({ error: 'cap must be 0-500' }, 400);
  await c.env.KV.put('config:daily_cap', String(cap));
  await logActivity(c.env.DB, 'owner', 'daily_cap_set', null, { cap });
  return c.json({ ok: true, cap, source: 'dashboard' });
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
    health: await getHealth(c.env),
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

// ---- settings: dashboard-managed integration keys ----

api.get('/settings', async (c) => {
  return c.json({ settings: await listSettings(c.env) });
});

api.put('/settings/:key', async (c) => {
  const key = c.req.param('key');
  if (!isManagedKey(key)) return c.json({ error: 'unknown setting' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { value?: string };
  await putSetting(c.env, key, body.value ?? '');
  await logActivity(c.env.DB, 'owner', 'setting_updated', null, {
    key,
    action: body.value?.trim() ? 'set' : 'cleared',
  });
  return c.json({ ok: true, key });
});

/**
 * Live integration tests, run from the Worker (Cloudflare's network), so they
 * validate exactly what production will use.
 */
api.post('/settings/test/:integration', async (c) => {
  const which = c.req.param('integration');
  try {
    switch (which) {
      case 'places': {
        if (!c.env.GOOGLE_PLACES_API_KEY) return c.json({ ok: false, error: 'GOOGLE_PLACES_API_KEY is not set' });
        const places = await placesTextSearch(c.env, 'coffee shop in Bangkok');
        return c.json({ ok: true, detail: `Places API works — test query returned ${places.length} results.` });
      }
      case 'gmail': {
        if (!gmailConfigured(c.env)) {
          return c.json({ ok: false, error: 'Gmail is not connected (client id/secret/refresh token missing)' });
        }
        const profile = await gmailGetProfile(c.env);
        return c.json({ ok: true, detail: `Connected as ${profile.emailAddress}.` });
      }
      case 'llm': {
        const provider = llmProvider(c.env);
        if (!provider) return c.json({ ok: false, error: 'no LLM key set (OPENROUTER_API_KEY or ANTHROPIC_API_KEY)' });
        const reply = await llmText(c.env, 'fast', 'You reply with exactly: OK', 'ping', 10);
        return c.json({ ok: true, detail: `${provider} works — model replied "${(reply ?? '').trim().slice(0, 40)}".` });
      }
      case 'verifier': {
        if (!c.env.VERIFIER_API_KEY) return c.json({ ok: false, error: 'VERIFIER_API_KEY is not set' });
        const res = await fetch(
          `https://api.zerobounce.net/v2/getcredits?api_key=${encodeURIComponent(c.env.VERIFIER_API_KEY)}`,
          { signal: AbortSignal.timeout(8000) },
        );
        const data = (await res.json()) as { Credits?: string };
        const credits = Number(data.Credits ?? -1);
        if (credits < 0) return c.json({ ok: false, error: 'ZeroBounce rejected the key' });
        return c.json({ ok: true, detail: `ZeroBounce works — ${credits} credits remaining.` });
      }
      default:
        return c.json({ error: 'unknown integration; use places | gmail | llm | verifier' }, 400);
    }
  } catch (err) {
    return c.json({ ok: false, error: String(err).slice(0, 300) });
  }
});

/** Start the Gmail OAuth connect flow (finished by GET /auth/gmail/callback). */
api.post('/settings/gmail/start', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { client_id?: string; client_secret?: string };
  const clientId = (body.client_id ?? '').trim() || c.env.GMAIL_CLIENT_ID;
  const clientSecret = (body.client_secret ?? '').trim() || c.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) return c.json({ error: 'client_id and client_secret required' }, 400);
  await putSetting(c.env, 'GMAIL_CLIENT_ID', clientId);
  await putSetting(c.env, 'GMAIL_CLIENT_SECRET', clientSecret);

  const state = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await c.env.KV.put(`gmailoauth:${state}`, '1', { expirationTtl: 600 });

  const origin = new URL(c.req.url).origin;
  const redirectUri = `${origin}/auth/gmail/callback`;
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly',
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString();
  await logActivity(c.env.DB, 'owner', 'gmail_oauth_started', null, {});
  return c.json({ ok: true, url, redirect_uri: redirectUri });
});

// ---- dashboard user accounts ----

api.get('/users', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, username, display_name, active, created_at, last_login_at FROM users ORDER BY id',
  ).all();
  return c.json({ users: rows.results });
});

api.post('/users', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    display_name?: string;
  };
  const username = (body.username ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    return c.json({ error: 'username must be 3-32 chars: letters, digits, _ . -' }, 400);
  }
  if (!body.password || body.password.length < 8) {
    return c.json({ error: 'password must be at least 8 characters' }, 400);
  }
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (exists) return c.json({ error: 'username already taken' }, 409);
  const { hashPassword } = await import('../lib/password');
  const hash = await hashPassword(body.password);
  await c.env.DB.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)')
    .bind(username, hash, body.display_name ?? null)
    .run();
  await logActivity(c.env.DB, 'owner', 'user_created', null, { username });
  return c.json({ ok: true, username });
});

api.patch('/users/:username', async (c) => {
  const username = c.req.param('username').toLowerCase();
  const body = (await c.req.json().catch(() => ({}))) as { active?: number };
  if (body.active !== 0 && body.active !== 1) return c.json({ error: 'active must be 0 or 1' }, 400);
  if (body.active === 0) {
    const others = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM users WHERE active = 1 AND username != ?',
    )
      .bind(username)
      .first<{ n: number }>();
    if (!others?.n) return c.json({ error: 'cannot deactivate the last active account' }, 400);
  }
  const res = await c.env.DB.prepare('UPDATE users SET active = ? WHERE username = ?')
    .bind(body.active, username)
    .run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  await logActivity(c.env.DB, 'owner', 'user_updated', null, { username, active: body.active });
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
