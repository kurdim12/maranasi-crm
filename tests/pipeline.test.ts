import { describe, expect, it } from 'vitest';
import { normalizeBrief } from '../src/lib/brief';
import { extractSocials, stripHtml } from '../src/lib/crawler';
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

describe('lead intelligence (P4)', () => {
  it('normalizeBrief clamps and validates model output', () => {
    const { brief, fit_score } = normalizeBrief({
      what_they_do: 'x'.repeat(1000),
      event_types: ['weddings', 42, '  ', 'expos'],
      size_signals: null,
      hook_angle: 'They run the Hanoi bridal fair.',
      decision_makers: [{ name: 'Anh', title: 'Director' }, { title: 'no-name' }, 'junk'],
      fit_score: 99,
    });
    expect(brief.what_they_do.length).toBe(400);
    expect(brief.event_types).toEqual(['weddings', 'expos']);
    expect(brief.size_signals).toEqual([]);
    expect(brief.decision_makers).toEqual([{ name: 'Anh', title: 'Director' }]);
    expect(fit_score).toBe(5);
    expect(normalizeBrief({ fit_score: 0.4 }).fit_score).toBe(1);
    expect(normalizeBrief({}).fit_score).toBeNull();
  });

  it('stripHtml and extractSocials pull usable signal from raw pages', () => {
    const html = '<html><style>.x{}</style><body><h1>Lotus &amp; Co</h1><script>bad()</script>' +
      '<a href="https://www.instagram.com/lotusevents">ig</a>' +
      '<a href="https://facebook.com/sharer/share?u=x">share</a>' +
      '<a href="https://www.facebook.com/lotusevents.vn">fb</a></body></html>';
    expect(stripHtml(html)).toBe('Lotus Co ig share fb'); // scripts/styles gone, anchor text kept
    const socials = extractSocials(html);
    expect(socials.instagram).toBe('https://www.instagram.com/lotusevents');
    expect(socials.facebook).toBe('https://www.facebook.com/lotusevents.vn');
  });
});
