-- Corporate Tic Tac Toe mailbox: moves with the server's own stamp, the two players' reports, agreed results, finish reports, notes for the Organizer, pauses. Safe to repeat. test/migrations.test.ts keeps this identical to TTT_MAILBOX_SCHEMA.
CREATE TABLE IF NOT EXISTS ttt_mv (eid TEXT NOT NULL, mid TEXT NOT NULL, j INTEGER NOT NULL, seq INTEGER NOT NULL, pid TEXT NOT NULL, sq INTEGER NOT NULL, client_ms INTEGER, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, mid, j, seq));
CREATE TABLE IF NOT EXISTS ttt_r (eid TEXT NOT NULL, mid TEXT NOT NULL, j INTEGER NOT NULL, pid TEXT NOT NULL, winner TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, mid, j, pid));
CREATE TABLE IF NOT EXISTS ttt_b (eid TEXT NOT NULL, mid TEXT NOT NULL, j INTEGER NOT NULL, winner TEXT, how TEXT NOT NULL, flag INTEGER NOT NULL DEFAULT 0, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, mid, j));
CREATE TABLE IF NOT EXISTS ttt_f (eid TEXT NOT NULL, who TEXT NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, who));
CREATE TABLE IF NOT EXISTS ttt_x (eid TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, mid TEXT, who TEXT, note TEXT, at_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS ttt_z (eid TEXT NOT NULL, from_ms INTEGER NOT NULL, to_ms INTEGER, PRIMARY KEY (eid, from_ms));
