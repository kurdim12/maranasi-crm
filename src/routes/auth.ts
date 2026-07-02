import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from '../env';
import { nowIso } from '../env';
import { logActivity } from '../lib/activity';
import { putSetting } from '../lib/config';
import {
  createSession,
  deleteSession,
  getSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  timingSafeEqual,
} from '../lib/auth';
import { hashPassword, verifyPassword } from '../lib/password';

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string | null;
  active: number;
}

const LOCKOUT_LIMIT = 10;
const LOCKOUT_TTL = 900; // 15 min

// Public auth routes (mounted OUTSIDE the /api middleware).
export const auth = new Hono<{ Bindings: Env }>();

auth.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = (body.username ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!username || !password) return c.json({ error: 'username and password required' }, 400);

  const failKey = `loginfail:${username}`;
  const fails = parseInt((await c.env.KV.get(failKey)) ?? '0', 10);
  if (fails >= LOCKOUT_LIMIT) {
    return c.json({ error: 'too many failed attempts — try again in 15 minutes' }, 429);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ? AND active = 1')
    .bind(username)
    .first<UserRow>();
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !ok) {
    await c.env.KV.put(failKey, String(fails + 1), { expirationTtl: LOCKOUT_TTL });
    await logActivity(c.env.DB, 'owner', 'login_failed', null, { username });
    return c.json({ error: 'invalid username or password' }, 401);
  }

  await c.env.KV.delete(failKey);
  await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), user.id).run();
  const token = await createSession(c.env, user.username);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  await logActivity(c.env.DB, 'owner', 'login_success', null, { username });
  return c.json({ ok: true, username: user.username, display_name: user.display_name });
});

auth.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(c.env, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/** Who am I — lets the dashboard skip the login screen when a session exists. */
auth.get('/me', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const session = await getSession(c.env, token);
    if (session) {
      const user = await c.env.DB.prepare(
        'SELECT username, display_name FROM users WHERE username = ? AND active = 1',
      )
        .bind(session.username)
        .first<{ username: string; display_name: string | null }>();
      if (user) return c.json({ ok: true, username: user.username, display_name: user.display_name });
    }
  }
  const key = c.req.header('X-API-Key');
  if (key && c.env.ADMIN_API_KEY && (await timingSafeEqual(key, c.env.ADMIN_API_KEY))) {
    return c.json({ ok: true, username: 'api-key', display_name: 'API key' });
  }
  return c.json({ error: 'unauthorized' }, 401);
});

/**
 * Gmail OAuth redirect target. The flow starts from the dashboard Settings
 * tab (POST /api/settings/gmail/start); Google redirects here with a code,
 * which we exchange for a refresh token and store as a dashboard setting.
 * Protected by the single-use state nonce created at start.
 */
auth.get('/gmail/callback', async (c) => {
  const page = (title: string, body: string) =>
    c.html(
      `<!doctype html><html><body style="background:#131312;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="max-width:460px;background:#1a1a19;border:1px solid #33322f;border-radius:12px;padding:28px"><h2 style="margin:0 0 10px">${title}</h2><p style="color:#c3c2b7;line-height:1.6">${body}</p><p><a href="/" style="color:#3987e5">Back to the dashboard</a></p></div></body></html>`,
    );

  const state = c.req.query('state') ?? '';
  const code = c.req.query('code');
  const gError = c.req.query('error');
  const valid = state && (await c.env.KV.get(`gmailoauth:${state}`));
  if (!valid) return page('Connect failed', 'Invalid or expired sign-in state. Start again from Settings → Gmail.');
  await c.env.KV.delete(`gmailoauth:${state}`);
  if (gError || !code) return page('Connect failed', `Google returned: ${gError ?? 'no code'}. Start again from Settings.`);
  if (!c.env.GMAIL_CLIENT_ID || !c.env.GMAIL_CLIENT_SECRET) {
    return page('Connect failed', 'Client ID/secret missing — start again from Settings → Gmail.');
  }

  const redirectUri = `${new URL(c.req.url).origin}/auth/gmail/callback`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GMAIL_CLIENT_ID,
      client_secret: c.env.GMAIL_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = (await res.json()) as { refresh_token?: string; access_token?: string; error?: string };
  if (!res.ok || !data.refresh_token) {
    const hint = data.access_token
      ? 'Google returned an access token but no refresh token — remove prior access at myaccount.google.com/permissions and connect again.'
      : `Token exchange failed (${data.error ?? res.status}).`;
    await logActivity(c.env.DB, 'system', 'gmail_oauth_failed', null, { error: data.error ?? res.status });
    return page('Connect failed', hint);
  }

  await putSetting(c.env, 'GMAIL_REFRESH_TOKEN', data.refresh_token);
  // Discover the connected inbox and default the sender address to it.
  let inbox = '';
  try {
    const profRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { authorization: `Bearer ${data.access_token}` },
    });
    const prof = (await profRes.json()) as { emailAddress?: string };
    if (prof.emailAddress) {
      inbox = prof.emailAddress;
      if (!c.env.SENDER_EMAIL) await putSetting(c.env, 'SENDER_EMAIL', prof.emailAddress);
    }
  } catch {
    // profile lookup is cosmetic; the refresh token is already stored
  }
  await logActivity(c.env.DB, 'owner', 'gmail_connected', null, { inbox });
  return page(
    'Gmail connected ✓',
    `The outreach engine can now send and read email${inbox ? ` as <b>${inbox}</b>` : ''}. Set RECAP_EMAIL in Settings if you have not, then use the Test button to confirm.`,
  );
});

/** Change own password (session login required). */
auth.post('/password', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await getSession(c.env, token) : null;
  if (!session) return c.json({ error: 'sign in with username and password first' }, 401);

  const body = (await c.req.json().catch(() => ({}))) as {
    current_password?: string;
    new_password?: string;
  };
  if (!body.current_password || !body.new_password) {
    return c.json({ error: 'current_password and new_password required' }, 400);
  }
  if (body.new_password.length < 8) return c.json({ error: 'new password must be at least 8 characters' }, 400);

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ? AND active = 1')
    .bind(session.username)
    .first<UserRow>();
  if (!user || !(await verifyPassword(body.current_password, user.password_hash))) {
    return c.json({ error: 'current password is incorrect' }, 401);
  }
  const hash = await hashPassword(body.new_password);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, user.id).run();
  await logActivity(c.env.DB, 'owner', 'password_changed', null, { username: user.username });
  return c.json({ ok: true });
});
