import { Hono } from 'hono';
import type { Env } from './env';
import { dispatch } from './jobs/dispatcher';
import { apiKeyAuth } from './lib/auth';
import { withKvSecrets } from './lib/config';
import { api } from './routes/api';
import { auth } from './routes/auth';
import { dev } from './routes/dev';
import { DASHBOARD_HTML } from './routes/dashboard';

const app = new Hono<{ Bindings: Env }>();

// Public: health check, the dashboard shell (holds no data), and the
// login/logout endpoints themselves.
app.get('/health', (c) => c.json({ ok: true, service: 'maranasi-outreach-engine' }));
app.get('/', (c) => c.html(DASHBOARD_HTML));
app.route('/auth', auth);

// Everything under /api requires a session cookie (username/password login)
// or the X-API-Key header (automation).
app.use('/api/*', apiKeyAuth());
app.route('/api', api);
app.route('/api/dev', dev);

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error('[unhandled]', err);
  return c.json({ error: 'internal error' }, 500);
});

export default {
  // Resolve dashboard-managed settings (KV) into env once per invocation so
  // downstream code reads plain env vars regardless of where a key was set.
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(req, await withKvSecrets(env), ctx);
  },
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(withKvSecrets(env).then((resolved) => dispatch(resolved, event.scheduledTime)));
  },
};
