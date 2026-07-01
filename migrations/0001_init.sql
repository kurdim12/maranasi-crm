-- Migration number: 0001 	 Maranasi Outreach Engine — initial schema

CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT UNIQUE,
  email_status TEXT NOT NULL DEFAULT 'unverified',
    -- unverified | verified | invalid | bounced
  phone TEXT,
  phone_status TEXT NOT NULL DEFAULT 'unknown',
    -- unknown | valid_format | reached | unresponsive
  website TEXT,
  domain TEXT,                        -- normalized, used for dedup
  category TEXT,                      -- e.g. 'event agency', 'venue'
  city TEXT,
  country TEXT,                       -- 'VN' | 'TH'
  timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  source TEXT NOT NULL DEFAULT 'places',   -- places | manual | import
  status TEXT NOT NULL DEFAULT 'new',
    -- new | enriched | verified | invalid_email | contacted | interested
    -- | not_interested | opted_out | unresponsive_email | dropped
  confirmed INTEGER NOT NULL DEFAULT 0,    -- 1 when email verified + phone format valid
  needs_call INTEGER NOT NULL DEFAULT 0,
  sequence_step INTEGER NOT NULL DEFAULT 0, -- 0 = never emailed, max 3
  next_action_at TEXT,                      -- ISO; when sequence engine acts next
  last_contacted_at TEXT,
  drop_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_next_action ON leads(next_action_at);
CREATE INDEX idx_leads_domain ON leads(domain);

CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  direction TEXT NOT NULL,            -- out | in
  sequence_step INTEGER,
  subject TEXT,
  body TEXT,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  classification TEXT,                -- inbound only: interested | not_interested
                                      --   | ooo | bounce | opt_out | other
  dry_run INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_email_log_lead ON email_log(lead_id);
CREATE INDEX idx_email_log_thread ON email_log(gmail_thread_id);

CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sequence_step INTEGER NOT NULL,     -- 1, 2, or 3
  language TEXT NOT NULL DEFAULT 'en',
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,        -- {{placeholders}}: company_name, city, category, contact_name
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE suppression (
  email TEXT PRIMARY KEY,
  domain TEXT,
  reason TEXT NOT NULL,               -- opt_out | bounce | manual | not_interested
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,                -- system | crm_agent | owner
  action TEXT NOT NULL,               -- e.g. lead_created, email_sent, status_change, lead_dropped
  lead_id INTEGER,
  detail TEXT,                        -- JSON string
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE search_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,                -- e.g. 'event management company in Ho Chi Minh City'
  city TEXT, country TEXT, category TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT
);

CREATE TABLE scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,              -- cron | manual
  queries_run INTEGER, places_found INTEGER, new_leads INTEGER, skipped_dupes INTEGER,
  status TEXT NOT NULL DEFAULT 'running',  -- running | done | failed
  error TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
