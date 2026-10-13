-- Participant crypto-shredding: personal part of participants' audit rows lives in audit_pii, sealed under a per-engagement key (salt in eng_key) that is destroyed 23 hours after the game ends; shred records that it happened. test/migrations.test.ts keeps this identical to SCHEMA in the Worker.
ALTER TABLE audit_log ADD COLUMN pdig TEXT;
CREATE TABLE IF NOT EXISTS audit_pii (chain TEXT NOT NULL, seq INTEGER NOT NULL, eid TEXT NOT NULL, sealed TEXT NOT NULL, PRIMARY KEY (chain, seq));
CREATE INDEX IF NOT EXISTS audit_pii_eid ON audit_pii (eid);
CREATE TABLE IF NOT EXISTS eng_key (eid TEXT PRIMARY KEY, salt TEXT NOT NULL, made_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS shred (eid TEXT PRIMARY KEY, shredded_ms INTEGER NOT NULL, row_count INTEGER NOT NULL);
