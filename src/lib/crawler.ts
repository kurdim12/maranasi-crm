// Polite site crawler: extract a contact email from a lead's website.
// Politeness rules (product requirements): 1 request/second, 8s timeout,
// honest User-Agent, max 5 pages per domain, tolerate failures silently.

const USER_AGENT = 'MaranasiOutreachBot/1.0 (B2B partnership outreach; contact via website form)';
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.th', 'yahoo.com.vn', 'hotmail.com',
  'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'protonmail.com', 'proton.me', 'mail.com',
]);
const ROLE_PREFIXES = ['info', 'sales', 'hello', 'marketing', 'event', 'events', 'contact'];
// common file-extension false positives from asset paths like image@2x.png
const BAD_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js', 'woff', 'woff2', 'ttf', 'mp4']);

const PATHS = ['', '/contact', '/contact-us', '/about', '/en/contact'];

export function normalizeDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    if (res.status !== 200) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (ct && !ct.includes('text/html') && !ct.includes('text/plain')) return null;
    return (await res.text()).slice(0, 500_000);
  } catch {
    return null; // tolerate failures silently
  }
}

function extractEmails(html: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase().replace(/^mailto:/, '');
    const tld = email.split('.').pop() ?? '';
    if (BAD_TLDS.has(tld)) continue;
    found.add(email);
  }
  return [...found];
}

/**
 * Rank candidates: same-domain role address > same-domain any > other
 * business domain. Free-mail providers are skipped entirely.
 */
function pickBest(emails: string[], siteDomain: string): string | null {
  const usable = emails.filter((e) => {
    const dom = e.split('@')[1];
    return dom && !FREE_MAIL.has(dom);
  });
  const sameDomain = usable.filter((e) => {
    const dom = e.split('@')[1];
    return dom === siteDomain || dom.endsWith(`.${siteDomain}`) || siteDomain.endsWith(`.${dom}`);
  });
  const roleSame = sameDomain.find((e) => ROLE_PREFIXES.includes(e.split('@')[0]));
  return roleSame ?? sameDomain[0] ?? usable[0] ?? null;
}

/** Visible-text extraction (rough but adequate for LLM briefs). */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|quot|#39|lt|gt);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SOCIAL_RE = /https?:\/\/(?:www\.)?(instagram\.com|facebook\.com|linkedin\.com)\/[A-Za-z0-9_.\-/%]+/gi;

export function extractSocials(html: string): Record<string, string> {
  const socials: Record<string, string> = {};
  for (const m of html.matchAll(SOCIAL_RE)) {
    const url = m[0].replace(/[).,'"]+$/, '');
    const host = m[1].toLowerCase();
    const key = host.startsWith('instagram') ? 'instagram' : host.startsWith('facebook') ? 'facebook' : 'linkedin';
    if (!socials[key] && !/\/(sharer|share|intent|plugins)\//.test(url)) socials[key] = url;
  }
  return socials;
}

export interface CrawlResult {
  email: string | null;
  pagesFetched: number;
  /** Visible text from the crawled pages, capped — brief-building input. */
  text: string;
  socials: Record<string, string>;
}

export async function findEmailForSite(website: string): Promise<CrawlResult> {
  const domain = normalizeDomain(website);
  if (!domain) return { email: null, pagesFetched: 0, text: '', socials: {} };

  let base: string;
  try {
    const u = new URL(website.includes('://') ? website : `https://${website}`);
    base = `${u.protocol}//${u.hostname}`;
  } catch {
    return { email: null, pagesFetched: 0, text: '', socials: {} };
  }

  const collected: string[] = [];
  const textParts: string[] = [];
  let socials: Record<string, string> = {};
  let pagesFetched = 0;
  for (const path of PATHS) {
    if (pagesFetched >= 5) break;
    if (pagesFetched > 0) await sleep(1000); // 1 req/s politeness
    const html = await fetchPage(`${base}${path}`);
    pagesFetched++;
    if (!html) continue;
    collected.push(...extractEmails(html));
    socials = { ...extractSocials(html), ...socials };
    if (textParts.join(' ').length < 12_000) textParts.push(stripHtml(html).slice(0, 6000));
    // stop early once a same-domain role email is on hand
    const best = pickBest(collected, domain);
    if (best && ROLE_PREFIXES.includes(best.split('@')[0]) && best.split('@')[1].includes(domain)) {
      return { email: best, pagesFetched, text: textParts.join('\n\n').slice(0, 14_000), socials };
    }
  }
  return { email: pickBest(collected, domain), pagesFetched, text: textParts.join('\n\n').slice(0, 14_000), socials };
}
