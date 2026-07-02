import type { Env, Lead } from '../env';
import { nowIso } from '../env';
import { logActivity, logError } from '../lib/activity';
import { buildBrief } from '../lib/brief';
import { findEmailForSite, normalizeDomain } from '../lib/crawler';
import { placesTextSearch } from '../lib/places';
import { transitionLead } from '../lib/stateMachine';
import { verifyLead } from '../lib/verify';

interface QueryRow {
  id: number;
  query: string;
  city: string | null;
  country: string | null;
  category: string | null;
}

// Keep well under the 15-minute wall-clock limit for scheduled Workers.
const RUN_BUDGET_MS = 9 * 60 * 1000;

function timezoneFor(country: string | null): string {
  return country === 'VN' ? 'Asia/Ho_Chi_Minh' : 'Asia/Bangkok';
}

export interface ScrapeStats {
  runId: number;
  queriesRun: number;
  placesFound: number;
  newLeads: number;
  skippedDupes: number;
}

export async function runScrape(
  env: Env,
  trigger: 'cron' | 'manual',
  queryId?: number,
  /** absolute epoch-ms deadline (e.g. from the cron invocation start) */
  deadlineMs?: number,
): Promise<ScrapeStats> {
  const db = env.DB;
  const run = await db
    .prepare("INSERT INTO scrape_runs (trigger, status) VALUES (?, 'running') RETURNING id")
    .bind(trigger)
    .first<{ id: number }>();
  const runId = run!.id;
  const startedAt = Date.now();
  const deadline = Math.min(startedAt + RUN_BUDGET_MS, deadlineMs ?? Number.POSITIVE_INFINITY);

  let queriesRun = 0;
  let placesFound = 0;
  let newLeads = 0;
  let skippedDupes = 0;
  let truncated = false;
  const enrichedLeadIds: number[] = [];

  try {
    if (!env.GOOGLE_PLACES_API_KEY) throw new Error('GOOGLE_PLACES_API_KEY not configured');

    const queries = queryId
      ? await db.prepare('SELECT * FROM search_queries WHERE id = ? AND active = 1').bind(queryId).all<QueryRow>()
      : await db.prepare('SELECT * FROM search_queries WHERE active = 1 ORDER BY id').all<QueryRow>();

    for (const q of queries.results) {
      if (Date.now() > deadline) {
        truncated = true;
        break;
      }
      let places;
      try {
        places = await placesTextSearch(env, q.query);
      } catch (err) {
        await logError(db, `scrape query ${q.id}`, err);
        continue;
      }
      queriesRun++;
      placesFound += places.length;
      await db.prepare('UPDATE search_queries SET last_run_at = ? WHERE id = ?').bind(nowIso(), q.id).run();

      for (const place of places) {
        if (Date.now() > deadline) {
          truncated = true;
          break;
        }
        try {
        const domain = normalizeDomain(place.website);

        // Dedup by domain against existing leads.
        if (domain) {
          const dupe = await db.prepare('SELECT id FROM leads WHERE domain = ?').bind(domain).first();
          if (dupe) {
            skippedDupes++;
            continue;
          }
        } else {
          // no website: dedup by company name within city as a weak fallback
          const dupe = await db
            .prepare('SELECT id FROM leads WHERE company_name = ? AND city IS ?')
            .bind(place.name, q.city)
            .first();
          if (dupe) {
            skippedDupes++;
            continue;
          }
        }

        const inserted = await db
          .prepare(
            `INSERT INTO leads (company_name, phone, website, domain, category, city, country, timezone, source, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'places', 'new') RETURNING id`,
          )
          .bind(
            place.name,
            place.phone,
            place.website,
            domain,
            q.category,
            q.city,
            q.country,
            timezoneFor(q.country),
          )
          .first<{ id: number }>();
        const leadId = inserted!.id;
        newLeads++;
        await logActivity(db, 'system', 'lead_created', leadId, {
          run_id: runId,
          query: q.query,
          website: place.website,
        });

        // Enrich: crawl the site for a contact email (+ text for the brief).
        if (place.website && domain) {
          const crawl = await findEmailForSite(place.website);
          const { email } = crawl;
          // Intelligence is best-effort and must never block enrichment.
          {
            const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first<Lead>();
            if (lead) await buildBrief(env, lead, crawl.text, crawl.socials);
          }
          if (email) {
            const suppressed = await db.prepare('SELECT email FROM suppression WHERE email = ?').bind(email).first();
            const emailTaken = await db.prepare('SELECT id FROM leads WHERE email = ?').bind(email).first();
            if (suppressed || emailTaken) {
              skippedDupes++;
              await logActivity(db, 'system', 'email_skipped', leadId, {
                email,
                reason: suppressed ? 'suppressed' : 'duplicate email',
              });
            } else {
              await db
                .prepare('UPDATE leads SET email = ?, updated_at = ? WHERE id = ?')
                .bind(email, nowIso(), leadId)
                .run();
              const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').bind(leadId).first<Lead>();
              if (lead) {
                await transitionLead(db, lead, 'enriched', {
                  actor: 'system',
                  detail: { email, run_id: runId },
                });
                enrichedLeadIds.push(leadId);
              }
            }
          }
        }
        } catch (err) {
          // Politeness rule: tolerate per-place failures silently (log to the
          // run), never abort the whole run for one bad site or a rare
          // UNIQUE-constraint race with a concurrent run.
          skippedDupes++;
          await logError(db, `scrape place '${place.name}' run ${runId}`, err);
        }
      }
    }

    // Verification runs right after sourcing.
    for (const id of enrichedLeadIds) {
      if (Date.now() > deadline + 60_000) break;
      const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Lead>();
      if (!lead) continue;
      try {
        await verifyLead(env, db, lead);
      } catch (err) {
        await logError(db, `verify lead ${id}`, err);
      }
    }

    await db
      .prepare(
        `UPDATE scrape_runs SET queries_run = ?, places_found = ?, new_leads = ?, skipped_dupes = ?,
         status = 'done', error = ?, finished_at = ? WHERE id = ?`,
      )
      .bind(
        queriesRun,
        placesFound,
        newLeads,
        skippedDupes,
        truncated ? 'truncated: run budget exceeded, remaining queries skipped' : null,
        nowIso(),
        runId,
      )
      .run();
    await logActivity(db, 'system', 'scrape_finished', null, {
      run_id: runId, queriesRun, placesFound, newLeads, skippedDupes, truncated,
    });
  } catch (err) {
    await db
      .prepare(
        `UPDATE scrape_runs SET queries_run = ?, places_found = ?, new_leads = ?, skipped_dupes = ?,
         status = 'failed', error = ?, finished_at = ? WHERE id = ?`,
      )
      .bind(queriesRun, placesFound, newLeads, skippedDupes, String(err), nowIso(), runId)
      .run();
    await logError(db, 'scrape run', err);
  }

  return { runId, queriesRun, placesFound, newLeads, skippedDupes };
}
