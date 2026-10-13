-- Brand on the ticket, pay links anyone can open, Google sign-in and the Host first open (Phases 3 and 4, docs/ROLES_AND_CONSOLE_SPEC_4.md). The brand needs no table (it lives in the game's settings JSON). Apply BEFORE deploying the code that reads it.
CREATE TABLE IF NOT EXISTS paylink (hash TEXT PRIMARY KEY, eid TEXT NOT NULL, org TEXT NOT NULL, created_ms INTEGER NOT NULL, exp_ms INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_by TEXT);
CREATE INDEX IF NOT EXISTS paylink_eid ON paylink (eid);
ALTER TABLE organizer_key ADD COLUMN host_id TEXT;
CREATE TABLE IF NOT EXISTS host_state (host_id TEXT PRIMARY KEY, org TEXT NOT NULL, email_hash TEXT, verified_ms INTEGER, pend_hash TEXT, pend_sealed TEXT, link_exp_ms INTEGER NOT NULL, spent INTEGER NOT NULL DEFAULT 0, mobile_ok INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS host_login (email_hash TEXT NOT NULL, host_id TEXT NOT NULL, org TEXT NOT NULL, created_ms INTEGER NOT NULL, PRIMARY KEY (email_hash, host_id));
INSERT OR IGNORE INTO host_state(host_id,org,link_exp_ms,mobile_ok) SELECT hash, org, CAST(strftime('%s','now') AS INTEGER) * 1000 + 604800000, CASE WHEN pii IS NOT NULL THEN 1 ELSE 0 END FROM organizer_key WHERE kind='host' AND expires_ms IS NULL AND revoked=0;
