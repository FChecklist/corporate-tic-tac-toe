// The life-scenarios sim server: the same startSim() as tools/sim2/server.ts, but on its OWN port (8803) and its OWN database file (sim/life.sqlite),
// so it never collides with the other agents' sim servers (8801/8802). It never touches the live site (the sim's fetch guard refuses every non-localhost request).
//
// One difference on purpose: POST /__sim/reset here WIPES THE TABLES IN PLACE and refills them from sim/live-copy.sqlite, instead of deleting and re-copying the database file.
// On Windows the file delete fails with EBUSY ("resource busy or locked") after a few hundred resets (the server's own cached statements keep the file open), which killed long runs.
// The wipe gives the scenario exactly what a fresh copy gives: live rows, current schema, site mode TEST, clock back to real time, empty mail sink.
//
// Run: bun tools/sim2/scenarios/life/server.ts      env LIFE_PORT (default 8803), LIFE_DB (default sim/life.sqlite)
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { startSim } from "../../server";
import { ensurePristine } from "../../db";
import { sentReports } from "../../../../apps/edge/src/pay";

const ROOT = join(import.meta.dir, "../../../..");
const port = Number(process.env.LIFE_PORT ?? 8803);
const pristine = join(ROOT, "sim/pristine.sqlite");
ensurePristine(pristine);
let sim: Awaited<ReturnType<typeof startSim>> | null = null;

function wipeAndRefill(raw: Database): { tables: number; rows: number } {
  raw.run("PRAGMA foreign_keys=OFF");
  raw.run(`ATTACH DATABASE '${pristine.replace(/'/g, "''")}' AS p`);
  let tables = 0, rows = 0;
  try {
    const mine = (raw.query("SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all() as { name: string }[]).map((r) => r.name);
    const theirs = new Set((raw.query("SELECT name FROM p.sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name));
    raw.run("BEGIN IMMEDIATE");
    try {
      for (const t of mine) raw.run(`DELETE FROM main."${t}"`);
      if ((raw.query("SELECT name FROM main.sqlite_master WHERE name='sqlite_sequence'").all() as any[]).length) raw.run("DELETE FROM main.sqlite_sequence");
      for (const t of mine) {
        if (!theirs.has(t)) continue;
        const a = (raw.query(`PRAGMA main.table_info("${t}")`).all() as { name: string }[]).map((c) => c.name), b = new Set((raw.query(`PRAGMA p.table_info("${t}")`).all() as { name: string }[]).map((c) => c.name));
        const cols = a.filter((c) => b.has(c)).map((c) => `"${c}"`).join(",");
        if (!cols) continue;
        const r = raw.run(`INSERT INTO main."${t}"(${cols}) SELECT ${cols} FROM p."${t}"`); tables++; rows += r.changes;
      }
      raw.run("UPDATE mode SET mode='TEST', changed_ms=?, reason='sim start' WHERE id=1", [Date.now()]);
      raw.run("COMMIT");
    } catch (e) { try { raw.run("ROLLBACK"); } catch { /* none open */ } throw e; }
  } finally { try { raw.run("DETACH DATABASE p"); } catch { /* already detached */ } }
  return { tables, rows };
}

// wrap Bun.serve once so /__sim/reset is answered here; every other request goes to startSim's own handler untouched
const realServe = Bun.serve.bind(Bun) as typeof Bun.serve;
(Bun as any).serve = (o: any) => realServe({
  ...o,
  async fetch(req: Request, srv: any) {
    const u = new URL(req.url);
    if (sim && req.method === "POST" && u.pathname === "/__sim/reset") {
      const b = (await req.json().catch(() => ({}))) as any;
      const r = wipeAndRefill(sim.raw);
      if (b?.mode === "LIVE") { /* keep the exported mode row */ }
      sim.clock.offset = 0; sim.clock.frozen = null; sentReports.length = 0;
      return new Response(JSON.stringify({ ok: true, wiped: true, ...r, now: Date.now() }), { headers: { "content-type": "application/json" } });
    }
    return o.fetch(req, srv);
  },
});

sim = await startSim({ port, runFile: process.env.LIFE_DB ?? join(ROOT, "sim/life.sqlite"), build: false, google: false });
console.log(`LIFE SIM READY ${sim.url} (db ${sim.raw.filename})`);
