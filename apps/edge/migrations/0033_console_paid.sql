-- Master console bridge (console-bridge/schema.ts): one row per payment notice (order id) the console has sent this game. A game is marked paid once per order id (state marking -> paid).
-- The bridge also creates this table itself the first time it is used (the live database token cannot run CREATE TABLE), so applying this file is optional and harmless.
CREATE TABLE IF NOT EXISTS console_paid (order_ref TEXT PRIMARY KEY, eid TEXT NOT NULL, state TEXT NOT NULL, at_ms INTEGER NOT NULL);
