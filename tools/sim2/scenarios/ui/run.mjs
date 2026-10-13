// node tools/sim2/scenarios/ui/run.mjs [--only S01,S05-] [--file s03] [--list] [--keep] [--build] [--shots-only-fail]
// The UI scenario runner. Starts (or reuses) ITS OWN sim server on :8804 (own database sim/run-ui.sqlite) and WhatsApp simulator on :8891, launches ONE real Chrome
// (C:\Program Files\Google\Chrome\Application\chrome.exe) and runs the scenarios in tools/sim2/scenarios/ui/s*.mjs one after the other (max 6 browser contexts at once).
// Results: sim/ui-results.json and a summary on the console; screenshots in test-results/sim-ui/. Never touches the live site (every context blocks non-localhost requests).
// Ports can be changed with UI_SIM_PORT / UI_WA_PORT.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// a late answer to a request of a page that was just closed must not stop the whole run
process.on("unhandledRejection", (e) => console.error("(late browser error ignored: " + String(e?.message ?? e).split(/\r?\n/)[0].slice(0, 160) + ")"));
process.env.SIM_PORT = process.env.UI_SIM_PORT ?? "8804";
process.env.WA_PORT = process.env.UI_WA_PORT ?? "8891";
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n), val = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };

const { makeT, H } = await import("./kit.mjs");
const only = (val("only") ?? "").split(",").filter(Boolean), fileFilter = val("file");

// ---- load scenarios
const files = readdirSync(HERE).filter((f) => /^s\d\d.*\.mjs$/.test(f) && (!fileFilter || f.startsWith(fileFilter))).sort();
const all = [];
for (const f of files) { const m = await import(pathToFileURL(join(HERE, f)).href); for (const sc of m.default) all.push({ ...sc, file: f }); }
const matches = (sc) => !only.length || only.some((o) => (o.endsWith("-") ? sc.id.startsWith(o.slice(0, -1)) : sc.id === o));
const todo = all.filter(matches);
if (flag("list")) { for (const s of all) console.log(`${s.id}  ${s.file}  ${s.name}`); console.log(`${all.length} scenarios`); process.exit(0); }

