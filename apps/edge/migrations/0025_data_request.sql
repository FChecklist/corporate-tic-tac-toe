-- A player's "what do you hold about me / correct / delete me" request (rights.ts): the card id, the kind, a short note and three times. No name, number, address or device.
-- Deleted with the game's other participant data (23 hours after the end) and with the game at 365 days. Safe to repeat. test/migrations.test.ts keeps this identical to RIGHTS_SCHEMA.
CREATE TABLE IF NOT EXISTS data_request (id TEXT PRIMARY KEY, eid TEXT NOT NULL, pid TEXT NOT NULL, kind TEXT NOT NULL, note TEXT, created_ms INTEGER NOT NULL, due_ms INTEGER NOT NULL, status TEXT NOT NULL, done_ms INTEGER);
CREATE INDEX IF NOT EXISTS data_request_eid ON data_request (eid, pid);
