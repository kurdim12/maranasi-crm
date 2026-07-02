import { describe, expect, it } from 'vitest';
import { assertDealTransition, DEAL_STAGES, IllegalDealTransition } from '../src/lib/dealMachine';
import { resolvedTriage, triageForInbound } from '../src/lib/pipelineHooks';

describe('deal stage machine', () => {
  it('allows the forward path new → … → won', () => {
    expect(() => assertDealTransition('new', 'call_scheduled')).not.toThrow();
    expect(() => assertDealTransition('call_scheduled', 'proposal_sent')).not.toThrow();
    expect(() => assertDealTransition('proposal_sent', 'negotiation')).not.toThrow();
    expect(() => assertDealTransition('negotiation', 'won')).not.toThrow();
  });

  it('won and lost are terminal', () => {
    for (const to of DEAL_STAGES) {
      expect(() => assertDealTransition('won', to)).toThrow(IllegalDealTransition);
      expect(() => assertDealTransition('lost', to)).toThrow(IllegalDealTransition);
    }
  });

  it('lost requires a reason', () => {
    expect(() => assertDealTransition('negotiation', 'lost')).toThrow(/lost_reason/);
    expect(() => assertDealTransition('negotiation', 'lost', 'budget cut')).not.toThrow();
  });

  it('rejects unknown stages and skipping the map', () => {
    expect(() => assertDealTransition('new', 'closed' as never)).toThrow(IllegalDealTransition);
    expect(() => assertDealTransition('negotiation', 'new')).toThrow(IllegalDealTransition);
  });
});

describe('inbox triage defaults', () => {
  it('routes human replies to needs_reply', () => {
    expect(triageForInbound('interested')).toBe('needs_reply');
    expect(triageForInbound('not_interested')).toBe('needs_reply');
    expect(triageForInbound('other')).toBe('needs_reply');
    expect(triageForInbound(null)).toBe('needs_reply');
  });
  it('routes machine mail to done', () => {
    expect(triageForInbound('ooo')).toBe('done');
    expect(triageForInbound('bounce')).toBe('done');
  });
  it("marking handled lands in 'waiting' only when we sent last", () => {
    expect(resolvedTriage('out')).toBe('waiting');
    expect(resolvedTriage('in')).toBe('done');
    expect(resolvedTriage(null)).toBe('done');
  });
});
