-- Migration number: 0003 	 Dashboard user accounts (username + password login)
-- Passwords are stored as pbkdf2$<iterations>$<salt_b64>$<hash_b64>; accounts
-- are seeded out-of-band (never commit credentials to the repo).

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);
