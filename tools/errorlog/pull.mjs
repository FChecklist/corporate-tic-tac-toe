// Pulls every error that is still open (new or reopened) from the error box into plain report files, one file per error, ready for the owner's AI.
//   node tools/errorlog/pull.mjs            -> writes errors/inbox/<id>.md and prints a short list
//   node tools/errorlog/pull.mjs --all      -> also the ones already fixed (to look at the history)
// The key is read from config/telemetry-report-key.txt (kept off GitHub). ERRORLOG_URL changes the site (default https://tictactoe.corporatetambola.com).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = (process.env.ERRORLOG_URL ?? "https://tictactoe.corporatetambola.com").replace(/\/$/, "");
const fromFile = (f, re) => { try { const t = readFileSync(join(ROOT, f), "utf8"); return re ? (t.match(re) ?? [])[1] ?? "" : t; } catch { return ""; } };
const KEY = (process.env.REPORT_KEY || fromFile("config/telemetry-report-key.txt") || fromFile("config/live-secrets.txt", /^REPORT_KEY=(\S+)/m)).trim(); // kept off GitHub
if (!KEY) { console.error("No report key: it is in config/live-secrets.txt (REPORT_KEY=...) or config/telemetry-report-key.txt"); process.exit(2); }
const H = { authorization: `Bearer ${KEY}` };
const status = process.argv.includes("--all") ? "all" : "open";
const list = await fetch(`${BASE}/api/blackbox?status=${status}`, { headers: H });
if (!list.ok) { console.error("Could not read the error box: HTTP " + list.status); process.exit(3); }
const { groups } = await list.json();
const dir = join(ROOT, "errors/inbox"); mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith(".md")) rmSync(join(dir, f)); // the inbox always shows exactly what is open now
for (const g of groups) {
  const r = await fetch(`${BASE}/api/blackbox?fp=${g.fp}&format=md`, { headers: H });
  writeFileSync(join(dir, `${g.fp}.md`), r.ok ? await r.text() : `# Error ${g.fp}\n\n(the full report could not be read: HTTP ${r.status})\n`);
}
if (!groups.length) console.log("No open errors. Nothing to fix.");
else {
  console.log(`${groups.length} open error(s). Reports are in errors/inbox/:`);
  for (const g of groups) console.log(`  ${g.status.padEnd(8)} ${g.sev.padEnd(5)} seen ${String(g.n).padStart(4)}x  ${g.fp}  ${g.page}  ${g.msg.slice(0, 90)}`);
}
