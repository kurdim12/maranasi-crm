import { describe, expect, it } from 'vitest';
import { csvEscape, parseLeadsCsv, splitCsvLine, toCsv } from '../src/lib/csv';

describe('csv line splitting', () => {
  it('handles quoted fields with commas and escaped quotes', () => {
    expect(splitCsvLine('a,"b, c","d ""e"" f"')).toEqual(['a', 'b, c', 'd "e" f']);
  });
});

describe('lead CSV import parsing', () => {
  it('maps common header aliases', () => {
    const { rows, errors } = parseLeadsCsv(
      'Company,Contact,Email,Phone,City,Country\n' +
        'Saigon Star,"Tran, Linh",hello@saigonstar.vn,+84 28 3823 999,Ho Chi Minh City,Vietnam\n' +
        'BKK Expo,,info@bkkexpo.co.th,,Bangkok,TH',
    );
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      company_name: 'Saigon Star',
      contact_name: 'Tran, Linh',
      email: 'hello@saigonstar.vn',
      country: 'VN',
    });
    expect(rows[1].country).toBe('TH');
  });

  it('skips rows with invalid emails and reports them', () => {
    const { rows, errors } = parseLeadsCsv('company,email\nGood Co,ok@good.com\nBad Co,not-an-email');
    expect(rows).toHaveLength(1);
    expect(errors[0]).toContain('line 3');
  });

  it('derives company from the email domain when missing', () => {
    const { rows } = parseLeadsCsv('email\ninfo@venue-hanoi.vn');
    expect(rows[0].company_name).toBe('venue-hanoi.vn');
  });

  it('fails clearly when no usable columns exist', () => {
    const { rows, errors } = parseLeadsCsv('foo,bar\n1,2');
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain('no usable columns');
  });

  it('caps the row count', () => {
    const body = Array.from({ length: 250 }, (_, i) => `Co ${i},x${i}@a${i}.com`).join('\n');
    const { rows, errors } = parseLeadsCsv('company,email\n' + body);
    expect(rows).toHaveLength(200);
    expect(errors.some((e) => e.includes('stopped at 200'))).toBe(true);
  });
});

describe('csv export', () => {
  it('escapes values that need it', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('has, comma')).toBe('"has, comma"');
    expect(csvEscape('has "quote"')).toBe('"has ""quote"""');
    expect(csvEscape(null)).toBe('');
  });
  it('neutralizes spreadsheet formulas but keeps phone numbers', () => {
    expect(csvEscape('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvEscape('+cmd|calc')).toBe("'+cmd|calc");
    expect(csvEscape('+84 28 3823 999')).toBe('+84 28 3823 999');
    expect(csvEscape('-12.5')).toBe('-12.5');
  });
  it('round-trips rows', () => {
    const csv = toCsv(['a', 'b'], [{ a: 1, b: 'x,y' }]);
    expect(csv).toBe('a,b\n1,"x,y"');
  });
});
