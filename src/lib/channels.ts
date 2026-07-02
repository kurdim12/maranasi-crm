// Multichannel assist — MANUAL ONLY, by design and by rule: deep links with
// prefilled text the owner sends from their own phone/app. No sending APIs,
// no automation, ever (platform ToS + number-burning risk).
import type { Lead } from '../env';

export type Channel = 'whatsapp' | 'zalo' | 'line' | 'email';

/** Country defaults: VN → Zalo, TH → Line; WhatsApp is the universal fallback. */
export function defaultChannel(lead: Pick<Lead, 'country' | 'preferred_channel'>): Channel {
  if (lead.preferred_channel && ['whatsapp', 'zalo', 'line', 'email'].includes(lead.preferred_channel)) {
    return lead.preferred_channel as Channel;
  }
  if (lead.country === 'VN') return 'zalo';
  if (lead.country === 'TH') return 'line';
  return 'whatsapp';
}

export function e164Digits(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length >= 7 ? digits : null;
}

/** Build the deep link for a channel, or null when the lead lacks what it needs. */
export function channelLink(
  lead: Pick<Lead, 'phone' | 'line_id'>,
  channel: Channel,
  text: string,
): string | null {
  const digits = e164Digits(lead.phone);
  switch (channel) {
    case 'whatsapp':
      return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
    case 'zalo':
      return digits ? `https://zalo.me/${digits}` : null; // Zalo ignores prefill — text goes to clipboard client-side
    case 'line':
      return lead.line_id ? `https://line.me/R/ti/p/~${encodeURIComponent(lead.line_id)}` : null;
    default:
      return null;
  }
}

export const DEFAULT_CHANNEL_TEMPLATES: Record<Exclude<Channel, 'email'>, string> = {
  whatsapp:
    'Hi {{contact_name}}, Rami from Maranasi Events here — we produce brand activations and corporate events across SEA. ' +
    'I reached out to {{company_name}} by email about a partnership; thought a quick chat might be easier. Open to it?',
  zalo:
    'Hi {{contact_name}}, Rami from Maranasi Events (brand activations & corporate events). ' +
    'I emailed {{company_name}} about partnering — happy to chat here if easier.',
  line:
    'Hi {{contact_name}}! Rami from Maranasi Events — we emailed {{company_name}} about an events partnership. ' +
    'Quick chat here works too if that is easier for you.',
};

/** Client-side-equivalent placeholder fill, kept here so it is unit-tested. */
export function fillChannelTemplate(tpl: string, lead: Pick<Lead, 'company_name' | 'contact_name' | 'city'>): string {
  return tpl
    .replace(/\{\{\s*company_name\s*\}\}/g, lead.company_name || 'your company')
    .replace(/\{\{\s*contact_name\s*\}\}/g, lead.contact_name || 'there')
    .replace(/\{\{\s*city\s*\}\}/g, lead.city || 'your city');
}
