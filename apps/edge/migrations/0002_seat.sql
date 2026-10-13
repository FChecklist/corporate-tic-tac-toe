-- Seats: collision-free tickets and one-device tickets. test/migrations.test.ts keeps the migration files identical to SCHEMA in the Worker.
CREATE TABLE IF NOT EXISTS seat (eid TEXT NOT NULL, seq INTEGER NOT NULL, pid TEXT NOT NULL, ph TEXT NOT NULL, dev TEXT, PRIMARY KEY (eid, seq));
CREATE UNIQUE INDEX IF NOT EXISTS seat_phone ON seat (eid, ph);
CREATE UNIQUE INDEX IF NOT EXISTS seat_pid ON seat (eid, pid);
