-- HD-SIGNUP-001 R2 store-first schema. D1 database hazeydata-signups, bound to Pages as SIGNUPS.
-- Applied by the deploy workflow: wrangler d1 execute hazeydata-signups --remote --file=migrations/0001_signups.sql (idempotent)
CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,                 -- lowercased, trimmed
  source TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_at TEXT NOT NULL,            -- ISO 8601 UTC
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'forwarded')),
  forwarded_at TEXT,
  last_error_code INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS signups_email_unique ON signups (email);
CREATE INDEX IF NOT EXISTS signups_status ON signups (status);
