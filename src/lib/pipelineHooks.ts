// Auto-hooks that close the post-reply loop:
//   lead → interested  ⇒ ensure an open deal (stage 'new') + "Reply to {co}" task
//   lead → needs_call  ⇒ "Call {company}" task
// Idempotent: never duplicates an open deal or an identical open task.
import type { Lead } from '../env';
import { logActivity } from './activity';

export async function ensureDealForInterested(db: D1Database, lead: Lead): Promise<number | null> {
  const open = await db
    .prepare("SELECT id FROM deals WHERE lead_id = ? AND stage NOT IN ('won','lost') LIMIT 1")
    .bind(lead.id)
    .first<{ id: number }>();
  if (open) return null;
  const row = await db
    .prepare("INSERT INTO deals (lead_id, stage, next_step) VALUES (?, 'new', 'Reply and qualify') RETURNING id")
    .bind(lead.id)
    .first<{ id: number }>();
  await logActivity(db, 'system', 'deal_created', lead.id, { deal_id: row!.id, trigger: 'interested_reply' });
  await createTaskOnce(db, lead.id, row!.id, `Reply to ${lead.company_name}`, 'system');
  return row!.id;
}

export async function createCallTask(db: D1Database, lead: Lead): Promise<void> {
  await createTaskOnce(db, lead.id, null, `Call ${lead.company_name}`, 'system');
}

export async function createTaskOnce(
  db: D1Database,
  leadId: number | null,
  dealId: number | null,
  title: string,
  source: 'manual' | 'system' | 'agent',
  dueAt?: string | null,
): Promise<number | null> {
  if (leadId) {
    const dupe = await db
      .prepare('SELECT id FROM tasks WHERE lead_id = ? AND title = ? AND done_at IS NULL LIMIT 1')
      .bind(leadId, title)
      .first();
    if (dupe) return null;
  }
  const row = await db
    .prepare('INSERT INTO tasks (lead_id, deal_id, title, due_at, source) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(leadId, dealId, title, dueAt ?? null, source)
    .first<{ id: number }>();
  await logActivity(db, source === 'agent' ? 'crm_agent' : source === 'manual' ? 'owner' : 'system', 'task_created', leadId, {
    task_id: row!.id,
    title,
  });
  return row!.id;
}

/** Inbound triage default: bounces and out-of-office need no human reply. */
export function triageForInbound(classification: string | null): 'needs_reply' | 'done' {
  return classification === 'ooo' || classification === 'bounce' ? 'done' : 'needs_reply';
}
