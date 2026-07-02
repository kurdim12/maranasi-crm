import { describe, expect, it } from 'vitest';
import { isValidEmailSyntax, isValidPhoneFormat } from '../src/lib/verify';
import { isWithinSendWindow } from '../src/lib/time';
import { normalizeDomain } from '../src/lib/crawler';
import { parseJsonLoose } from '../src/lib/llm';

describe('email/phone validation', () => {
  it('accepts normal business emails', () => {
    expect(isValidEmailSyntax('info@saigonstar.vn')).toBe(true);
    expect(isValidEmailSyntax('sales@bkk-expo.co.th')).toBe(true);
  });
  it('rejects garbage', () => {
    expect(isValidEmailSyntax('not-an-email')).toBe(false);
    expect(isValidEmailSyntax('a@b')).toBe(false);
    expect(isValidEmailSyntax('a b@c.com')).toBe(false);
  });
  it('validates E.164-ish phones', () => {
    expect(isValidPhoneFormat('+66 2 204 1111')).toBe(true);
    expect(isValidPhoneFormat('+84 28 3823 999')).toBe(true);
    expect(isValidPhoneFormat('call me')).toBe(false);
    expect(isValidPhoneFormat(null)).toBe(false);
  });
});

describe('send window (Mon-Fri 09:00-16:30 lead-local)', () => {
  // Asia/Bangkok is UTC+7 all year: window = 02:00-09:30 UTC.
  it('allows a Wednesday mid-morning in Bangkok', () => {
    expect(isWithinSendWindow('Asia/Bangkok', new Date('2026-07-01T04:00:00Z'))).toBe(true); // 11:00 local
  });
  it('blocks before 09:00 and after 16:30 local', () => {
    expect(isWithinSendWindow('Asia/Bangkok', new Date('2026-07-01T01:45:00Z'))).toBe(false); // 08:45
    expect(isWithinSendWindow('Asia/Bangkok', new Date('2026-07-01T09:45:00Z'))).toBe(false); // 16:45
  });
  it('blocks weekends', () => {
    expect(isWithinSendWindow('Asia/Bangkok', new Date('2026-07-04T04:00:00Z'))).toBe(false); // Saturday
    expect(isWithinSendWindow('Asia/Bangkok', new Date('2026-07-05T04:00:00Z'))).toBe(false); // Sunday
  });
  it('falls back safely on a bad timezone string', () => {
    expect(() => isWithinSendWindow('Not/AZone', new Date())).not.toThrow();
  });
});

describe('domain normalization', () => {
  it('strips scheme, www and path', () => {
    expect(normalizeDomain('https://www.SaigonStar.vn/en/contact')).toBe('saigonstar.vn');
    expect(normalizeDomain('bkkexpo.co.th')).toBe('bkkexpo.co.th');
  });
  it('returns null for garbage', () => {
    expect(normalizeDomain('not a url at all :::')).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

describe('model JSON parsing', () => {
  it('parses plain JSON', () => {
    expect(parseJsonLoose('{"subject":"a","body":"b"}')).toEqual({ subject: 'a', body: 'b' });
  });
  it('tolerates markdown fences and preambles', () => {
    expect(parseJsonLoose('```json\n{"label":"ooo"}\n```')).toEqual({ label: 'ooo' });
    expect(parseJsonLoose('Sure! Here you go: {"label":"bounce"} hope that helps')).toEqual({ label: 'bounce' });
  });
  it('returns null on garbage', () => {
    expect(parseJsonLoose('no json here')).toBeNull();
  });
});
