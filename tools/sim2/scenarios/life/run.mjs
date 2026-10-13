// Runs the life scenarios against the life sim server (port 8803, own database sim/life.sqlite). Starts the server if it is not running (and stops it again if it started it).
//   node tools/sim2/scenarios/life/run.mjs --seed 1 [--only R01,K05] [--prefix K] [--out sim/life-result-1.json] [--keep]
// Prints one line per scenario and a summary; writes the full result JSON (every failed assertion with its detail).
import "./port.mjs";
import { spawn } from "node:child_process";
import { mkdirSync, openSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BUN, ROOT, SIM, sleep } from "../../lib/env.mjs";
import { scenarios, runOne } from "./lib.mjs";
import { KNOWN } from "./known.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : (process.argv[i + 1]?.startsWith("--") || process.argv[i + 1] === undefined ? true : process.argv[i + 1]); };
const seed = String(arg("seed", "1")), only = arg("only", "") ? String(arg("only")).split(",") : null, prefix = arg("prefix", "") ? String(arg("prefix")) : null;
const alive = async () => { try { return (await fetch(SIM + "/__sim/health")).ok; } catch { return false; } };

let proc = null;
if (!(await alive())) {
  mkdirSync(join(ROOT, "sim"), { recursive: true }); const out = openSync(join(ROOT, "sim/life-server.log"), "w");
  proc = spawn(BUN, [join(here, "server.ts")], { cwd: ROOT, env: { ...process.env }, stdio: ["ignore", out, out], windowsHide: true });
  for (let i = 0; i < 200 && !(await alive()); i++) await sleep(300);
  if (!(await alive())) { console.error("life sim server did not start; see sim/life-server.log"); process.exit(2); }
}
for (const f of readdirSync(here).filter((f) => /^s-.*\.mjs$/.test(f)).sort()) await import(pathToFileURL(join(here, f)).href);
const todo = scenarios.filter((s) => (!only || only.includes(s.id)) && (!prefix || s.id.startsWith(prefix)));
const out = []; let pass = 0, gap = 0, fail = 0;
for (const s of todo) {
  const r = await runOne(s, seed);
  const known = r.failed.length && r.failed.every((f) => KNOWN[s.id]?.some((k) => f.name.startsWith(k.check))) ? [...new Set(r.failed.map((f) => KNOWN[s.id].find((k) => f.name.startsWith(k.check)).gap))] : null;
  r.status = r.ok ? "pass" : known ? "known-gap" : "FAIL"; r.gaps = known ?? undefined;
  if (r.ok) pass++; else if (known) gap++; else fail++;
  out.push(r);
  console.log(`${r.status.padEnd(9)} ${s.id.padEnd(4)} ${String(r.checks).padStart(3)} checks ${String(r.ms).padStart(5)} ms  ${s.title}${known ? "  [" + known.join(",") + "]" : ""}`);
  if (!r.ok) for (const f of r.failed) console.log(`            - ${f.name}${f.detail ? ": " + f.detail.slice(0, 240) : ""}`);
}
const health = await (await fetch(SIM + "/__sim/health")).json();
const summary = { seed, scenarios: todo.length, pass, knownGap: gap, fail, checks: out.reduce((a, r) => a + r.checks, 0), blockedFetches: health.blockedFetches };
console.log(`\nSEED ${seed}: ${todo.length} scenarios, ${pass} pass, ${gap} known-gap, ${fail} FAIL, ${summary.checks} checks; blocked outbound fetches: ${health.blockedFetches.length}`);
writeFileSync(arg("out", join(ROOT, `sim/life-result-${seed}.json`)), JSON.stringify({ summary, results: out }, null, 1));
if (proc && !arg("keep", false)) proc.kill();
process.exit(fail ? 1 : 0);
