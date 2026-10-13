-- Which version of the Terms an organizer accepted (by continuing), and when. One row per organizer and version. test/migrations.test.ts keeps the migration files identical to SCHEMA in the Worker.
CREATE TABLE IF NOT EXISTS organizer_terms (org TEXT NOT NULL, version TEXT NOT NULL, at_ms INTEGER NOT NULL, via TEXT NOT NULL, PRIMARY KEY (org, version));
