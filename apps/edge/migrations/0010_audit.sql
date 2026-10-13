-- Internal audit log (append-only, hash-chained, sealed), the owner's access log, deletion certificates, anonymous statistics and legal holds. test/migrations.test.ts keeps this identical to SCHEMA in the Worker.
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, chain TEXT NOT NULL, seq INTEGER NOT NULL, eid TEXT, org TEXT, at_ms INTEGER NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL, target TEXT, corr TEXT NOT NULL, status INTEGER, country TEXT, asn TEXT, ai_vendor TEXT, key_id TEXT, proof TEXT, mismatch INTEGER NOT NULL DEFAULT 0, sealed TEXT NOT NULL, prev_hash TEXT NOT NULL, row_hash TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS audit_chain_seq ON audit_log (chain, seq);
CREATE INDEX IF NOT EXISTS audit_at ON audit_log (at_ms);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;
CREATE TABLE IF NOT EXISTS audit_access (id INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, action TEXT NOT NULL, eid TEXT, fmt TEXT, row_count INTEGER NOT NULL DEFAULT 0, ok INTEGER NOT NULL DEFAULT 1, note TEXT);
CREATE TABLE IF NOT EXISTS audit_cert (eid TEXT PRIMARY KEY, deleted_ms INTEGER NOT NULL, row_count INTEGER NOT NULL, final_hash TEXT NOT NULL, first_ms INTEGER, last_ms INTEGER);
CREATE TABLE IF NOT EXISTS audit_stats (eid TEXT PRIMARY KEY, deleted_ms INTEGER NOT NULL, stats TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS legal_hold (eid TEXT PRIMARY KEY, at_ms INTEGER NOT NULL, note TEXT);
