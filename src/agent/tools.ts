import type Anthropic from '@anthropic-ai/sdk';
import type { Env, Lead } from '../env';
import { nowIso } from '../env';
import { logActivity, type Actor } from '../lib/activity';
import { IllegalTransitionError, transitionLead } from '../lib/stateMachine';

// Every CRM-agent tool is a thin function over D1; all writes are recorded in
// the activities audit table with actor='crm_agent'.

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: 'search_leads',
    description:
      'Search leads with optional filters. Returns at most 25 rows. q does a free-text match over company name and notes.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'lead status filter' },
        country: { type: 'string', description: "'VN' or 'TH'" },
        city: { type: 'string' },
        needs_call: { type: 'boolean' },
        q: { type: 'string', description: 'free text over company_name and notes' },
      },
    },
  },
  {
    name: 'get_lead',
    description: 'Fetch one lead with its last 10 emails and last 10 activities.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
  },
  {
    name: 'update_lead',
    description:
      'Update editable lead fields. Whitelist: contact_name, phone, phone_status, notes, city, category, confirmed. Status and email cannot be changed here.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        fields: {
          type: 'object',
          properties: {
            contact_name: { type: 'string' },
            phone: { type: 'string' },
            phone_status: { type: 'string', enum: ['unknown', 'valid_format', 'reached', 'unresponsive'] },
            notes: { type: 'string' },
            city: { type: 'string' },
            category: { type: 'string' },
            confirmed: { type: 'integer', enum: [0, 1] },
          },
        },
      },
      required: ['id', 'fields'],
    },
  },
  {
    name: 'add_note',
    description: 'Append a note to a lead (keeps existing notes).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' }, note: { type: 'string' } },
      required: ['id', 'note'],
    },
  },
  {
    name: 'list_new_contacts',
    description: 'List leads created in the last N days (default 7) — the "recap of new contacts".',
    input_schema: {
      type: 'object',
      properties: { since_days: { type: 'integer', description: 'default 7' } },
    },
  },
  {
    name: 'get_stats',
    description: 'Pipeline stats for the last N days (default 7): counts by status, emails sent, replies, bounces.',
    input_schema: {
      type: 'object',
      properties: { range_days: { type: 'integer', description: 'default 7' } },
    },
  },
  {
    name: 'mark_call_outcome',
    description:
      "Record a phone call outcome logged by the owner: 'reached' or 'unresponsive'. This is the human phone-gate that later allows drop_lead.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        outcome: { type: 'string', enum: ['reached', 'unresponsive'] },
      },
      required: ['id', 'outcome'],
    },
  },
  {
    name: 'drop_lead',
    description:
      "Set a lead's status to dropped, with a reason. Only allowed when a human has already logged phone_status='unresponsive'. Never deletes the row.",
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' }, reason: { type: 'string' } },
      required: ['id', 'reason'],
    },
  },
];

const UPDATE_WHITELIST = new Set([
  'contact_name',
  'phone',
  'phone_status',
  'notes',
  'city',
  'category',
  'confirmed',
]);

async function getLeadOr404(db: D1Database, id: number): Promise<Lead | null> {
  return db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
}

export async function markCallOutcome(
  env: Env,
  id: number,
  outcome: 'reached' | 'unresponsive',
  actor: Actor,
): Promise<Record<string, unknown>> {
  const db = env.DB;
  const lead = await getLeadOr404(db, id);
  if (!lead) return { error: `lead ${id} not found` };
  await db
    .prepare('UPDATE leads SET phone_status = ?, needs_call = 0, updated_at = ? WHERE id = ?')
    .bind(outcome, nowIso(), id)
    .run();
  await logActivity(db, actor, 'call_outcome', id, { outcome, previous_phone_status: lead.phone_status });
  return { ok: true, id, phone_status: outcome, needs_call: 0 };
}

