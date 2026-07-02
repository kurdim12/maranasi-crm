// LLM provider layer. Set ONE secret and every model call in the system
// (CRM agent, recap writer, personalizer, classifier) goes through it:
//
//   OPENROUTER_API_KEY   -> OpenRouter (preferred when set)
//   ANTHROPIC_API_KEY    -> Anthropic direct (fallback)
//
// Model roles are fixed by the product brief: 'agent' (CRM agent + recap) and
// 'fast' (personalization + reply classification). On OpenRouter the slugs can
// be overridden with the OPENROUTER_MODEL_AGENT / OPENROUTER_MODEL_FAST vars.
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';

export const ANTHROPIC_MODEL_AGENT = 'claude-sonnet-4-6';
export const ANTHROPIC_MODEL_FAST = 'claude-haiku-4-5-20251001';
const OPENROUTER_DEFAULT_AGENT = 'anthropic/claude-sonnet-4.6';
const OPENROUTER_DEFAULT_FAST = 'anthropic/claude-haiku-4.5';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type LlmRole = 'agent' | 'fast';
export type LlmProvider = 'openrouter' | 'anthropic' | null;

export function llmProvider(env: Env): LlmProvider {
  if (env.OPENROUTER_API_KEY) return 'openrouter';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

function openrouterModel(env: Env, role: LlmRole): string {
  return role === 'agent'
    ? env.OPENROUTER_MODEL_AGENT || OPENROUTER_DEFAULT_AGENT
    : env.OPENROUTER_MODEL_FAST || OPENROUTER_DEFAULT_FAST;
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

// ---------------------------------------------------------------- OpenRouter

interface OrToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OrMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OrToolCall[];
  tool_call_id?: string;
}

interface OrResponse {
  choices?: { message?: OrMessage; finish_reason?: string }[];
  error?: { message?: string };
}

async function openrouterChat(env: Env, body: Record<string, unknown>): Promise<OrMessage> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'content-type': 'application/json',
      // Optional OpenRouter attribution headers
      'HTTP-Referer': 'https://github.com/kurdim12/maranasi-crm',
      'X-Title': 'Maranasi Outreach Engine',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`openrouter ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const data = (await res.json()) as OrResponse;
  if (data.error?.message) throw new Error(`openrouter: ${data.error.message}`);
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error('openrouter: empty response');
  return msg;
}

// ------------------------------------------------------------------- Public

/**
 * One-shot text completion (personalizer, classifier, recap writer).
 * Returns null when no provider is configured; throws on API errors.
 */
export async function llmText(
  env: Env,
  role: LlmRole,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string | null> {
  const provider = llmProvider(env);
  if (!provider) return null;

  if (provider === 'openrouter') {
    const msg = await openrouterChat(env, {
      model: openrouterModel(env, role),
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return typeof msg.content === 'string' ? msg.content : '';
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: role === 'agent' ? ANTHROPIC_MODEL_AGENT : ANTHROPIC_MODEL_FAST,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
}

export interface ToolLoopResult {
  reply: string;
  /** provider-specific message history; treat as opaque and round-trip it */
  history: unknown[];
}

/**
 * Multi-turn tool-use loop (the CRM agent). The history format is provider
 * specific — the dashboard just stores and resends it verbatim.
 */
export async function runToolLoop(
  env: Env,
  opts: {
    system: string;
    tools: ToolSpec[];
    message: string;
    history: unknown[];
    maxIterations: number;
    execute: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  },
): Promise<ToolLoopResult> {
  const provider = llmProvider(env);
  if (!provider) {
    return {
      reply: 'CRM agent unavailable: set the OPENROUTER_API_KEY secret (or ANTHROPIC_API_KEY).',
      history: opts.history,
    };
  }
  return provider === 'openrouter' ? openrouterToolLoop(env, opts) : anthropicToolLoop(env, opts);
}

async function openrouterToolLoop(
  env: Env,
  opts: Parameters<typeof runToolLoop>[1],
): Promise<ToolLoopResult> {
  const tools = opts.tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
  const messages: OrMessage[] = [
    ...(opts.history as OrMessage[]).filter((m) => m && m.role !== 'system'),
    { role: 'user', content: opts.message },
  ];
  let reply = '';

  for (let i = 0; i < opts.maxIterations; i++) {
    const msg = await openrouterChat(env, {
      model: openrouterModel(env, 'agent'),
      max_tokens: 4096,
      messages: [{ role: 'system', content: opts.system }, ...messages],
      tools,
    });
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      reply = typeof msg.content === 'string' ? msg.content : '';
      break;
    }
    for (const tc of msg.tool_calls) {
      let result: unknown;
      try {
        const input = tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {};
        result = await opts.execute(tc.function.name, input);
      } catch (err) {
        result = { error: String(err) };
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }

  if (!reply) {
    reply = 'Stopped after the maximum number of tool steps. Partial work may have been done — ask me to continue.';
  }
  return { reply, history: messages };
}

async function anthropicToolLoop(
  env: Env,
  opts: Parameters<typeof runToolLoop>[1],
): Promise<ToolLoopResult> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [
    ...(opts.history as Anthropic.MessageParam[]),
    { role: 'user', content: opts.message },
  ];
  let reply = '';

  for (let i = 0; i < opts.maxIterations; i++) {
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL_AGENT,
      max_tokens: 4096,
      system: opts.system,
      tools: opts.tools as Anthropic.Tool[],
      messages,
    });
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      reply = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      break;
    }
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      let result: unknown;
      try {
        result = await opts.execute(block.name, block.input as Record<string, unknown>);
      } catch (err) {
        result = { error: String(err) };
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  if (!reply) {
    reply = 'Stopped after the maximum number of tool steps. Partial work may have been done — ask me to continue.';
  }
  return { reply, history: messages };
}
