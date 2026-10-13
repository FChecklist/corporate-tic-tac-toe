-- One-click sign-in link from the sign-in e-mail: only a hash of its single-use token is kept, with the same expiry as the 6-digit code. test/migrations.test.ts keeps the migration files identical to SCHEMA in the Worker.
ALTER TABLE login_code ADD COLUMN link_hash TEXT;