export async function executeTool(
  env: Env,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const db = env.DB;
  switch (name) {
    case 'search_leads': {
      const clauses: string[] = [];
      const binds: unknown[] = [];
      if (typeof input.status === 'string' && input.status) {
        clauses.push('status = ?');
        binds.push(input.status);
      }
      if (typeof input.country === 'string' && input.country) {
        clauses.push('country = ?');
        binds.push(input.country);
      }
      if (typeof input.city === 'string' && input.city) {
        clauses.push('city LIKE ?');
        binds.push(`%${input.city}%`);
      }
      if (input.needs_call === true) clauses.push('needs_call = 1');
      if (typeof input.q === 'string' && input.q) {
        clauses.push('(company_name LIKE ? OR notes LIKE ?)');
        binds.push(`%${input.q}%`, `%${input.q}%`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = await db
        .prepare(
          `SELECT id, company_name, contact_name, email, email_status, phone, phone_status, city, country,
           category, status, confirmed, needs_call, sequence_step, next_action_at, notes, created_at
           FROM leads ${where} ORDER BY updated_at DESC LIMIT 25`,
        )
        .bind(...binds)
        .all();
      return { count: rows.results.length, leads: rows.results };
    }

    case 'get_lead': {
      const id = Number(input.id);
      const lead = await getLeadOr404(db, id);
      if (!lead) return { error: `lead ${id} not found` };
      const emails = await db
        .prepare(
          'SELECT id, direction, sequence_step, subject, classification, dry_run, created_at FROM email_log WHERE lead_id = ? ORDER BY id DESC LIMIT 10',
        )
        .bind(id)
        .all();
      const acts = await db
        .prepare('SELECT actor, action, detail, created_at FROM activities WHERE lead_id = ? ORDER BY id DESC LIMIT 10')
        .bind(id)
        .all();
      return { lead, emails: emails.results, activities: acts.results };
    }

    case 'update_lead': {
      const id = Number(input.id);
      const lead = await getLeadOr404(db, id);
      if (!lead) return { error: `lead ${id} not found` };
      const fields = (input.fields ?? {}) as Record<string, unknown>;
      if (fields.phone_status === 'unresponsive') {
        return {
          error:
            "phone_status='unresponsive' cannot be set via update_lead — it gates lead dropping and must " +
            'come from an explicit call log. Use mark_call_outcome instead.',
        };
      }
      const rejected = Object.keys(fields).filter((k) => !UPDATE_WHITELIST.has(k));
      const accepted = Object.entries(fields).filter(([k]) => UPDATE_WHITELIST.has(k));
      if (!accepted.length) {
        return { error: `no whitelisted fields to update; rejected: ${rejected.join(', ') || '(none)'}. Status moves only via the state machine.` };
      }
      const sets = accepted.map(([k]) => `${k} = ?`).join(', ');
      const binds = accepted.map(([, v]) => v);
      await db
        .prepare(`UPDATE leads SET ${sets}, updated_at = ? WHERE id = ?`)
        .bind(...binds, nowIso(), id)
        .run();
      await logActivity(db, 'crm_agent', 'lead_updated', id, {
        fields: Object.fromEntries(accepted),
        ...(rejected.length ? { rejected } : {}),
      });
      return { ok: true, updated: Object.fromEntries(accepted), ...(rejected.length ? { rejected } : {}) };
    }

    case 'add_note': {
      const id = Number(input.id);
      const lead = await getLeadOr404(db, id);
      if (!lead) return { error: `lead ${id} not found` };
      const note = String(input.note ?? '').trim();
      if (!note) return { error: 'empty note' };
      const stamped = `[${nowIso()}] ${note}`;
      const combined = lead.notes ? `${lead.notes}\n${stamped}` : stamped;
      await db.prepare('UPDATE leads SET notes = ?, updated_at = ? WHERE id = ?').bind(combined, nowIso(), id).run();
      await logActivity(db, 'crm_agent', 'note_added', id, { note });
      return { ok: true, id, note: stamped };
    }

    case 'list_new_contacts': {
      const days = Number(input.since_days) > 0 ? Number(input.since_days) : 7;
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      const rows = await db
        .prepare(
          `SELECT id, company_name, contact_name, email, phone, city, country, category, status, created_at
           FROM leads WHERE created_at >= ? ORDER BY created_at DESC LIMIT 100`,
        )
        .bind(since)
        .all();
      return { since_days: days, count: rows.results.length, leads: rows.results };
    }

    case 'get_stats': {
      const days = Number(input.range_days) > 0 ? Number(input.range_days) : 7;
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
      const byStatus = await db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all();
      const sent = await db
        .prepare("SELECT COUNT(*) AS n FROM email_log WHERE direction = 'out' AND created_at >= ?")
        .bind(since)
        .first<{ n: number }>();
      const replies = await db
        .prepare(
          "SELECT COALESCE(classification,'other') AS c, COUNT(*) AS n FROM email_log WHERE direction = 'in' AND created_at >= ? GROUP BY classification",
        )
        .bind(since)
        .all<{ c: string; n: number }>();
      const bounces = replies.results.find((r) => r.c === 'bounce')?.n ?? 0;
      return {
        range_days: days,
        by_status: Object.fromEntries(byStatus.results.map((r) => [r.status as string, r.n])),
        emails_sent: sent?.n ?? 0,
        replies_by_classification: Object.fromEntries(replies.results.map((r) => [r.c, r.n])),
        bounces,
      };
    }

    case 'mark_call_outcome': {
      const outcome = input.outcome === 'reached' ? 'reached' : input.outcome === 'unresponsive' ? 'unresponsive' : null;
      if (!outcome) return { error: "outcome must be 'reached' or 'unresponsive'" };
      return markCallOutcome(env, Number(input.id), outcome, 'crm_agent');
    }

    case 'drop_lead': {
      const id = Number(input.id);
      const lead = await getLeadOr404(db, id);
      if (!lead) return { error: `lead ${id} not found` };
      if (lead.phone_status !== 'unresponsive') {
        return {
          error:
            `Cannot drop lead ${id}: phone_status is '${lead.phone_status}'. ` +
            "A lead may be dropped only after a human has logged phone_status='unresponsive' " +
            '(via mark_call_outcome). Email silence alone means unresponsive_email + needs_call, never dropped.',
        };
      }
      try {
        await transitionLead(db, lead, 'dropped', {
          actor: 'crm_agent',
          dropReason: String(input.reason ?? 'unspecified'),
          set: { next_action_at: null, needs_call: 0 },
        });
      } catch (err) {
        if (err instanceof IllegalTransitionError) return { error: err.message };
        throw err;
      }
      return { ok: true, id, status: 'dropped', reason: input.reason };
    }

    default:
      return { error: `unknown tool: ${name}` };
  }
}
