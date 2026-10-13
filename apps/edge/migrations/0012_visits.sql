-- First-party visitor-journey tracking of the PUBLIC pages (visits.ts): sessions, events, and the anonymous per-day totals that replace them after 365 days. No names, no mobile numbers, no raw network address. test/migrations.test.ts keeps this identical to SCHEMA in the Worker.
CREATE TABLE IF NOT EXISTS visit_session (sid TEXT PRIMARY KEY, vid TEXT, iph TEXT, ipshort TEXT, first_ms INTEGER NOT NULL, last_ms INTEGER NOT NULL, landing TEXT, src TEXT, ref_host TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, partner TEXT, device TEXT, browser TEXT, os TEXT, lang TEXT, country TEXT, city TEXT, is_bot INTEGER NOT NULL DEFAULT 0, visit_no INTEGER NOT NULL DEFAULT 1, ip_visit_no INTEGER NOT NULL DEFAULT 1, pages INTEGER NOT NULL DEFAULT 0, n_events INTEGER NOT NULL DEFAULT 0, exit_path TEXT, exit_section TEXT, exit_ms INTEGER, exit_scroll INTEGER, stage INTEGER NOT NULL DEFAULT 0, org TEXT, eh TEXT);
CREATE INDEX IF NOT EXISTS visit_session_first ON visit_session (first_ms);
CREATE INDEX IF NOT EXISTS visit_session_vid ON visit_session (vid);
CREATE INDEX IF NOT EXISTS visit_session_iph ON visit_session (iph);
CREATE INDEX IF NOT EXISTS visit_session_org ON visit_session (org);
CREATE TABLE IF NOT EXISTS visit_event (id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL, at_ms INTEGER NOT NULL, kind TEXT NOT NULL, path TEXT, name TEXT, val TEXT, n INTEGER);
CREATE INDEX IF NOT EXISTS visit_event_sid ON visit_event (sid);
CREATE INDEX IF NOT EXISTS visit_event_at ON visit_event (at_ms);
CREATE TABLE IF NOT EXISTS visit_agg (day TEXT NOT NULL, dim TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, dim, k));
