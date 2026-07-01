import type { Env, Lead } from '../env';
import { nowIso } from '../env';
import { logActivity } from './activity';
import { transitionLead } from './stateMachine';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// E.164-ish: optional +, 7-20 digits allowing separators
const PHONE_RE = /^\+?[0-9][0-9 ().-]{5,18}[0-9]$/;

export function isValidEmailSyntax(email: string): boolean {
  return EMAIL_RE.test(email);
}

export function isValidPhoneFormat(phone: string | null): boolean {
  return Boolean(phone && PHONE_RE.test(phone.trim()));
}

/** MX lookup via DNS-over-HTTPS (Cloudflare resolver). */
export async function hasMxRecord(domain: string): Promise<boolean> {
  const res = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
    { headers: { accept: 'application/dns-json' } },
  );
  if (!res.ok) throw new Error(`DoH lookup failed: ${res.status}`);
  const data = (await res.json()) as { Status: number; Answer?: { type: number }[] };
  return data.Status === 0 && (data.Answer ?? []).some((a) => a.type === 15);
}

export type ExternalVerdict = 'deliverable' | 'undeliverable' | 'unknown';

/**
 * Adapter for an external verification provider (ZeroBounce / NeverBounce).
 * The external call is stubbed: when VERIFIER_API_KEY is present this is where
 * the provider request goes; until then we return 'unknown' so syntax + MX
 * remain the deciding checks.
 */
export async function externalVerify(env: Env, email: string): Promise<ExternalVerdict> {
  if (!env.VERIFIER_API_KEY) return 'unknown';
  // Plug a provider in here, e.g. ZeroBounce:
  //   GET https://api.zerobounce.net/v2/validate?api_key=...&email=...
  //   map status "valid" -> deliverable, "invalid"/"do_not_mail" -> undeliverable, else unknown
  void email;
  return 'unknown';
}

export interface VerifyResult {
  ok: boolean;
  reason: string;
}

/**
 * Verification pipeline: syntax -> MX (DoH) -> optional external provider.
 * Pass: email_status='verified', status='verified', confirmed=1 when the phone
 * also looks valid, next_action_at=now (so the sequence engine picks it up).
 * Fail: email_status='invalid', status='invalid_email'.
 */
export async function verifyLead(env: Env, db: D1Database, lead: Lead): Promise<VerifyResult> {
  if (!lead.email) return { ok: false, reason: 'no email on lead' };
  if (!['new', 'enriched'].includes(lead.status) && lead.status !== 'invalid_email') {
    return { ok: false, reason: `lead status '${lead.status}' is not verifiable` };
  }

  const fail = async (reason: string): Promise<VerifyResult> => {
    if (lead.status !== 'invalid_email') {
      await transitionLead(db, lead, 'invalid_email', {
        actor: 'system',
        set: { email_status: 'invalid' },
        detail: { reason },
      });
    } else {
      await db
        .prepare("UPDATE leads SET email_status = 'invalid', updated_at = ? WHERE id = ?")
        .bind(nowIso(), lead.id)
        .run();
    }
    return { ok: false, reason };
  };

  if (!isValidEmailSyntax(lead.email)) return fail('invalid syntax');

  const domain = lead.email.split('@')[1].toLowerCase();
  let mx: boolean;
  try {
    mx = await hasMxRecord(domain);
  } catch (err) {
    // DNS infrastructure error: do not mark invalid, just report and retry later
    await logActivity(db, 'system', 'verify_deferred', lead.id, { error: String(err) });
    return { ok: false, reason: 'MX lookup unavailable, deferred' };
  }
  if (!mx) return fail('no MX record');

  const external = await externalVerify(env, lead.email);
  if (external === 'undeliverable') return fail('external verifier: undeliverable');

  // Pass. Move new -> enriched -> verified as needed (state machine enforces order).
  if (lead.status === 'new') {
    await transitionLead(db, lead, 'enriched', { actor: 'system', detail: { via: 'verification' } });
  }
  const phoneOk = isValidPhoneFormat(lead.phone);
  await transitionLead(db, lead, 'verified', {
    actor: 'system',
    set: {
      email_status: 'verified',
      confirmed: phoneOk ? 1 : 0,
      next_action_at: nowIso(),
    },
    detail: { mx: true, external },
  });
  if (phoneOk && lead.phone_status === 'unknown') {
    await db
      .prepare("UPDATE leads SET phone_status = 'valid_format', updated_at = ? WHERE id = ?")
      .bind(nowIso(), lead.id)
      .run();
  }
  return { ok: true, reason: 'verified' };
}
