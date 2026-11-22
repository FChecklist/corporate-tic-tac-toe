-- The owner private price for ONE game id (list prices never change) and its audit rows. Apply BEFORE deploying the code that reads it (the code also copes if the table is missing: no price change).
CREATE TABLE IF NOT EXISTS price_adjust (eid TEXT PRIMARY KEY, currency TEXT NOT NULL, adjust_minor INTEGER NOT NULL, reason TEXT NOT NULL, set_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS price_adjust_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, eid TEXT NOT NULL, at_ms INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, currency TEXT NOT NULL, list_minor INTEGER NOT NULL, old_adjust_minor INTEGER, new_adjust_minor INTEGER, net_minor INTEGER, reason TEXT);
CREATE INDEX IF NOT EXISTS price_adjust_audit_eid ON price_adjust_audit (eid);
