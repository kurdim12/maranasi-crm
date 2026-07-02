# Maranasi Outreach Engine

B2B lead sourcing, cold outreach, and CRM for Maranasi Events. Targets
event-industry companies in Vietnam and Thailand. Runs entirely on Cloudflare
Workers (Hono + D1 + KV) with one cron trigger and an internal dispatcher.

```
[1 Sourcing] → [2 Verify] → [3 Sequence Engine] ⇄ [4 Reply Watcher]
                                  │                      │
                                  └──────→ D1 (CRM) ←────┘
                                             │
                       [5 CRM Agent]  [6 Daily Recap]  [7 Dashboard]
```

## Stack

- Cloudflare Workers + Hono (TypeScript, strict)
- D1 (database), KV (config, counters, cursors)
- One cron trigger `*/15 * * * *` → `src/jobs/dispatcher.ts` decides what runs:
  - every tick → Reply Watcher
  - :00 / :30 → Sequence Engine
  - 01:00 UTC → Sourcing (daily scrape)
  - 03:30 UTC → Daily Recap (06:30 Amman)
- Claude API: `claude-sonnet-4-6` (CRM agent, recap), `claude-haiku-4-5-20251001`
  (personalization, reply classification)
- Gmail API (OAuth refresh token) for sending and reading replies
- Google Places API (New) for lead sourcing

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars          # local secrets

# Cloudflare resources: ALREADY PROVISIONED and wired into wrangler.toml
#   D1  maranasi-crm      d1f958ff-a5d3-4e7d-8b69-f15dc774db83 (schema + seeds applied)
#   KV  maranasi-crm-kv   35de807c8d26456292f0852508e0595d

npm run migrate:local                   # local dev schema (remote is already migrated)

# secrets (production)
wrangler secret put ADMIN_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GOOGLE_PLACES_API_KEY
# Gmail secrets: see scripts/gmail-auth.md

npm run dev                             # local
npm run deploy                          # production (requires `wrangler login`)
```

`DRY_RUN=true` by default: every "send" is logged to `email_log`
(`dry_run=1`) and the console instead of hitting Gmail. Only the owner flips
it — see `GOLIVE.md` for the full go-live checklist.

## API

All `/api/*` routes require header `X-API-Key: <ADMIN_API_KEY>`.

| Route | What |
|---|---|
| `GET /` | dashboard (prompts for the key once) |
| `GET /health` | health check (public) |
| `GET /api/leads` | list; filters: `status,country,city,needs_call,q,limit,offset` |
| `GET /api/leads/:id` | lead + emails + activities |
| `PATCH /api/leads/:id` | edit whitelisted fields |
| `POST /api/leads/:id/verify` | re-run verification |
| `POST /api/leads/:id/call-outcome` | `{outcome:'reached'\|'unresponsive'}` — the human phone gate |
| `POST /api/scrape/run` | `{query_id?}` — starts a sourcing run in the background (202); progress in `scrape_runs` |
| `GET /api/scrape/runs` | recent runs |
| `GET /api/stats` | pipeline stats + cap usage |
| `POST /api/sending/pause` / `resume` | kill switch (KV `config:sending_paused`) |
| `POST /api/agent` | `{message, history?}` — CRM agent chat |
| `POST /api/dev/advance/:id` | dev: simulate 72h elapsing |
| `POST /api/dev/run/:job` | dev: run `sequence\|watcher\|sourcing\|recap` now (`?force_window=1` bypasses the send window for sequence) |
| `POST /api/dev/tool/:name` | dev: call a CRM-agent tool directly |

## Ground rules baked into the code

1. Deliverability guardrails are hard requirements: daily cap (default 20, KV
   `config:daily_cap` override wins), Mon–Fri 09:00–16:30 lead-local send
   window, verification before send, suppression checks, plain-text email,
   max one link. A failed check skips the send and logs why.
2. The system never auto-drops a lead. Sequence exhaustion → `unresponsive_email`
   + `needs_call=1`. Only the CRM agent can set `dropped`, and only after a
   human has logged `phone_status='unresponsive'`. `dropped` keeps the row.
3. Every system/agent write lands in the `activities` audit table.
4. The lead state machine lives in `src/lib/stateMachine.ts` — illegal
   transitions throw.
5. No open-tracking pixels, no auto-calling/auto-WhatsApp, no LinkedIn
   scraping, no auto-delete. By design.
