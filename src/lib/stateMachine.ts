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
  // 'verified' = owner fixed the email and re-verified; reply edges = a real
  // human answered from an address a bounce had marked dead.
  invalid_email: ['verified', 'interested', 'not_interested', 'opted_out'],
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
    // Re-read phone_status LIVE at the moment of the drop — never trust the
    // caller's (possibly stale) lead object for the gate. A lead mutated
    // between the caller's read and this transition must be judged on its
    // current state.
    const live = await db
      .prepare('SELECT phone_status FROM leads WHERE id = ?')
      .bind(lead.id)
      .first<{ phone_status: string }>();
    if (!live || live.phone_status !== 'unresponsive') {
      throw new IllegalTransitionError(
        from,
        to,
        'a lead may be dropped only after a human has logged phone_status = unresponsive',
      );
    }
    if (opts.actor !== 'crm_agent') {
      throw new IllegalTransitionError(from, to, 'only the CRM agent can set dropped');
    }
    // The gate must be backed by an explicit call log, not just the column
    // value: the most recent call_outcome activity for this lead has to say
    // 'unresponsive'. This blocks any path that flipped phone_status without
    // an actual logged call.
    const lastCall = await db
      .prepare(
        "SELECT detail FROM activities WHERE lead_id = ? AND action = 'call_outcome' ORDER BY id DESC LIMIT 1",
      )
      .bind(lead.id)
      .first<{ detail: string | null }>();
    let outcome: string | undefined;
    try {
      outcome = lastCall?.detail ? (JSON.parse(lastCall.detail) as { outcome?: string }).outcome : undefined;
    } catch {
      outcome = undefined;
    }
    if (outcome !== 'unresponsive') {
      throw new IllegalTransitionError(
        from,
        to,
        'no logged call with outcome=unresponsive found — log the call via mark_call_outcome first',
      );
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
  binds.push(lead.id, from);
  // Compare-and-swap on status: if the row moved on since the caller read it,
  // the transition no longer applies — fail loudly instead of clobbering
  // (this makes resurrecting opted_out/dropped via stale reads impossible).
  const result = await db
    .prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ? AND status = ?`)
    .bind(...binds)
    .run();
  if (!result.meta.changes) {
    throw new IllegalTransitionError(from, to, 'stale read: lead status changed concurrently');
  }

  await logActivity(db, opts.actor, to === 'dropped' ? 'lead_dropped' : 'status_change', lead.id, {
    from,
    to,
    ...(opts.dropReason ? { reason: opts.dropReason } : {}),
    ...(opts.detail ?? {}),
  });

  lead.status = to; // keep the in-memory row coherent for callers
}
