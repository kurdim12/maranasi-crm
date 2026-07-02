# Maranasi Outreach Engine — Complete Project Brief

You are working on the **Maranasi Outreach Engine**: a production-deployed B2B lead-sourcing, cold-outreach and CRM system built for Maranasi Events (events & brand-activation company in Amman, Jordan, UTC+3), targeting event-industry companies (venues, event agencies, exhibition organizers, wedding planners) in **Vietnam and Thailand** (leads live in UTC+7).

- **Repo:** `kurdim12/maranasi-crm`, branch `claude/maranasi-outreach-engine-c70z51` (default branch; every push auto-deploys to production via Cloudflare Workers Builds).
- **Production Worker:** `maranasi-crm` · D1 database `maranasi-crm` (id `d1f958ff-a5d3-4e7d-8b69-f15dc774db83`) · KV namespace (id `35de807c8d26456292f0852508e0595d`).
- **Stack:** Cloudflare Workers + Hono (TypeScript strict, no framework build — the dashboard is a single served HTML string), D1 (SQLite), KV, one cron trigger `*/15 * * * *`, Gmail API (OAuth refresh token), Google Places API (New), OpenRouter for all LLM calls, wrangler v4, vitest (30 tests), GitHub Actions CI (typecheck + tests on every push).

## Core architecture

**Single cron, internal dispatcher** (`src/jobs/dispatcher.ts`): one `*/15` trigger; the dispatcher decides by UTC time — reply watcher every tick; sequence engine at :00/:30; lead sourcing daily 01:00 UTC; owner recap daily 03:30 UTC. Every job records a KV heartbeat; 3 consecutive failures of a job send one owner alert email per 6 h.

**Database** (`migrations/`): `leads`, `email_log`, `templates` (3-step sequence, `{{placeholders}}`), `suppression`, `activities` (every write in the system is audited here), `search_queries` (10 seeded VN/TH queries), `scrape_runs`, `users`.

**Lead state machine** (`src/lib/stateMachine.ts`): `new → enriched → verified → contacted → interested / not_interested / opted_out / unresponsive_email / invalid_email / dropped`, enforced by a transitions map with compare-and-swap status updates (`WHERE id=? AND status=?`, throws on conflict). **Hard product rules:** the system NEVER auto-drops a lead — email silence after 3 steps only flags `unresponsive_email + needs_call=1`; only the CRM agent may set `dropped`, and only after a human has logged a phone call outcome of `unresponsive` (verified against the latest `call_outcome` activity).

**Sequence engine** (`src/jobs/sequence.ts`): eligibility = status verified/contacted, step < 3, email verified, `next_action_at` due, not suppressed, **source != 'demo'**. Guardrails: Mon–Fri 09:00–16:30 send window in the lead's timezone; daily cap (default 20, KV-overridable 0–500 from the dashboard); verify-before-send; idempotent claim UPDATE (step+status guard) before sending; ambiguous-send-failure policy (5xx/network keeps the claim to avoid double-send, 4xx reverts it); Gmail threading only reuses thread ids from real sends (`dry_run=0`) so dry-run threads can never poison live threads; step 2/3 send as `Re:` replies in-thread. `previewNextEmail()` renders exactly what would be sent (same template + LLM personalization path) with zero side effects.

**Reply watcher** (`src/jobs/replyWatcher.ts`): Gmail history cursor with hold-on-failure (forces re-sync after 3 stalls); record-then-apply ordering (email logged before state changes); LLM classification of replies (interested / not_interested / ooo / bounce / opt_out / other) driving state transitions, suppression on opt-out/bounce, owner alert on interested; **bounce circuit breaker** — trailing-7-day bounce rate > 3% (min 20 real sends) auto-pauses sending and emails the owner.

**LLM layer** (`src/lib/llm.ts`): OpenRouter preferred (OpenAI-format chat/completions incl. tool_calls), Anthropic SDK fallback. Models: `anthropic/claude-sonnet-4.6` (CRM agent, recap), `anthropic/claude-haiku-4.5` (personalizer, classifier); env-overridable.

