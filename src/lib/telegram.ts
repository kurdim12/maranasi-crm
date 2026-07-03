// Optional Telegram notifications: interested replies + breaker trips, and a
// recap mirror. Owner-facing only — never lead-facing, never a send channel.
import type { Env } from '../env';

export function telegramConfigured(env: Env): boolean {
  return !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

/** Fire-and-forget; failures are logged by callers, never thrown. */
export async function sendTelegram(env: Env, text: string): Promise<boolean> {
  if (!telegramConfigured(env)) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000) }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
