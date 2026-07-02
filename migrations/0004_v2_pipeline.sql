-- Migration number: 0004  v2 Command Center: deals, tasks, tags, A/B variants,
-- inbox triage, lead intelligence columns. Additive only.

CREATE TABLE deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  stage TEXT NOT NULL DEFAULT 'new',
    -- new | call_scheduled | proposal_sent | negotiation | won | lost
  value_usd INTEGER,
  expected_close TEXT,
  next_step TEXT,
  lost_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_deals_stage ON deals(stage);
CREATE INDEX idx_deals_lead ON deals(lead_id);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id),
  deal_id INTEGER REFERENCES deals(id),
  title TEXT NOT NULL,
  due_at TEXT,
  done_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual',   -- manual | system | agent
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_due ON tasks(done_at, due_at);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  color TEXT
);
CREATE TABLE lead_tags (
  lead_id INTEGER,
  tag_id INTEGER,
  PRIMARY KEY (lead_id, tag_id)
);

CREATE TABLE template_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  label TEXT NOT NULL,             -- 'A' | 'B'
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE leads ADD COLUMN brief TEXT;             -- AI company brief (JSON)
ALTER TABLE leads ADD COLUMN fit_score INTEGER;      -- 1..5
ALTER TABLE leads ADD COLUMN socials TEXT;           -- JSON {instagram, linkedin, facebook}
ALTER TABLE leads ADD COLUMN preferred_channel TEXT; -- whatsapp | zalo | line | email
ALTER TABLE leads ADD COLUMN line_id TEXT;
ALTER TABLE email_log ADD COLUMN variant_label TEXT; -- which A/B variant was sent
ALTER TABLE email_log ADD COLUMN snoozed_until TEXT; -- inbox triage
ALTER TABLE email_log ADD COLUMN triage TEXT;        -- needs_reply | waiting | done

-- Backfill triage for existing inbound mail: bounces/ooo need no reply.
UPDATE email_log SET triage = CASE
    WHEN classification IN ('ooo', 'bounce') THEN 'done'
    ELSE 'needs_reply'
  END
  WHERE direction = 'in';
