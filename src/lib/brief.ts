// AI company brief + ICP fit score, built from crawled site text at
// enrichment time (and on demand from the drawer). Hard rule: only facts
// derivable from the provided text — unknowns stay empty, never invented.
import type { Env, Lead } from '../env';
import { logActivity } from './activity';
import { llmText, parseJsonLoose } from './llm';

export const DEFAULT_ICP =
  'Venues, event agencies, exhibition organizers and wedding planners in Vietnam and Thailand ' +
  'that host or produce B2B/corporate events and could partner with an events production company ' +
  'on brand activations, staging, and sponsor experiences.';

export interface Brief {
  what_they_do: string;
  event_types: string[];
  size_signals: string[];
  hook_angle: string;
  decision_makers: { name: string; title: string }[];
}

export async function getIcp(env: Env): Promise<string> {
  const v = await env.KV.get('config:icp');
  return v?.trim() || DEFAULT_ICP;
}

/** Clamp/validate whatever the model returned into a safe Brief + score. */
export function normalizeBrief(raw: unknown): { brief: Brief; fit_score: number | null } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, cap = 300): string => (typeof v === 'string' ? v.slice(0, cap) : '');
  const arr = (v: unknown, cap = 6): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, cap).map((x) => (x as string).slice(0, 120)) : [];
  const dms = Array.isArray(o.decision_makers)
    ? (o.decision_makers as unknown[])
        .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
        .slice(0, 5)
        .map((d) => ({ name: str(d.name, 80), title: str(d.title, 80) }))
        .filter((d) => d.name)
    : [];
  let fit: number | null = null;
  const rawFit = Number(o.fit_score);
  if (Number.isFinite(rawFit)) fit = Math.max(1, Math.min(5, Math.round(rawFit)));
  return {
    brief: {
      what_they_do: str(o.what_they_do, 400),
      event_types: arr(o.event_types),
      size_signals: arr(o.size_signals),
      hook_angle: str(o.hook_angle, 300),
      decision_makers: dms,
    },
    fit_score: fit,
  };
}

/**
 * Build + persist the brief/fit_score/socials for a lead. Returns null when
 * there is no text to work from or no LLM provider. Never throws.
 */
export async function buildBrief(
  env: Env,
  lead: Lead,
  siteText: string,
  socials: Record<string, string>,
): Promise<{ brief: Brief; fit_score: number | null } | null> {
  try {
    if (!siteText || siteText.trim().length < 80) return null;
    const icp = await getIcp(env);
    const out = await llmText(
      env,
      'fast',
      'You analyze a company website\'s text for a B2B events CRM. Return STRICT JSON only:\n' +
        '{"what_they_do": string, "event_types": string[], "size_signals": string[], ' +
        '"hook_angle": string, "decision_makers": [{"name": string, "title": string}], "fit_score": 1-5}\n' +
        'HARD RULES: use ONLY facts stated in the provided text — if something is not in the text, ' +
        'return "" or [] for it; NEVER invent names, numbers or claims. hook_angle = one concrete, ' +
        'text-grounded opener angle for a partnership email (max 2 sentences of substance). ' +
        `fit_score judges the company against this ICP: "${icp}" (5 = perfect fit, 1 = not a fit).`,
      `COMPANY: ${lead.company_name} (${lead.city ?? ''} ${lead.country ?? ''})\nWEBSITE TEXT:\n${siteText.slice(0, 12_000)}`,
      1024,
    );
    if (out === null) return null;
    const parsed = normalizeBrief(parseJsonLoose(out));
    if (!parsed.brief.what_they_do && !parsed.brief.hook_angle) return null;

    await env.DB.prepare(
      "UPDATE leads SET brief = ?, fit_score = ?, socials = ?, updated_at = datetime('now') WHERE id = ?",
    )
      .bind(
        JSON.stringify(parsed.brief),
        parsed.fit_score,
        Object.keys(socials).length ? JSON.stringify(socials) : null,
        lead.id,
      )
      .run();
    await logActivity(env.DB, 'system', 'brief_built', lead.id, {
      fit_score: parsed.fit_score,
      hook: parsed.brief.hook_angle.slice(0, 120),
    });
    return parsed;
  } catch (e) {
    console.error(`[brief] lead ${lead.id}:`, e);
    return null;
  }
}
