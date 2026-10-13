-- The beacon round a seat joined in when that was after the game began. test/migrations.test.ts keeps the migration files identical to SCHEMA in the Worker.
ALTER TABLE seat ADD COLUMN jr INTEGER;
