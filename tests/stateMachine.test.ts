import { describe, expect, it } from 'vitest';
import { assertTransition, IllegalTransitionError, type LeadStatus } from '../src/lib/stateMachine';

const ALL: LeadStatus[] = [
  'new', 'enriched', 'verified', 'invalid_email', 'contacted', 'interested',
  'not_interested', 'opted_out', 'unresponsive_email', 'dropped',
];

describe('lead state machine', () => {
  it('allows the canonical pipeline path', () => {
    expect(() => assertTransition('new', 'enriched')).not.toThrow();
    expect(() => assertTransition('enriched', 'verified')).not.toThrow();
    expect(() => assertTransition('verified', 'contacted')).not.toThrow();
    expect(() => assertTransition('contacted', 'contacted')).not.toThrow(); // steps 2-3
    expect(() => assertTransition('contacted', 'unresponsive_email')).not.toThrow();
    expect(() => assertTransition('unresponsive_email', 'dropped')).not.toThrow();
  });

  it('allows reply-driven exits from the sequence', () => {
    for (const to of ['interested', 'not_interested', 'opted_out'] as LeadStatus[]) {
      expect(() => assertTransition('contacted', to)).not.toThrow();
      expect(() => assertTransition('unresponsive_email', to)).not.toThrow();
      expect(() => assertTransition('invalid_email', to)).not.toThrow(); // bounced-then-replied
    }
  });

  it('treats opted_out and dropped as terminal', () => {
    for (const from of ['opted_out', 'dropped'] as LeadStatus[]) {
      for (const to of ALL) {
        if (to === from) continue;
        expect(() => assertTransition(from, to)).toThrow(IllegalTransitionError);
      }
    }
  });

  it('never allows a drop straight from the email pipeline', () => {
    for (const from of ['new', 'enriched', 'verified', 'contacted'] as LeadStatus[]) {
      expect(() => assertTransition(from, 'dropped')).toThrow(IllegalTransitionError);
    }
  });

  it('rejects skipping the pipeline order', () => {
    expect(() => assertTransition('new', 'contacted')).toThrow(IllegalTransitionError);
    expect(() => assertTransition('enriched', 'contacted')).toThrow(IllegalTransitionError);
    expect(() => assertTransition('interested', 'contacted')).toThrow(IllegalTransitionError);
  });
});
