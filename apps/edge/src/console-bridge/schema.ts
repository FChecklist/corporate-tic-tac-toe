// Tables the bridge owns inside a game's database. Also available as migrations/console_bridge.sql (a game numbers that file itself).
// A game runs BRIDGE_SCHEMA once at start-up (like its other in-code schemas) because the live database token cannot run CREATE TABLE.
export const BRIDGE_SCHEMA: string[] = [
  // who may do what in ONE game, by e-mail. The game decides the role from here; nothing the console says is believed.
  "CREATE TABLE IF NOT EXISTS game_role (role_id TEXT PRIMARY KEY, eid TEXT NOT NULL, role TEXT NOT NULL, email_hash TEXT NOT NULL, email_sealed TEXT, state TEXT NOT NULL, invited_ms INTEGER NOT NULL, accepted_ms INTEGER, invited_by TEXT)",
  "CREATE INDEX IF NOT EXISTS game_role_eid ON game_role(eid)",
  "CREATE INDEX IF NOT EXISTS game_role_person ON game_role(email_hash)",
  // assertion ids already used (single use)
  "CREATE TABLE IF NOT EXISTS console_jti (jti TEXT PRIMARY KEY, exp_s INTEGER NOT NULL)",
  // one-time handoff links from the console to the game's own screens
  "CREATE TABLE IF NOT EXISTS console_handoff (token_hash TEXT PRIMARY KEY, eid TEXT NOT NULL, kind TEXT NOT NULL, org TEXT NOT NULL, created_by TEXT NOT NULL, expires_ms INTEGER NOT NULL)",
];

const ready = new WeakSet<object>();
/** creates the tables once per database connection (a game's live database token cannot run CREATE TABLE in a migration, so the Worker does it like its other lazy tables) */
export async function ensureBridgeSchema(db: { prepare(sql: string): { run(): Promise<unknown> } }): Promise<void> {
  if (ready.has(db)) return;
  for (const s of BRIDGE_SCHEMA) await db.prepare(s).run();
  ready.add(db);
}
