-- Privacy and lifecycle: sealed personal data, seat roles/inviters/sources, game end times, the winners record, and over-votes. test/migrations.test.ts keeps the migration files identical to SCHEMA in the Worker.
ALTER TABLE participant ADD COLUMN pii TEXT;
ALTER TABLE seat ADD COLUMN role TEXT;
ALTER TABLE seat ADD COLUMN inv INTEGER;
ALTER TABLE seat ADD COLUMN cat TEXT;
ALTER TABLE seat ADD COLUMN src TEXT;
CREATE TABLE IF NOT EXISTS life (eid TEXT PRIMARY KEY, end_ms INTEGER NOT NULL, end_src TEXT NOT NULL, report_ms INTEGER, report_state TEXT, purged_ms INTEGER, tries INTEGER NOT NULL DEFAULT 0, notified INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS winner (eid TEXT NOT NULL, round INTEGER NOT NULL, pattern TEXT NOT NULL, ordinal INTEGER NOT NULL, seat INTEGER NOT NULL, idx INTEGER, at_ms INTEGER, src TEXT NOT NULL, PRIMARY KEY (eid, round, pattern, ordinal, seat));
CREATE TABLE IF NOT EXISTS overvote (eid TEXT NOT NULL, seat INTEGER NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, seat));
