// Pure pre-send guards for the manual email path. Order matters: the most
// specific, user-actionable reason wins. The safety behavior (zero real
// sends) is enforced by the caller returning before gmailSend; these exist
// so refusals are always explicit and visible, never silent.
import type { Lead } from '../env';

export interface SendRefusal {
  status: 400 | 403;
  error: string;
}

export function manualSendGuard(lead: Lead, suppressed: boolean): SendRefusal | null {
  if (!lead.email) return { status: 400, error: 'This lead has no email address yet — add one first.' };
  if (lead.source === 'demo' || lead.email.toLowerCase().endsWith('.example.com')) {
    return { status: 400, error: "Demo leads can't be emailed — they're for exploring the app." };
  }
  if (suppressed) {
    return { status: 403, error: 'This address is on your suppression list — it opted out or bounced.' };
  }
  return null;
}
