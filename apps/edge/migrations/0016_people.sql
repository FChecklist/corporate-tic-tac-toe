-- People, links and joining (Phase 2, docs/ROLES_AND_CONSOLE_SPEC_3.md): one list per inviter, personal links, the waiting room, a blocked flag for removed seats. Apply BEFORE deploying the code that reads it.
ALTER TABLE organizer_key ADD COLUMN created_by TEXT;
ALTER TABLE engagement ADD COLUMN cohost_limit INTEGER;
ALTER TABLE seat ADD COLUMN blocked INTEGER;
CREATE TABLE IF NOT EXISTS person (eid TEXT NOT NULL, id TEXT NOT NULL, ph TEXT NOT NULL, pii TEXT NOT NULL, inviter TEXT NOT NULL, role TEXT, status TEXT NOT NULL, tok_hash TEXT, tok_sealed TEXT, approved_by TEXT, approved_ms INTEGER, added_ms INTEGER NOT NULL, joined_ms INTEGER, removed_ms INTEGER, removed_by TEXT, PRIMARY KEY (eid, id));
CREATE UNIQUE INDEX IF NOT EXISTS person_phone ON person (eid, ph);
CREATE UNIQUE INDEX IF NOT EXISTS person_token ON person (tok_hash);
CREATE INDEX IF NOT EXISTS person_inviter ON person (eid, inviter);
CREATE TABLE IF NOT EXISTS waiting (eid TEXT NOT NULL, id TEXT NOT NULL, ph TEXT NOT NULL, pii TEXT NOT NULL, via TEXT NOT NULL, inviter TEXT NOT NULL, chain TEXT NOT NULL, overlimit INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, at_ms INTEGER NOT NULL, decided_by TEXT, decided_ms INTEGER, PRIMARY KEY (eid, id));
CREATE UNIQUE INDEX IF NOT EXISTS waiting_phone ON waiting (eid, ph);
