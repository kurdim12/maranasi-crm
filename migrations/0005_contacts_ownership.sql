-- Migration number: 0005  C1: contacts (multi-person leads) + ownership.
-- Additive. Exactly one primary contact per lead, enforced by a partial
-- unique index AND the repo layer (src/lib/contacts.ts).

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  line_id TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_contacts_lead ON contacts(lead_id);
CREATE UNIQUE INDEX idx_contacts_one_primary ON contacts(lead_id) WHERE is_primary = 1;

ALTER TABLE leads ADD COLUMN assigned_to INTEGER REFERENCES users(id);
ALTER TABLE deals ADD COLUMN assigned_to INTEGER REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN assigned_to INTEGER REFERENCES users(id);
ALTER TABLE leads ADD COLUMN custom TEXT;  -- JSON escape hatch (read-only in UI)
ALTER TABLE deals ADD COLUMN custom TEXT;

-- Backfill: every lead with any contact info gets one primary contact built
-- from the flat fields. leads.email remains the sequence target and stays
-- synced from the primary contact by the repo layer.
INSERT INTO contacts (lead_id, name, email, phone, line_id, is_primary)
SELECT id, COALESCE(NULLIF(TRIM(contact_name), ''), company_name), email, phone, line_id, 1
FROM leads
WHERE (contact_name IS NOT NULL AND TRIM(contact_name) != '')
   OR email IS NOT NULL OR phone IS NOT NULL;
