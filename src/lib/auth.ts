import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from '../env';

export const SESSION_COOKIE = 'mo_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 days

// Constant-time comparison: hash both values to fixed-length digests, then
// XOR-compare every byte. Hashing removes length leakage; the XOR loop never
// short-circuits.
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const ua = new Uint8Array(da);
  const ub = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

// ---- sessions (KV-backed, cookie-carried) ----

export interface Session {
  username: string;
  created_at: string;
}

export async function createSession(env: Env, username: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.KV.put(
    `session:${token}`,
    JSON.stringify({ username, created_at: new Date().toISOString() } satisfies Session),
    { expirationTtl: SESSION_TTL_SECONDS },
  );
  return token;
}

export async function getSession(env: Env, token: string): Promise<Session | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const raw = await env.KV.get(`session:${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  if (/^[0-9a-f]{64}$/.test(token)) await env.KV.delete(`session:${token}`);
}

/**
 * Auth for /api/*: accepts EITHER the X-API-Key header (constant-time compare,
 * for automation/scripts) OR a valid session cookie from username/password
 * login. Everything else gets 401.
 */
export function apiKeyAuth() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const provided = c.req.header('X-API-Key');
    const expected = c.env.ADMIN_API_KEY;
    if (provided && expected && (await timingSafeEqual(provided, expected))) {
      await next();
      return;
    }
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const session = await getSession(c.env, token);
      if (session) {
        await next();
        return;
      }
    }
    if (!expected) return c.json({ error: 'server misconfigured: ADMIN_API_KEY not set' }, 500);
    return c.json({ error: 'unauthorized' }, 401);
  };
}
