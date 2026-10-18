-- Help Desk (helpdesk.ts, docs/HELPDESK_SPEC.md): a Refer-and-earn partner prepares games for an Organizer, and the Organizer publishes with one tap.
-- The e-mails are sealed; the Organizer's address is also kept as a one-way hash, the keys only as hashes (the helper's own key is also sealed so the helper can reopen their console).
-- Safe to repeat. test/migrations.test.ts keeps this identical to HELPDESK_SCHEMA.
CREATE TABLE IF NOT EXISTS helpdesk_helper (partner_code TEXT PRIMARY KEY, email_sealed TEXT NOT NULL, joined_ms INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'active');
CREATE TABLE IF NOT EXISTS helpdesk_link (id TEXT PRIMARY KEY, partner_code TEXT NOT NULL, org_email_sealed TEXT NOT NULL, org_email_hash TEXT NOT NULL, org TEXT, state TEXT NOT NULL, token_hash TEXT NOT NULL, ai_key_hash TEXT, ai_key_sealed TEXT, host_hash TEXT, consent_ms INTEGER, consent_text_hash TEXT, created_ms INTEGER NOT NULL, accepted_ms INTEGER, stopped_ms INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS helpdesk_link_token ON helpdesk_link (token_hash);
CREATE INDEX IF NOT EXISTS helpdesk_link_partner ON helpdesk_link (partner_code);
CREATE INDEX IF NOT EXISTS helpdesk_link_org ON helpdesk_link (org);
CREATE TABLE IF NOT EXISTS helpdesk_game (eid TEXT PRIMARY KEY, link_id TEXT NOT NULL, partner_code TEXT NOT NULL, created_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS helpdesk_pub (token_hash TEXT PRIMARY KEY, link_id TEXT NOT NULL, eid TEXT NOT NULL, org TEXT NOT NULL, created_ms INTEGER NOT NULL, exp_ms INTEGER NOT NULL, used_ms INTEGER, tmp_key_hash TEXT);
