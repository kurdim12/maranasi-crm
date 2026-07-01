import type { Lead } from '../env';
import { nowIso } from '../env';
import { logActivity, type Actor } from './activity';

export type LeadStatus =
  | 'new'
  | 'enriched'
  | 'verified'
  | 'invalid_email'
  | 'contacted'
  | 'interested'
  | 'not_interested'
  | 'opted_out'
  | 'unresponsive_email'
  | 'dropped';

export class IllegalTransitionError extends Error {
  constructor(from: string, to: string, reason?: string) {
    super(`illegal lead transition: ${from} -> ${to}${reason ? ` (${reason})` : ''}`);
    this.name = 'IllegalTransitionError';
  }
}

// The single source of truth for the lead state machine.
//
//   new -> enriched -> verified            (or -> invalid_email)
//   verified -> contacted (steps 1->2->3, 72h apart, only if no reply)
//   inbound reply -> interested | not_interested | opted_out   (sequence stops)
//   step 3 sent + 72h silence -> unresponsive_email, needs_call = 1  (NEVER dropped)
//   phone_status = 'unresponsive' (human-logged) -> CRM agent MAY set dropped
//
// 'dropped' is a status, not a delete — the row stays.
const TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ['enriched', 'verified', 'invalid_email'],
  enriched: ['verified', 'invalid_email'],
  verified: ['contacted', 'invalid_email', 'interested', 'not_interested', 'opted_out'],
  contacted: [
    'contacted', // steps 2 and 3 within the sequence
    'interested',
    'not_interested',
    'opted_out',
    'unresponsive_email',
    'invalid_email', // bounce
  ],
  unresponsive_email: ['interested', 'not_interested', 'opted_out', 'invalid_email', 'dropped'],
  interested: ['not_interested', 'opted_out', 'dropped'],
  not_interested: ['interested', 'opted_out', 'dropped'],
  invalid_email: ['verified'], // owner fixed the email and re-verified
  opted_out: [], // permanent, hard stop
  dropped: [], // terminal (row is kept)
};

export function assertTransition(from: LeadStatus, to: LeadStatus): void {
  const allowed = TRANSITIONS[from];
  if (!allowed) throw new IllegalTransitionError(from, to, 'unknown source status');
  if (!allowed.includes(to)) throw new IllegalTransitionError(from, to);
}

export interface TransitionOpts {
  actor: Actor;
  dropReason?: string;
  detail?: Record<string, unknown>;
  /** extra column updates applied atomically with the status change */
  set?: Partial<
    Pick<Lead, 'needs_call' | 'next_action_at' | 'email_status' | 'last_contacted_at' | 'confirmed'>
  >;
}

/**
 * Validates and applies a status transition. Throws IllegalTransitionError on
 * a disallowed move. Enforces the drop gate: `dropped` requires a human-logged
 * phone_status = 'unresponsive' AND actor = 'crm_agent'.
 */
export async function transitionLead(
  db: D1Database,
  lead: Lead,
  to: LeadStatus,
  opts: TransitionOpts,
): Promise<void> {
  const from = lead.status as LeadStatus;
  if (from === to && to !== 'contacted') return; // idempotent no-op (contacted->contacted is a real step)
  assertTransition(from, to);

  if (to === 'dropped') {
    if (lead.phone_status !== 'unresponsive') {
      throw new IllegalTransitionError(
        from,
        to,
        'a lead may be dropped only after a human has logged phone_status = unresponsive',
      );
    }
    if (opts.actor !== 'crm_agent') {
      throw new IllegalTransitionError(from, to, 'only the CRM agent can set dropped');
    }
  }

  const sets: string[] = ['status = ?', 'updated_at = ?'];
  const binds: unknown[] = [to, nowIso()];
  if (to === 'dropped') {
    sets.push('drop_reason = ?');
    binds.push(opts.dropReason ?? 'unspecified');
  }
  const extra = opts.set ?? {};
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = ?`);
    binds.push(val);
  }
  binds.push(lead.id);
  await db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  await logActivity(db, opts.actor, to === 'dropped' ? 'lead_dropped' : 'status_change', lead.id, {
    from,
    to,
    ...(opts.dropReason ? { reason: opts.dropReason } : {}),
    ...(opts.detail ?? {}),
  });

  lead.status = to; // keep the in-memory row coherent for callers
}
