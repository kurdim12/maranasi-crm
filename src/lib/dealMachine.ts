// Deal stage machine — small and explicit, mirroring the lead state machine.
// won/lost are terminal; lost requires a reason.

export type DealStage = 'new' | 'call_scheduled' | 'proposal_sent' | 'negotiation' | 'won' | 'lost';

export const DEAL_STAGES: DealStage[] = ['new', 'call_scheduled', 'proposal_sent', 'negotiation', 'won', 'lost'];

const DEAL_TRANSITIONS: Record<DealStage, DealStage[]> = {
  new: ['call_scheduled', 'proposal_sent', 'negotiation', 'won', 'lost'],
  call_scheduled: ['new', 'proposal_sent', 'negotiation', 'won', 'lost'],
  proposal_sent: ['call_scheduled', 'negotiation', 'won', 'lost'],
  negotiation: ['proposal_sent', 'won', 'lost'],
  won: [],
  lost: [],
};

export class IllegalDealTransition extends Error {
  constructor(from: string, to: string) {
    super(`illegal deal transition: ${from} → ${to}`);
  }
}

export function assertDealTransition(from: string, to: string, lostReason?: string | null): void {
  if (!DEAL_STAGES.includes(from as DealStage) || !DEAL_STAGES.includes(to as DealStage)) {
    throw new IllegalDealTransition(from, to);
  }
  if (!DEAL_TRANSITIONS[from as DealStage].includes(to as DealStage)) {
    throw new IllegalDealTransition(from, to);
  }
  if (to === 'lost' && !lostReason?.trim()) {
    throw new Error('moving a deal to lost requires lost_reason');
  }
}

/** Compare-and-swap stage update; throws if the row moved under us. */
export async function transitionDeal(
  db: D1Database,
  dealId: number,
  from: string,
  to: DealStage,
  extra: { lost_reason?: string | null } = {},
): Promise<void> {
  assertDealTransition(from, to, extra.lost_reason);
  const res = await db
    .prepare(
      `UPDATE deals SET stage = ?, lost_reason = COALESCE(?, lost_reason), updated_at = datetime('now')
       WHERE id = ? AND stage = ?`,
    )
    .bind(to, extra.lost_reason ?? null, dealId, from)
    .run();
  if (!res.meta.changes) throw new Error(`deal ${dealId} changed stage concurrently (expected '${from}')`);
}
