// bun tools/sim2/scenarios/matrix/run.ts --seed 1 [--only <regexp on scenario name>] [--list]
// Starts its OWN sim server in this process (default port 8802, own database file sim/matrix-seed<N>.sqlite, never 8801/8799/8890), builds the scenarios for the seed,
// runs them one after the other (clock-moving scenarios last), applies the global invariants after each one, prints failures and writes sim/matrix-result-seed<N>.json.
// Nothing leaves the machine: tools/sim2/server.ts blocks every non-localhost fetch. Output summary line: MATRIX seed=N scenarios=X passed=Y failed=Z checks=C.
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = args.indexOf("--" + k); return i >= 0 ? (args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1] : "1") : d; };
const seed = Number(arg("seed", "1")); const only = arg("only"); const listOnly = args.includes("--list");
const PORT = Number(process.env.MATRIX_PORT ?? 8802);
process.env.SIM_PORT = String(PORT); // the shared harness library reads this when it is imported
const ROOT = join(import.meta.dir, "../../../..");

const { startSim } = await import("../../server");
// @ts-ignore: plain .mjs module without types
const L: any = await import("./lib.mjs") as any;
const { A, clock } = L;
const families = ["config", "houses", "roles", "lifecycle", "people", "brand", "money", "time", "play"];
let scenarios: any[] = [];
for (const f of families) { const m: any = await import(`./gen-${f}.mjs`).catch((e) => { if (/Cannot find module|not found/i.test(String(e?.message))) return null; throw e; }); if (!m) continue; scenarios.push(...(await m.default({ seed, R: L.rng(seed * 7919 + f.length), L })).map((s: any) => ({ ...s, family: f }))); }
const dup = scenarios.map((s) => s.name).filter((n, i, a) => a.indexOf(n) !== i);
if (dup.length) { console.error("duplicate scenario names:", [...new Set(dup)].slice(0, 10)); process.exit(2); }
if (only) { const re = new RegExp(only, "i"); scenarios = scenarios.filter((s) => re.test(s.name) || re.test(s.family)); }
scenarios.sort((a, b) => Number(!!a.time) - Number(!!b.time)); // moving the simulated clock changes everything for everyone: those go last
if (listOnly) { const by: Record<string, number> = {}; for (const s of scenarios) by[s.family] = (by[s.family] ?? 0) + 1; console.log(JSON.stringify({ seed, total: scenarios.length, by })); if (args.includes("--names")) console.log(scenarios.map((s) => s.name).join("\n")); process.exit(0); }

mkdirSync(join(ROOT, "sim"), { recursive: true });
const sim = await startSim({ port: PORT, runFile: join(ROOT, `sim/matrix-seed${seed}.sqlite`), build: false });

// record every response the harness sees: 5xx and unfriendly refusals are defects in every scenario
let CUR: any = null;
const inner = globalThis.fetch.bind(globalThis);
(globalThis as any).fetch = async (input: any, init?: any) => {
  const r = await inner(input, init);
  if (CUR) {
    try {
      const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); const m = (init?.method ?? "GET").toUpperCase();
      if (/^\/(api|ai|j)\//.test(u.pathname)) {
        CUR.calls++;
        if (r.status >= 500) CUR.fivexx.push(`${m} ${u.pathname} -> ${r.status}`);
        else if (r.status >= 400 && !/\.(csv|pdf)$/.test(u.pathname) && !u.pathname.startsWith("/j/")) {
          const txt = await r.clone().text(); let j: any = null; try { j = JSON.parse(txt); } catch { /* not json */ }
          const why = L.friendly(j); if (why) CUR.unfriendly.push(`${m} ${u.pathname} -> ${r.status}: ${why}${j ? "" : " [" + txt.slice(0, 60).replace(/\s+/g, " ") + "]"}`);
        }
      }
    } catch { /* never let bookkeeping break a scenario */ }
  }
  return r;
};

