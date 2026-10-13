-- A key made only for an e-mail expires 24 hours after it is minted (null = never, as before). test/migrations.test.ts keeps the migration files identical to SCHEMA in the Worker.
ALTER TABLE organizer_key ADD COLUMN expires_ms INTEGER;
