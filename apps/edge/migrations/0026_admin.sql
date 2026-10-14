-- The owner's desk (admin.ts): the mail service's bounce / complaint / delivery events. A recipient is a one-way hash plus a masked form (j***@example.com); deleted after 90 days.
-- Safe to repeat. test/migrations.test.ts keeps this identical to ADMIN_SCHEMA.
CREATE TABLE IF NOT EXISTS mail_bounce (id TEXT PRIMARY KEY, at_ms INTEGER NOT NULL, event TEXT NOT NULL, to_hash TEXT NOT NULL, to_mask TEXT, subject TEXT, kind TEXT, detail TEXT);
CREATE INDEX IF NOT EXISTS mail_bounce_at ON mail_bounce (at_ms);