**CRM agent** (`src/agent/`): chat agent in the dashboard with 13 tools — query/get/update leads (whitelisted fields; `phone_status='unresponsive'` is rejected so the phone gate can't be faked), log_call_outcome, drop_lead (gated as above), pause_sequence, resume_sequence, suppress_email, preview_next_email, draft_reply (returns a draft ONLY, never sends; treats conversation content as data — prompt-injection defense), pipeline stats, weekly recap. Every tool write is audited.

**Auth** (`src/lib/auth.ts`, `src/lib/password.ts`): username/password accounts (PBKDF2-SHA256, 100k iterations, WebCrypto), KV-backed session cookies (`mo_session`, 7 d, HttpOnly/Secure/Lax), login lockout (10 fails / 15 min), plus `X-API-Key` (constant-time compare) as a fallback for automation. Production accounts: `admin` and `operator` (passwords delivered in chat, owner advised to change them in the dashboard).

**Dashboard-managed settings** (`src/lib/config.ts` + Settings tab): 12 managed keys stored in KV as `secret:{NAME}`, merged into `env` at both Worker entry points (fetch + scheduled) with provenance tracking (secret / dashboard / unset) and masked previews; ~20 s propagation. Live integration tests run from the Worker itself (Places, Gmail, LLM, verifier). **Guided Gmail connect:** paste OAuth client id/secret → Worker builds the Google consent URL with a state nonce → `/auth/gmail/callback` exchanges the code, stores the refresh token, auto-fills SENDER_EMAIL.

## Dashboard (mobile-first, single file `src/routes/dashboard.ts`)

Dark UI on a validated dataviz palette (status colors always paired with text labels). Login page (user/pass + API-key fallback). 10 KPI tiles (leads, verified, contacted, interested, needs-call, sent 7d, replies 7d, sent-today/cap, cron tick, errors 24h). **8 tabs:**

1. **Leads** — Table and Kanban **Board** views (New / Verified / Contacted / Interested / Needs call / Closed); filters (status, country, needs-call, search); **Add lead** modal (inline email verification); **Import CSV** (pasted CSV, header-alias mapping, 200-row cap, dedupe vs existing leads and suppression); **Export CSV** (spreadsheet-formula injection neutralized). Lead **drawer**: contact editing, ✓ Call reached / ✗ no answer (the human phone gate), re-verify email, preview next email, pause/resume follow-ups, full timeline (emails + activities), and a **Reply/compose box that sends real Gmail** threaded onto the actual conversation (suppression checked first; demo leads rejected).
2. **Mail** — unified mailbox over every logged email (sequence sends, manual sends, inbound replies) joined with its lead: direction icons, step/manual + DRY RUN + classification badges, sent/received and real-vs-test filters, search, pagination; click-through to the lead drawer. Backed by `GET /api/emails`.
3. **Analytics** — pipeline funnel, 30-day sent-vs-replies SVG chart, reply/bounce/interested KPIs, leads by country.
4. **Templates** — edit the 3 sequence steps (placeholder copy flagged "replace before go-live"; each ends with an opt-out line).
5. **Suppression** — list/add; deletes are manual-only.
6. **Scrape runs**, 7. **Activity** (full audit trail), 8. **Settings** — integration tests, daily-cap control, **Demo data seed/remove**, Gmail connect, managed settings table.

CRM-agent chat panel with quick chips (Weekly recap / Who needs a call? / Pipeline stats); on phones it becomes a full-screen overlay behind a floating ✦ button; tabs wrap so all 8 are always visible; tables/board scroll horizontally; drawer is full-width.

## Demo/showcase data (currently seeded in production)

14 sample leads covering every pipeline stage (incl. a gated drop with the phone-call story), 19 realistic VN/TH mail threads, activity history, one scrape run. All keyed `source='demo'` / `trigger='demo'` / reserved `.example.com` addresses. **Four guards make demo leads unsendable:** sequence engine excludes `source='demo'`; the manual send endpoint rejects them; `.example.com` is reserved/undeliverable; demo mail is `dry_run=1` with no Gmail ids. One-click **Seed / Remove** in Settings (seed guard is an atomic single-statement NOT-EXISTS claim; removal deletes only demo-keyed rows). **Remove demo data before go-live.**

## Verification & review history

- 30 vitest tests (state machine, guards/window/validation, passwords, CSV) + typecheck, run in CI on every push.
- Playwright smoke-tested and screenshotted at desktop (1440px) and phone (390px) viewports; all endpoints curl-tested against a local wrangler dev server.
- Two multi-agent adversarial review workflows over the diffs (find → verify per finding). Confirmed-and-fixed findings include: RFC 2047 subject padding; dry-run thread-id poisoning of real sends; suppression checked before the Gmail-connected check on manual send; CSV export formula injection; XSS escaping audit of all dashboard interpolation; **demo leads becoming real send targets after DRY_RUN flips (critical — fixed with the engine exclusion)**; demo-removal suppression over-deletion; seed race (TOCTOU); negative `limit` full-table dump on /api/emails; stale mail pagination offset; swallowed error messages in the demo card.

## Current production state & go-live checklist

- `DRY_RUN="true"` (wrangler var). **Only the owner flips it to "false"** in Cloudflare → Workers → maranasi-crm → Settings → Variables — never the AI. While true, the whole pipeline runs but logs sends instead of sending.
- Set in production: `OPENROUTER_API_KEY` (owner should rotate it — it was pasted in chat), accounts admin/operator.
- **Still needed from the owner (all via dashboard → Settings):** `GOOGLE_PLACES_API_KEY` (enables sourcing), Gmail connect (client id + secret → consent flow; enables sending/watching), optionally `VERIFIER_API_KEY` (ZeroBounce, recommended before real sends), `RECAP_EMAIL`/`SENDER_NAME`; change both account passwords; remove demo data before go-live.
- Go-live ramp: daily cap 10/day week 1 → 20 → 35 → 50; never raise faster than weekly. Bounce breaker will auto-pause at 3%.

## Non-negotiable ground rules (from the original spec)

Deliverability guardrails are product requirements, not suggestions. Plain-text email, max one link, no tracking pixels. No auto-calling/WhatsApp, no LinkedIn scraping, no auto-deleting leads. Every state change audited in `activities`. The human phone gate protects every drop. DRY_RUN defaults on and is only ever flipped by the human owner.
