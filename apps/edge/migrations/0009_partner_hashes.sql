-- Partner codes are random (no mobile number in them); the mobile number and e-mail are kept only as salted hashes. test/migrations.test.ts keeps the migration files identical to SCHEMA in the Worker.
ALTER TABLE partner ADD COLUMN phone_hash TEXT;
ALTER TABLE partner ADD COLUMN email_hash TEXT;
