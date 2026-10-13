// Simulation database helpers (tools/sim2 only; production code is untouched).
// The Worker's SCHEMA list is written for a FRESH database: its ALTER TABLE ... ADD COLUMN lines fail with "duplicate column name" on a database that already has the column
// (apps/edge/src/local.ts dies with "duplicate column name: jr" on a second start). Here every statement is applied one by one, and an ALTER whose column exists is skipped.
// The statements that really CHANGED the database are returned, which is also the schema-parity answer: "what would the code add to a copy of live".
import { Database } from "bun:sqlite";
import { existsSync, rmSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA, type D1, type D1Stmt } from "../../apps/edge/src/worker";

export function applySchemaIdempotent(raw: Database): { applied: string[]; skipped: number } {
  const applied: string[] = []; let skipped = 0;
  for (const s of SCHEMA) {
    const m = /^\s*ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/i.exec(s);
    if (m) {
      const cols = raw.query(`PRAGMA table_info(${m[1]})`).all() as { name: string }[];
      if (cols.some((c) => c.name === m[2])) { skipped++; continue; }
    }
    const mc = () => (raw.query("SELECT COUNT(*) c FROM sqlite_master").get() as any).c as number, tc = () => (raw.query("SELECT total_changes() c").get() as any).c as number;
    const m0 = mc(), t0 = tc();
    try { raw.run(s); } catch (e: any) { if (/duplicate column|already exists/i.test(String(e?.message))) { skipped++; continue; } throw new Error(`schema statement failed: ${s.slice(0, 120)}: ${e?.message}`); }
    if (m || mc() !== m0 || tc() !== t0) applied.push(s.slice(0, 160));
  }
  return { applied, skipped };
}

export function d1Of(raw: Database): D1 {
  const stmt = (sql: string, vals: unknown[] = []): D1Stmt => ({
    bind: (...v) => stmt(sql, v),
    run: async () => { const r = raw.query(sql).run(...(vals as any[])); return { meta: { changes: r.changes } }; },
    all: async () => ({ results: raw.query(sql).all(...(vals as any[])) as any[] }),
    first: async () => (raw.query(sql).get(...(vals as any[])) as any) ?? null,
  });
  return { prepare: (s) => stmt(s), batch: async (xs) => Promise.all(xs.map((x) => x.run())) };
}

/** The pristine database every run starts from: an EMPTY database with the current schema (Corporate Tic Tac Toe has no live data to copy). Made once, never written by a run. */
export function ensurePristine(pristine: string): void {
  if (existsSync(pristine)) return;
  mkdirSync(dirname(pristine), { recursive: true });
  const raw = new Database(pristine, { create: true });
  applySchemaIdempotent(raw);
  raw.run("PRAGMA wal_checkpoint(TRUNCATE)"); raw.close();
}

/** A fresh working copy for one run: the pristine live copy is never opened for writing. */
export function freshRunCopy(pristine: string, runFile: string): void {
  ensurePristine(pristine);
  mkdirSync(dirname(runFile), { recursive: true });
  for (const x of ["", "-wal", "-shm"]) if (existsSync(runFile + x)) rmSync(runFile + x);
  copyFileSync(pristine, runFile);
}
