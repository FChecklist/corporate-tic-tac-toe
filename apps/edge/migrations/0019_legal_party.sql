-- Permanent record of who paid and the organizer's invoice details (name, e-mail, mobile) for every paid game. Kept for ever (invoices and payment records have to be kept for tax and accounting).
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS legal_party (eid TEXT PRIMARY KEY, org TEXT, organizer_name TEXT, organizer_email TEXT, organizer_phone TEXT, payer_name TEXT, payer_org TEXT, payer_email TEXT, payer_phone TEXT, payer_country TEXT, payer_tax_id TEXT, payment_ids TEXT, kept_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS legal_party_org ON legal_party (org);
