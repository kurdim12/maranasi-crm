// Serves the dashboard client (src/client/**, bundled by wrangler as Text
// modules — see wrangler.toml [[rules]]). No build step: real .js/.css files
// shipped verbatim. Cache policy: no-cache + ETag, so every deploy is picked
// up on the next load while unchanged files still 304.
import { Hono } from 'hono';
import type { Env } from '../env';
import appCss from '../client/app.css';
import coreJs from '../client/core.js';
import drawerJs from '../client/drawer.js';
import appJs from '../client/app.js';
import tabToday from '../client/tab-today.js';
import tabInbox from '../client/tab-inbox.js';
import tabLeads from '../client/tab-leads.js';
import tabPipeline from '../client/tab-pipeline.js';
import tabAnalytics from '../client/tab-analytics.js';
import tabSystem from '../client/tab-system.js';

const JS = 'text/javascript; charset=utf-8';
const CSS = 'text/css; charset=utf-8';

const FILES: Record<string, { body: string; type: string }> = {
  'app.css': { body: appCss, type: CSS },
  'core.js': { body: coreJs, type: JS },
  'drawer.js': { body: drawerJs, type: JS },
  'app.js': { body: appJs, type: JS },
  'tab-today.js': { body: tabToday, type: JS },
  'tab-inbox.js': { body: tabInbox, type: JS },
  'tab-leads.js': { body: tabLeads, type: JS },
  'tab-pipeline.js': { body: tabPipeline, type: JS },
  'tab-analytics.js': { body: tabAnalytics, type: JS },
  'tab-system.js': { body: tabSystem, type: JS },
};

const etags = new Map<string, string>();

async function etagFor(name: string, body: string): Promise<string> {
  const hit = etags.get(name);
  if (hit) return hit;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const tag = `"${[...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
  etags.set(name, tag);
  return tag;
}

export const assets = new Hono<{ Bindings: Env }>();

assets.get('/:file', async (c) => {
  const file = c.req.param('file');
  const entry = FILES[file];
  if (!entry) return c.text('not found', 404);
  const tag = await etagFor(file, entry.body);
  if (c.req.header('if-none-match') === tag) {
    return new Response(null, { status: 304, headers: { etag: tag } });
  }
  return new Response(entry.body, {
    headers: {
      'content-type': entry.type,
      etag: tag,
      'cache-control': 'no-cache',
    },
  });
});
