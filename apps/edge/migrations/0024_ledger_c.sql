-- Ledger C (this website's own payment ledger), connected to the central ledger B and to Razorpay A. Written 2026-10-13.
--   payment: txn_id (TTT-<payment id>, the same text as in Razorpay's order notes and in the central ledger), fee, tax, method, bank, card network and type, bank reference.
--   payment_attempt: every Razorpay try (authorized / captured / failed) with the reason it failed; event_seen: Razorpay event ids already handled; payment_refund: Razorpay refunds.
--   commission: marks of what was posted to the central ledger. ledger_state: when the monthly figures were last sent.
-- Run once (the ALTER lines fail if repeated; the rest is safe to repeat).
ALTER TABLE payment ADD COLUMN txn_id TEXT;
ALTER TABLE payment ADD COLUMN fee_minor INTEGER;
ALTER TABLE payment ADD COLUMN tax_minor INTEGER;
ALTER TABLE payment ADD COLUMN method TEXT;
ALTER TABLE payment ADD COLUMN bank TEXT;
ALTER TABLE payment ADD COLUMN card_network TEXT;
ALTER TABLE payment ADD COLUMN card_type TEXT;
ALTER TABLE payment ADD COLUMN rrn TEXT;
UPDATE payment SET txn_id='TTT-' || id WHERE txn_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_txn ON payment (txn_id) WHERE txn_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS payment_attempt (rzp_payment_id TEXT PRIMARY KEY, payment_id TEXT, rzp_order_id TEXT, txn_id TEXT, status TEXT NOT NULL, currency TEXT, amount_minor INTEGER, method TEXT, bank TEXT, card_network TEXT, card_type TEXT, card_last4 TEXT, vpa_masked TEXT, rrn TEXT, error_code TEXT, error_description TEXT, error_reason TEXT, fee_minor INTEGER, tax_minor INTEGER, authorized_ms INTEGER, captured_ms INTEGER, failed_ms INTEGER, event_ms INTEGER, created_ms INTEGER, updated_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS payment_attempt_payment ON payment_attempt (payment_id);
CREATE TABLE IF NOT EXISTS event_seen (rzp_event_id TEXT PRIMARY KEY, event TEXT, seen_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payment_refund (rzp_refund_id TEXT PRIMARY KEY, rzp_payment_id TEXT NOT NULL, payment_id TEXT, txn_id TEXT, currency TEXT, amount_minor INTEGER NOT NULL, status TEXT, created_ms INTEGER, updated_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS payment_refund_payment ON payment_refund (rzp_payment_id);
ALTER TABLE commission ADD COLUMN synced_ms INTEGER;
ALTER TABLE commission ADD COLUMN sync_status TEXT;
ALTER TABLE commission ADD COLUMN sync_try_ms INTEGER;
ALTER TABLE commission ADD COLUMN sync_error TEXT;
CREATE TABLE IF NOT EXISTS ledger_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
