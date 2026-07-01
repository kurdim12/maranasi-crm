import type { Context, Next } from 'hono';
import type { Env } from '../env';

// Constant-time comparison: hash both values to fixed-length digests, then
// XOR-compare every byte. Hashing removes length leakage; the XOR loop never
// short-circuits.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
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

export function apiKeyAuth() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const provided = c.req.header('X-API-Key');
    const expected = c.env.ADMIN_API_KEY;
    if (!expected) {
      return c.json({ error: 'server misconfigured: ADMIN_API_KEY not set' }, 500);
    }
    if (!provided || !(await timingSafeEqual(provided, expected))) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}
