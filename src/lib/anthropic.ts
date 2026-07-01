import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';

// Model choices are product requirements (see project brief):
//   - CRM agent + recap writer: claude-sonnet-4-6
//   - email personalization + reply classification: claude-haiku-4-5-20251001
export const MODEL_AGENT = 'claude-sonnet-4-6';
export const MODEL_FAST = 'claude-haiku-4-5-20251001';

export function claudeClient(env: Env): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Parse model JSON output, tolerating accidental markdown fences. */
export function parseJsonLoose<T>(raw: string): T | null {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1];
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
