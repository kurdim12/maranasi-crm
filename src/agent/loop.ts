import type { Env } from '../env';
import { runToolLoop } from '../lib/llm';
import { CRM_AGENT_PROMPT } from '../prompts/crmAgent';
import { executeTool, TOOL_DEFINITIONS } from './tools';

const MAX_TOOL_ITERATIONS = 8;

export interface AgentResult {
  reply: string;
  /** provider-specific chat history; the dashboard round-trips it verbatim */
  history: unknown[];
}

export async function runCrmAgent(env: Env, message: string, history: unknown[] = []): Promise<AgentResult> {
  return runToolLoop(env, {
    system: CRM_AGENT_PROMPT,
    tools: TOOL_DEFINITIONS,
    message,
    history,
    maxIterations: MAX_TOOL_ITERATIONS,
    execute: (name, input) => executeTool(env, name, input),
  });
}
