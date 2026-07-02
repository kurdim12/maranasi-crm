// Small CSV helpers for lead import/export (pure functions, unit-tested).

export interface ImportedLead {
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  category: string | null;
}

/**
 * RFC-4180-ish line splitter that honors quoted fields. Limitation: parsing is
 * line-based, so a quoted field containing a literal newline breaks that row —
 * such rows surface in the import errors list rather than importing silently.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const HEADER_ALIASES: Record<keyof ImportedLead, string[]> = {
  company_name: ['company', 'company_name', 'company name', 'name', 'business'],
  contact_name: ['contact', 'contact_name', 'contact name', 'person', 'full name'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  phone: ['phone', 'phone_number', 'phone number', 'tel', 'telephone', 'mobile'],
  website: ['website', 'url', 'site', 'web', 'domain'],
  city: ['city', 'town', 'location'],
  country: ['country', 'country_code', 'cc'],
  category: ['category', 'type', 'industry', 'segment'],
};

function normalizeCountry(v: string | null): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (['vn', 'vietnam', 'viet nam'].includes(s)) return 'VN';
  if (['th', 'thailand'].includes(s)) return 'TH';
  return v.trim().toUpperCase().slice(0, 2);
}

export interface ParseResult {
  rows: ImportedLead[];
  errors: string[];
}

/**
 * Parse a pasted CSV into lead rows. First line must be a header; columns are
 * matched by common aliases. A row needs at least a company name or an email.
 */
export function parseLeadsCsv(text: string, maxRows = 200): ParseResult {
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { rows: [], errors: ['need a header line plus at least one data row'] };

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const colFor: Partial<Record<keyof ImportedLead, number>> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof ImportedLead, string[]][]) {
    const idx = headers.findIndex((h) => aliases.includes(h));
    if (idx !== -1) colFor[field] = idx;
  }
  if (colFor.company_name === undefined && colFor.email === undefined) {
    return { rows: [], errors: [`no usable columns found — headers seen: ${headers.join(', ')}`] };
  }

  const rows: ImportedLead[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (rows.length >= maxRows) {
      errors.push(`stopped at ${maxRows} rows — import the rest in a second batch`);
      break;
    }
    const cells = splitCsvLine(lines[i]);
    const get = (f: keyof ImportedLead) => {
      const idx = colFor[f];
      return idx !== undefined && cells[idx] ? cells[idx] : null;
    };
    const email = get('email')?.toLowerCase() ?? null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      errors.push(`line ${i + 1}: invalid email '${email}' — row skipped`);
      continue;
    }
    const company = get('company_name') ?? (email ? email.split('@')[1] : null);
    if (!company) {
      errors.push(`line ${i + 1}: no company or email — row skipped`);
      continue;
    }
    rows.push({
      company_name: company,
      contact_name: get('contact_name'),
      email,
      phone: get('phone'),
      website: get('website'),
      city: get('city'),
      country: normalizeCountry(get('country')),
      category: get('category'),
    });
  }
  return { rows, errors };
}

export function csvEscape(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralize spreadsheet formula injection — scraped company names are
  // untrusted and exports get opened in Excel/Sheets. Leading +/- followed by
  // a digit stays intact so phone numbers and negatives survive round-trips.
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !/^[+-][\d(\s]/.test(s))) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}
