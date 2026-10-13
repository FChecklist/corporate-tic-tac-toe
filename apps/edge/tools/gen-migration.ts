// Regenerates migrations/0001_init.sql from SCHEMA (run: bun run apps/edge/tools/gen-migration.ts). test/migrations.test.ts fails if they drift.
import { SCHEMA } from "../src/worker";
await Bun.write(new URL("../migrations/0001_init.sql", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "-- Generated from SCHEMA in src/worker.ts; test/migrations.test.ts keeps them identical.\n" + SCHEMA.map((s) => s + ";").join("\n") + "\n");
console.log("migration written");
