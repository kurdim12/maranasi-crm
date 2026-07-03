export interface Env {
  DB: D1Database;
  KV: KVNamespace;

  // vars
  DRY_RUN: string; // "true" | "false"
  DAILY_SEND_CAP: string; // default "20"

  // secrets
  ADMIN_API_KEY: string;
  OPENROUTER_API_KEY?: string; // preferred LLM provider when set
  OPENROUTER_MODEL_AGENT?: string; // default anthropic/claude-sonnet-4.6
  OPENROUTER_MODEL_FAST?: string; // default anthropic/claude-haiku-4.5
  ANTHROPIC_API_KEY?: string; // fallback provider (Anthropic direct)
  TELEGRAM_BOT_TOKEN?: string; // optional owner notifications
  TELEGRAM_CHAT_ID?: string;
  GOOGLE_PLACES_API_KEY?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  RECAP_EMAIL?: string;
  SENDER_EMAIL?: string;
  SENDER_NAME?: string;
  VERIFIER_API_KEY?: string;
}

export function isDryRun(env: Env): boolean {
  return env.DRY_RUN !== 'false';
}

export interface Lead {
  id: number;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  email_status: 'unverified' | 'verified' | 'invalid' | 'bounced';
  phone: string | null;
  phone_status: 'unknown' | 'valid_format' | 'reached' | 'unresponsive';
  website: string | null;
  domain: string | null;
  category: string | null;
  city: string | null;
  country: string | null;
  timezone: string;
  source: string;
  status: string;
  confirmed: number;
  needs_call: number;
  sequence_step: number;
  next_action_at: string | null;
  last_contacted_at: string | null;
  drop_reason: string | null;
  notes: string | null;
  brief: string | null; // JSON Brief (src/lib/brief.ts)
  fit_score: number | null; // 1..5 vs the ICP
  socials: string | null; // JSON {instagram?, facebook?, linkedin?}
  preferred_channel: string | null; // whatsapp | zalo | line | email
  line_id: string | null;
  created_at: string;
  updated_at: string;
}

export function nowIso(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function isoPlus(hours: number, from?: Date): string {
  const d = from ? new Date(from) : new Date();
  d.setTime(d.getTime() + hours * 3600 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
