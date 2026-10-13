-- Credit instead of refunds (NO REFUNDS: a cancelled paid game becomes credit for 365 days), games that did not start (closed after the erasure of guest data), and
-- "Create a new game like this one" (docs/ROLES_AND_CONSOLE_SPEC_5.md and _6.md). The old refund and credit_note tables stay so existing migrations remain valid; nothing writes to them any more.
-- Apply BEFORE deploying the code that reads it.
CREATE TABLE IF NOT EXISTS credit (id TEXT PRIMARY KEY, org TEXT NOT NULL, payment_id TEXT, eid TEXT, kind TEXT NOT NULL DEFAULT 'cancel', total_inr REAL NOT NULL, remaining_inr REAL NOT NULL, lapsed_inr REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'INR', created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', is_test INTEGER NOT NULL DEFAULT 0, mail_created_ms INTEGER, mail30_ms INTEGER, mail3_ms INTEGER, mail_lapse_ms INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS credit_payment ON credit (payment_id);
CREATE INDEX IF NOT EXISTS credit_org ON credit (org, status, expires_ms);
CREATE TABLE IF NOT EXISTS credit_use (id INTEGER PRIMARY KEY AUTOINCREMENT, credit_id TEXT NOT NULL, eid TEXT NOT NULL, amount_inr REAL NOT NULL, at_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'applied', restored_ms INTEGER);
CREATE INDEX IF NOT EXISTS credit_use_eid ON credit_use (eid, status);
CREATE INDEX IF NOT EXISTS credit_use_credit ON credit_use (credit_id);
ALTER TABLE engagement ADD COLUMN unplayed_ms INTEGER;