// ---- stack (own ports, own db)
const up = async (url, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ } await H.sleep(300); } return false; };
const alive = async (url) => { try { return (await fetch(url)).ok; } catch { return false; } };
const procs = [];
mkdirSync(join(H.ROOT, "sim"), { recursive: true });
if (flag("build")) { const r = spawnSync("node", [join(H.ROOT, "pages/build.mjs")], { cwd: H.ROOT, encoding: "utf8" }); if (r.status !== 0) { console.error("pages/build.mjs failed", r.stderr); process.exit(2); } }
// (re)starts what is not answering; another agent's cleanup may kill bun processes, so this runs before every scenario too
let restarts = 0;
const ensureStack = async () => {
  if (!(await alive(H.SIM + "/__sim/health"))) {
    restarts++;
    const out = openSync(join(H.ROOT, "sim/ui-server.log"), "w");
    procs.push(spawn(H.BUN, [join(HERE, "server-ui.ts")], { cwd: H.ROOT, env: { ...process.env, UI_SIM_PORT: process.env.SIM_PORT, SIM_BUILD: "0" }, stdio: ["ignore", out, out], windowsHide: true }));
    if (!(await up(H.SIM + "/__sim/health"))) { console.error("sim server did not come up: see sim/ui-server.log"); process.exit(2); }
  }
  if (!(await alive(H.WA + "/health"))) {
    restarts++;
    const out = openSync(join(H.ROOT, "sim/ui-wa.log"), "w");
    procs.push(spawn(H.BUN, [join(H.ROOT, "tools/sim2/whatsapp/server.ts")], { cwd: H.ROOT, env: { ...process.env, WA_PORT: process.env.WA_PORT }, stdio: ["ignore", out, out], windowsHide: true }));
    if (!(await up(H.WA + "/health", 20000))) { console.error("WhatsApp simulator did not come up: see sim/ui-wa.log"); process.exit(2); }
  }
};
await ensureStack();
// A reset through /__sim/reset can fail on Windows (EBUSY on the old sqlite file) and then leaves the server with a closed database (sim gap E1), so a failed reset restarts OUR server
// (only the process that listens on our own port) which copies a fresh database at start-up.
const killOurServer = () => { spawnSync("powershell", ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${process.env.SIM_PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { encoding: "utf8" }); };
const resetAll = async () => {
  let ok = false; try { const r = await fetch(H.SIM + "/__sim/reset", { method: "POST", body: "{}" }); ok = r.ok; } catch { /* server gone */ }
  if (!ok) { killOurServer(); await H.sleep(800); restarts--; await ensureStack(); }
  await fetch(H.WA + "/api/all", { method: "DELETE" }).catch(() => {});
};
await resetAll();
const track = await H.trackClock();
const browser = await H.launchChrome();
const open = H.opener(browser, { track });
const shared = { browser, open, track };

// ---- run
const results = []; const t00 = Date.now();
const SCEN_TIMEOUT = Number(process.env.UI_SCEN_TIMEOUT ?? 240000);
for (const sc of todo) {
  await ensureStack(); await track.refresh();
  const t = makeT(sc, shared); const t0 = Date.now(); let error = null;
  try { t.mailBase = (await H.mailbox.list()).length; } catch { t.mailBase = 0; } // mails that existed before this scenario started (so a check looks only at what THIS scenario's game sent)
  try {
    await Promise.race([sc.run(t), new Promise((_, no) => setTimeout(() => no(new Error(`scenario timeout after ${SCEN_TIMEOUT / 1000} s`)), SCEN_TIMEOUT))]);
  } catch (e) { error = String(e?.stack ?? e).split("\n").slice(0, 4).join(" | ").slice(0, 600); }
  // what a tester sees in every page: JS errors, console errors (not the expected 4xx/blocked-resource lines), 5xx answers
  let js = [], cons = [], srv = [];
  for (const x of t.pages) { js.push(...x.mon.pageErrors.map((m) => `${x.label}: ${m}`)); cons.push(...x.mon.console.filter((c) => !/Failed to load resource/.test(c)).map((m) => `${x.label}: ${m}`)); srv.push(...x.mon.http5xx.map((m) => `${x.label}: ${m}`)); }
  if (t.pages.length) {
    t.check("no JavaScript errors in any page", js.length === 0, js.slice(0, 3).join(" | "));
    t.check("no console errors in any page", cons.length === 0, cons.slice(0, 3).join(" | "));
    t.check("no 5xx answers", srv.length === 0, srv.slice(0, 3).join(" | "));
  }
  for (const x of t.pages) { try { await x.close(); } catch { /* closed */ } }
  const failed = t.checks.filter((c) => !c.ok);
  const status = error ? "ERROR" : failed.length ? "FAIL" : "PASS";
  results.push({ id: sc.id, name: sc.name, file: sc.file, status, seconds: Math.round((Date.now() - t0) / 100) / 10, checks: t.checks, notes: t.notes, error, shots: t.shots.length });
  console.log(`${status.padEnd(5)} ${sc.id}  ${sc.name}  (${((Date.now() - t0) / 1000).toFixed(1)} s, ${t.checks.length - failed.length}/${t.checks.length} checks)`);
  for (const c of failed) console.log(`        x ${c.name}${c.detail ? "  | " + c.detail.slice(0, 220) : ""}`);
  if (error) console.log("        ! " + error.slice(0, 400));
  if (sc.resetAfter) { await resetAll(); await track.refresh(); } // time travel changes the clock and the database: start the next scenario clean
}
const pass = results.filter((r) => r.status === "PASS").length;
writeFileSync(join(H.ROOT, "sim/ui-results" + (only.length || fileFilter ? "-partial" : "") + ".json"), JSON.stringify({ at: new Date().toISOString(), seconds: Math.round((Date.now() - t00) / 1000), total: results.length, pass, results }, null, 1));
console.log(`\n${pass}/${results.length} scenarios passed in ${Math.round((Date.now() - t00) / 1000)} s; failed: ${results.filter((r) => r.status !== "PASS").map((r) => r.id).join(", ") || "none"}`);
if (restarts) console.log(`(the sim stack was restarted ${restarts} time(s) during the run: something outside this suite stopped it)`);
const health = await fetch(H.SIM + "/__sim/health").then((r) => r.json()).catch(() => ({ blockedFetches: [] }));
if (health.blockedFetches?.length) console.log("BLOCKED outbound fetches (should be none): " + health.blockedFetches.join(", "));
try { await browser.close(); } catch { /* closed */ }
if (!flag("keep")) for (const p of procs) { try { p.kill(); } catch { /* gone */ } }
process.exit(results.length - pass ? 1 : 0);
