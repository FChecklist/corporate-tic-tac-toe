-- Corporate Tic Tac Toe tournament: sealed seed, entrants, players, one row per match. Safe to repeat. test/migrations.test.ts keeps this identical to TTT_SCHEMA.
CREATE TABLE IF NOT EXISTS ttt_t (eid TEXT PRIMARY KEY, commit_hash TEXT NOT NULL, secret TEXT, state TEXT NOT NULL DEFAULT 'open', opts TEXT, seed TEXT, size INTEGER, rounds INTEGER, entrants INTEGER, players INTEGER, started_ms INTEGER, ended_ms INTEGER, pause_at INTEGER, pause_total INTEGER NOT NULL DEFAULT 0, champion TEXT, ranking TEXT);
CREATE TABLE IF NOT EXISTS ttt_e (eid TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, members TEXT NOT NULL, PRIMARY KEY (eid, id));
CREATE TABLE IF NOT EXISTS ttt_p (eid TEXT NOT NULL, pid TEXT NOT NULL, name TEXT NOT NULL, ent TEXT, PRIMARY KEY (eid, pid));
CREATE TABLE IF NOT EXISTS ttt_m (eid TEXT NOT NULL, mid TEXT NOT NULL, round INTEGER NOT NULL, idx INTEGER NOT NULL, a TEXT, b TEXT, status TEXT NOT NULL, bye INTEGER NOT NULL DEFAULT 0, deadline INTEGER, winner TEXT, loser TEXT, started_ms INTEGER, done_ms INTEGER, data TEXT, PRIMARY KEY (eid, mid));
CREATE INDEX IF NOT EXISTS ttt_m_live ON ttt_m (eid, status, deadline);
CREATE INDEX IF NOT EXISTS ttt_m_a ON ttt_m (eid, a);
CREATE INDEX IF NOT EXISTS ttt_m_b ON ttt_m (eid, b);
