-- Every acceptance of the Terms boxes: who (an id, never a name, number or address), which point, for which game or payment, the version, the boxes, a hash of the wording shown, the time. Safe to repeat. test/migrations.test.ts keeps this identical to CONSENT_SCHEMA.
CREATE TABLE IF NOT EXISTS consent_log (id TEXT PRIMARY KEY, subject TEXT, kind TEXT, ref TEXT, version TEXT, boxes TEXT, text_hash TEXT, at_ms INTEGER);
CREATE INDEX IF NOT EXISTS consent_subject ON consent_log (subject, kind, version);
CREATE INDEX IF NOT EXISTS consent_ref ON consent_log (ref);