const results: any[] = []; const t0 = Date.now(); let nChecks = 0; const ever = new Set<string>(["sim@example.com"]); // every address that was ever an Organizer, Host or payer of any scenario (the clock-moving scenarios make the lifecycle tick mail older games too)
const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("scenario timeout " + ms + " ms")), ms))]);
let i = 0;
for (const sc of scenarios) {
  i++;
  const t = new L.T(sc, seed); t.calls = 0; t.fivexx = []; t.unfriendly = []; CUR = t;
  const s0 = Date.now();
  try { await A.mailbox.clear(); await withTimeout(sc.run(t), sc.timeoutMs ?? 90_000); }
  catch (e: any) { t.check("no exception", false, (e?.message ?? String(e)).slice(0, 300)); }
  // global invariants
  try {
    t.check("no server error (5xx) on any call", t.fivexx.length === 0, t.fivexx.slice(0, 3).join(" | "));
    if (!sc.allowUnfriendly) t.check("every refusal is a short plain sentence", t.unfriendly.length === 0, t.unfriendly.slice(0, 3).join(" | "));
    if (!sc.noMailCheck) {
      for (const e of t.team) ever.add(e); const mails = await A.mailbox.list(); const ok = ever;
      const bad = mails.filter((m: any) => !ok.has(m.to.toLowerCase())).map((m: any) => `${m.to}: ${m.subject}`);
      t.check("e-mail only to Organizer, Hosts and the payer", bad.length === 0, bad.slice(0, 3).join(" | ") || `${mails.length} mails`);
    }
    const dbl = await A.sql("SELECT eid, COUNT(*) c FROM payment WHERE status='paid' AND eid IS NOT NULL GROUP BY eid HAVING c>1");
    t.check("nobody paid twice for one game", dbl.length === 0, JSON.stringify(dbl).slice(0, 200));
  } catch (e: any) { t.check("global invariants ran", false, e?.message); }
  CUR = null;
  if (sc.time) { try { await clock.reset(); } catch { /* ignore */ } }
  const failed = t.checks.filter((c: any) => !c.ok); nChecks += t.checks.length;
  results.push({ name: sc.name, family: sc.family, ok: failed.length === 0, ms: Date.now() - s0, calls: t.calls, checks: t.checks.length, failed });
  if (failed.length) console.log(`FAIL [${sc.family}] ${sc.name}\n` + failed.slice(0, 5).map((c: any) => `     - ${c.name} | ${c.detail}`).join("\n"));
  else if (args.includes("--verbose")) console.log(`ok   [${sc.family}] ${sc.name}`);
  if (i % 50 === 0) console.log(`... ${i}/${scenarios.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
const passed = results.filter((r) => r.ok).length; const by: Record<string, { total: number; failed: number }> = {};
for (const r of results) { by[r.family] ??= { total: 0, failed: 0 }; by[r.family]!.total++; if (!r.ok) by[r.family]!.failed++; }
const usage = await A.sql("SELECT day, writes FROM usage WHERE day NOT LIKE '%~%' ORDER BY writes DESC LIMIT 1");
const health = await (await inner(`http://localhost:${PORT}/__sim/health`)).json() as any;
const summary = { seed, total: results.length, passed, failed: results.length - passed, checks: nChecks, byFamily: by, seconds: Math.round((Date.now() - t0) / 1000), peakWrites: usage[0] ?? null, blockedFetches: health.blockedFetches };
writeFileSync(join(ROOT, `sim/matrix-result-seed${seed}.json`), JSON.stringify({ summary, results }, null, 1));
console.log(`MATRIX seed=${seed} scenarios=${results.length} passed=${passed} failed=${results.length - passed} checks=${nChecks} seconds=${summary.seconds} peakWrites=${usage[0]?.writes ?? 0} blockedFetches=${health.blockedFetches.length}`);
console.log(JSON.stringify(by));
sim.stop(); process.exit(0);
