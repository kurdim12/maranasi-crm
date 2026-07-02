// Dashboard-managed configuration. Every integration credential can come from
// two places, in precedence order:
//   1. a Worker env var / encrypted secret (wrangler or the Cloudflare UI)
//   2. KV key `secret:{NAME}` — set from the dashboard Settings tab
// The two Worker entry points (fetch + scheduled) resolve KV fallbacks into
// the env object once per invocation, so all downstream code keeps reading
// plain `env.X`.
import type { Env } from '../env';

export const MANAGED_KEYS = [
  'GOOGLE_PLACES_API_KEY',
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'GMAIL_REFRESH_TOKEN',
  'RECAP_EMAIL',
  'SENDER_EMAIL',
  'SENDER_NAME',
  'VERIFIER_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL_AGENT',
  'OPENROUTER_MODEL_FAST',
  'ANTHROPIC_API_KEY',
] as const;
export type ManagedKey = (typeof MANAGED_KEYS)[number];

// Values that are configuration rather than credentials — safe to echo back
// to the dashboard unmasked.
const NON_SECRET = new Set<ManagedKey>([
  'RECAP_EMAIL',
  'SENDER_EMAIL',
  'SENDER_NAME',
  'OPENROUTER_MODEL_AGENT',
  'OPENROUTER_MODEL_FAST',
]);

export function isManagedKey(name: string): name is ManagedKey {
  return (MANAGED_KEYS as readonly string[]).includes(name);
}

// Per-isolate cache so a dashboard page load doesn't do 12 KV reads per call.
let cache: { values: Partial<Record<ManagedKey, string>>; at: number } | null = null;
const CACHE_MS = 20_000;

export function invalidateConfigCache(): void {
  cache = null;
}

async function kvValues(env: Env): Promise<Partial<Record<ManagedKey, string>>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values;
  const values: Partial<Record<ManagedKey, string>> = {};
  await Promise.all(
    MANAGED_KEYS.map(async (key) => {
      const v = await env.KV.get(`secret:${key}`);
      if (v) values[key] = v;
    }),
  );
  cache = { values, at: Date.now() };
  return values;
}

// Which keys on a resolved env object came from KV rather than real env vars
// (so the Settings tab can report the true source after merging).
const kvProvenance = new WeakMap<object, Set<ManagedKey>>();

/** Returns env with KV-stored settings filled in for any unset env var. */
export async function withKvSecrets(env: Env): Promise<Env> {
  const kv = await kvValues(env);
  const merged: Record<string, unknown> = { DB: env.DB, KV: env.KV };
  for (const [k, v] of Object.entries(env)) merged[k] = v;
  const fromKv = new Set<ManagedKey>();
  for (const key of MANAGED_KEYS) {
    if (!merged[key] && kv[key]) {
      merged[key] = kv[key];
      fromKv.add(key);
    }
  }
  kvProvenance.set(merged, fromKv);
  return merged as unknown as Env;
}

export interface SettingInfo {
  key: ManagedKey;
  source: 'env' | 'dashboard' | 'unset';
  /** masked for credentials; full value for non-secret config */
  preview: string | null;
}

export async function listSettings(env: Env): Promise<SettingInfo[]> {
  const kv = await kvValues(env);
  const fromKv = kvProvenance.get(env as unknown as object) ?? new Set<ManagedKey>();
  return MANAGED_KEYS.map((key) => {
    const envVal = (env as unknown as Record<string, string | undefined>)[key];
    const kvVal = kv[key];
    const value = envVal || kvVal || null;
    const source: SettingInfo['source'] =
      envVal && !fromKv.has(key) ? 'env' : kvVal ? 'dashboard' : envVal ? 'env' : 'unset';
    let preview: string | null = null;
    if (value) {
      preview = NON_SECRET.has(key)
        ? value
        : value.length > 8
          ? `${value.slice(0, 4)}…${value.slice(-4)}`
          : '••••';
    }
    return { key, source, preview };
  });
}

export async function putSetting(env: Env, key: ManagedKey, value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) await env.KV.put(`secret:${key}`, trimmed);
  else await env.KV.delete(`secret:${key}`);
  invalidateConfigCache();
}
