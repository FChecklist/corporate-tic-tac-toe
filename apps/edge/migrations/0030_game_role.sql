-- Master console bridge (console-bridge/schema.ts): who may do what in ONE game by e-mail, assertion ids already used, one-time hand-off links.
-- The bridge also creates these tables itself the first time it is used (the live database token cannot run CREATE TABLE), so applying this file is optional and harmless.
CREATE TABLE IF NOT EXISTS game_role (role_id TEXT PRIMARY KEY, eid TEXT NOT NULL, role TEXT NOT NULL, email_hash TEXT NOT NULL, email_sealed TEXT, state TEXT NOT NULL, invited_ms INTEGER NOT NULL, accepted_ms INTEGER, invited_by TEXT);
CREATE INDEX IF NOT EXISTS game_role_eid ON game_role(eid);
CREATE INDEX IF NOT EXISTS game_role_person ON game_role(email_hash);
CREATE TABLE IF NOT EXISTS console_jti (jti TEXT PRIMARY KEY, exp_s INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS console_handoff (token_hash TEXT PRIMARY KEY, eid TEXT NOT NULL, kind TEXT NOT NULL, org TEXT NOT NULL, created_by TEXT NOT NULL, expires_ms INTEGER NOT NULL);
