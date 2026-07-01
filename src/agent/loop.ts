import type Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../env';
import { claudeClient, MODEL_AGENT } from '../lib/anthropic';
import { CRM_AGENT_PROMPT } from '../prompts/crmAgent';
import { executeTool, TOOL_DEFINITIONS } from './tools';

const MAX_TOOL_ITERATIONS = 8;

export interface AgentResult {
  reply: string;
  history: Anthropic.MessageParam[];
}

export async function runCrmAgent(
  env: Env,
  message: string,
  history: Anthropic.MessageParam[] = [],
): Promise<AgentResult> {
  const client = claudeClient(env);
  if (!client) {
    return {
      reply: 'CRM agent unavailable: ANTHROPIC_API_KEY is not configured.',
      history,
    };
  }

  const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: message }];
  let reply = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL_AGENT,
      max_tokens: 4096,
      system: CRM_AGENT_PROMPT,
      tools: TOOL_DEFINITIONS,
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
        result = await executeTool(env, block.name, block.input as Record<string, unknown>);
      } catch (err) {
        result = { error: String(err) };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: 'user', content: toolResults });
  }

  if (!reply) {
    reply = 'Stopped after the maximum number of tool steps. Partial work may have been done — ask me to continue.';
  }
  return { reply, history: messages };
}
