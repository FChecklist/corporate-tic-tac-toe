-- Cancel a game, refund, credit note, Host e-mail, Co-host bound to one game (round 2). Apply BEFORE deploying the code that reads it.
ALTER TABLE engagement ADD COLUMN cancelled_ms INTEGER;
ALTER TABLE engagement ADD COLUMN cancelled_by TEXT;
ALTER TABLE organizer_key ADD COLUMN email_sealed TEXT;
ALTER TABLE organizer_key ADD COLUMN eid TEXT;
ALTER TABLE organizer_key ADD COLUMN pii TEXT;
ALTER TABLE payment ADD COLUMN eid TEXT;
ALTER TABLE payment ADD COLUMN confirming_ms INTEGER;
CREATE INDEX IF NOT EXISTS payment_eid ON payment (eid);
CREATE TABLE IF NOT EXISTS refund (payment_id TEXT PRIMARY KEY, eid TEXT, org TEXT, currency TEXT NOT NULL, paid REAL NOT NULL, fee REAL NOT NULL, refund REAL NOT NULL, refund_status TEXT NOT NULL, rzp_refund_id TEXT, is_test INTEGER NOT NULL DEFAULT 0, note TEXT, requested_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS credit_note (token TEXT PRIMARY KEY, payment_id TEXT UNIQUE NOT NULL, brand TEXT NOT NULL, fy TEXT NOT NULL, seq INTEGER NOT NULL, number TEXT NOT NULL, issued_ms INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE (brand, fy, seq));
