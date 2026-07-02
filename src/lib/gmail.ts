import type { Env } from '../env';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export function gmailConfigured(env: Env): boolean {
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID!,
      client_secret: env.GMAIL_CLIENT_SECRET!,
      refresh_token: env.GMAIL_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`gmail token refresh failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function gmailFetch(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken(env);
  return fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** RFC 2047 encode a header value when it contains non-ASCII characters. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  // B-encoding requires standard padded base64 (RFC 2045), not base64url.
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}

/**
 * A send failure where `ambiguous` means Gmail may have accepted the message
 * even though we saw an error (5xx / network drop mid-request). Callers must
 * NOT blindly retry ambiguous failures — that risks duplicate sends.
 */
export class GmailSendError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly ambiguous: boolean,
  ) {
    super(message);
    this.name = 'GmailSendError';
  }
}

export interface SendArgs {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
  inReplyTo?: string; // RFC 822 Message-ID of the message being replied to
  references?: string;
  /** outreach sends set this: adds a List-Unsubscribe mailto header (sender-guideline compliance) */
  listUnsubscribe?: boolean;
}

export async function gmailSend(env: Env, args: SendArgs): Promise<{ id: string; threadId: string }> {
  const from = env.SENDER_NAME
    ? `"${env.SENDER_NAME.replace(/"/g, '')}" <${env.SENDER_EMAIL}>`
    : `${env.SENDER_EMAIL}`;
  const lines = [
    `From: ${from}`,
    `To: ${args.to}`,
    `Subject: ${encodeHeader(args.subject)}`,
  ];
  if (args.inReplyTo) lines.push(`In-Reply-To: ${args.inReplyTo}`);
  if (args.references) lines.push(`References: ${args.references}`);
  if (args.listUnsubscribe && env.SENDER_EMAIL) {
    lines.push(`List-Unsubscribe: <mailto:${env.SENDER_EMAIL}?subject=unsubscribe>`);
  }
  lines.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit', '', args.body);

  const raw = base64url(new TextEncoder().encode(lines.join('\r\n')));
  const payload: Record<string, string> = { raw };
  if (args.threadId) payload.threadId = args.threadId;

  // Token refresh failures happen BEFORE the send and throw a plain Error
  // (unambiguous: nothing was sent). Only the send request itself can be
  // ambiguous.
  const token = await getAccessToken(env);
  let res: Response;
  try {
    res = await fetch(`${GMAIL_API}/messages/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new GmailSendError(`gmail send network error: ${String(err)}`, null, true);
  }
  if (!res.ok) {
    throw new GmailSendError(`gmail send failed: ${res.status} ${await res.text()}`, res.status, res.status >= 500);
  }
  const data = (await res.json()) as { id: string; threadId: string };
  return data;
}

/** Fetch Message-ID / References of the last message in a thread, for reply headers. */
export async function gmailThreadReplyHeaders(
  env: Env,
  threadId: string,
): Promise<{ inReplyTo?: string; references?: string }> {
  const res = await gmailFetch(
    env,
    `/threads/${threadId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
  );
  if (!res.ok) return {};
  const data = (await res.json()) as {
    messages?: { payload?: { headers?: { name: string; value: string }[] } }[];
  };
  const last = data.messages?.[data.messages.length - 1];
  const headers = last?.payload?.headers ?? [];
  const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
  const msgId = get('Message-ID');
  const prevRefs = get('References');
  if (!msgId) return {};
  return { inReplyTo: msgId, references: prevRefs ? `${prevRefs} ${msgId}` : msgId };
}

export async function gmailGetProfile(env: Env): Promise<{ historyId: string; emailAddress: string }> {
  const res = await gmailFetch(env, '/profile');
  if (!res.ok) throw new Error(`gmail profile failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { historyId: string; emailAddress: string };
}

export interface HistoryResult {
  messageIds: string[];
  historyId: string | null;
  invalidCursor: boolean;
}

/** List message ids added to INBOX since the stored cursor. */
export async function gmailListHistory(env: Env, startHistoryId: string): Promise<HistoryResult> {
  const messageIds = new Set<string>();
  let historyId: string | null = null;
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded',
      labelId: 'INBOX',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await gmailFetch(env, `/history?${params.toString()}`);
    if (res.status === 404) return { messageIds: [], historyId: null, invalidCursor: true };
    if (!res.ok) throw new Error(`gmail history failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      history?: { messagesAdded?: { message: { id: string } }[] }[];
      historyId?: string;
      nextPageToken?: string;
    };
    for (const h of data.history ?? []) {
      for (const m of h.messagesAdded ?? []) messageIds.add(m.message.id);
    }
    if (data.historyId) historyId = data.historyId;
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return { messageIds: [...messageIds], historyId, invalidCursor: false };
}

/** Fallback when the history cursor is lost: recent inbox messages (2 days). */
export async function gmailListRecentInbox(env: Env): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ q: 'in:inbox newer_than:2d', maxResults: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await gmailFetch(env, `/messages?${params.toString()}`);
    if (!res.ok) throw new Error(`gmail list failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { messages?: { id: string }[]; nextPageToken?: string };
    for (const m of data.messages ?? []) ids.push(m.id);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  fromEmail: string | null;
  subject: string;
  bodyText: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function extractText(part: GmailPart | undefined, preferred: string): string | null {
  if (!part) return null;
  if (part.mimeType === preferred && part.body?.data) return decodeBase64url(part.body.data);
  for (const p of part.parts ?? []) {
    const found = extractText(p, preferred);
    if (found) return found;
  }
  return null;
}

export async function gmailGetMessage(env: Env, id: string): Promise<ParsedMessage> {
  const res = await gmailFetch(env, `/messages/${id}?format=full`);
  if (!res.ok) throw new Error(`gmail get message failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    id: string;
    threadId: string;
    labelIds?: string[];
    payload?: GmailPart & { headers?: { name: string; value: string }[] };
    snippet?: string;
  };
  const headers = data.payload?.headers ?? [];
  const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  const fromRaw = get('From');
  const fromMatch = fromRaw.match(/<([^>]+)>/);
  const fromEmail = (fromMatch ? fromMatch[1] : fromRaw).trim().toLowerCase() || null;
  const bodyText =
    extractText(data.payload, 'text/plain') ??
    extractText(data.payload, 'text/html') ??
    data.snippet ??
    '';
  return {
    id: data.id,
    threadId: data.threadId,
    labelIds: data.labelIds ?? [],
    fromEmail,
    subject: get('Subject'),
    bodyText,
  };
}

/**
 * Owner-facing notification (interested alerts, daily recap). Always sends for
 * real — these contain no lead-facing content, so DRY_RUN does not apply.
 * Falls back to console logging when Gmail is not configured.
 */
export async function sendOwnerEmail(env: Env, subject: string, body: string): Promise<boolean> {
  if (!env.RECAP_EMAIL || !gmailConfigured(env)) {
    console.log(`[owner-email fallback] subject=${subject}\n${body}`);
    return false;
  }
  await gmailSend(env, { to: env.RECAP_EMAIL, subject, body });
  return true;
}
