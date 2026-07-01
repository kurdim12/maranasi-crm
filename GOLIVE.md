# Go-live checklist — Maranasi Outreach Engine

The code is done; this list is what stands between DRY_RUN and real sending.
Work top to bottom. Do NOT flip `DRY_RUN` until every earlier box is checked.

## 1. Sending infrastructure

- [ ] Buy a **separate sending domain** (e.g. `maranasi-events.com` variant) —
      never send cold email from the main company domain.
- [ ] Add it to **Google Workspace** and create the dedicated outreach inbox.
- [ ] DNS for the sending domain:
  - [ ] **SPF**: `v=spf1 include:_spf.google.com ~all`
  - [ ] **DKIM**: enable in Google Admin → Apps → Gmail → Authenticate email,
        publish the TXT record, verify it shows "Authenticating".
  - [ ] **DMARC**: start with `v=DMARC1; p=quarantine; rua=mailto:<you>` and
        review reports for 2 weeks before considering `p=reject`.
  - [ ] Verify all three with a tool like mxtoolbox.com or `dig TXT`.
- [ ] Run `scripts/gmail-auth.md` to get the refresh token; store all Gmail
      secrets with `wrangler secret put`.

## 2. Warmup (2–3 weeks minimum)

- [ ] Weeks 1–3: use the inbox like a human — send/receive real mail with
      known contacts daily, subscribe to a few newsletters, reply to things.
      (Optionally use a warmup service.)
- [ ] Do not start cold outreach during warmup.

## 3. Content

- [ ] Replace the 3 **placeholder templates** in the `templates` table with
      approved copy (keep: plain text, under 130 words, max one link, no
      spam-trigger words). Update via D1:
      `wrangler d1 execute maranasi-crm --remote --command "UPDATE templates SET subject_template='...', body_template='...' WHERE sequence_step=1"`
- [ ] Confirm the templates render correctly: run one lead through the
      sequence in DRY_RUN and read the bodies in `email_log`.

## 4. System checks (still DRY_RUN)

- [ ] `wrangler d1 migrations apply maranasi-crm --remote` ran cleanly.
- [ ] All secrets set: `ANTHROPIC_API_KEY`, `ADMIN_API_KEY`,
      `GOOGLE_PLACES_API_KEY`, `GMAIL_*` (3), `RECAP_EMAIL`, `SENDER_EMAIL`,
      `SENDER_NAME`.
- [ ] A real scrape run inserts leads (`POST /api/scrape/run`).
- [ ] Verification moves leads to `verified` / `invalid_email` correctly.
- [ ] Reply watcher processes a manual test email into the inbox.
- [ ] Daily recap arrives at `RECAP_EMAIL` (recap sends for real even in
      DRY_RUN).
- [ ] Seed a test lead with **your own email**, walk it through steps 1→3 in
      DRY_RUN using `POST /api/dev/advance/:id`, confirm it lands in
      `unresponsive_email` + `needs_call=1`.

## 5. Flip the switch

- [ ] Set `DRY_RUN = "false"` in `wrangler.toml` and `wrangler deploy`.
      (Owner does this — the system never flips it itself.)
- [ ] Cap schedule (KV override wins over env; set via
      `wrangler kv key put --binding KV config:daily_cap "<n>"`):
  - Week 1: **10/day**
  - Week 2: **20/day**
  - Week 3: **35/day**
  - Week 4+: **50/day**
- [ ] Send-window and weekday guardrails stay on — do not bypass in prod.

## 6. Watch after go-live

- [ ] **Bounce rate**: if bounces / sends > **3%**, pause immediately
      (`POST /api/sending/pause` or dashboard button), re-verify the list,
      investigate before resuming.
- [ ] Check the daily recap every morning (06:30 Amman).
- [ ] Watch Gmail Postmaster Tools (add the sending domain) for spam-rate and
      reputation signals.
- [ ] Reply to interested leads fast — same business day.
- [ ] Never delete leads; `dropped` status + suppression list is the only
      exit, and only after a human-logged unresponsive phone call.
