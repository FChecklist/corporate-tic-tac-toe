-- The new flow's append-only log of stage games (moves and results). No personal data. Apply BEFORE deploying the code that writes it.
CREATE TABLE IF NOT EXISTS ttt_sl (eid TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, slot TEXT NOT NULL, kind TEXT NOT NULL, pid TEXT NOT NULL, seq INTEGER NOT NULL, body TEXT NOT NULL, at_ms INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ttt_sl_u ON ttt_sl (eid, slot, kind, pid, seq);
CREATE INDEX IF NOT EXISTS ttt_sl_p ON ttt_sl (eid, pid, at_ms);
CREATE INDEX IF NOT EXISTS ttt_sl_k ON ttt_sl (eid, kind, id);
