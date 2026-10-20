// Records that an error was fixed: which files changed and what was done. Run by the owner's AI after it has fixed, tested and committed.
//   node tools/errorlog/resolve.mjs <error id> --files "apps/web/public/z.js,apps/edge/src/worker.ts" --note "what was wrong and what was changed" [--commit abc1234]
// It tells the error box (so the error shows as fixed, and comes back as 'reopened' if it happens again after the fix reaches devices),
// and adds a line to errors/FIXED.md, the readable history of every fix.
import { readFileSync, appendFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = (process.env.ERRORLOG_URL ?? "https://tictactoe.corporatetambola.com").replace(/\/$/, "");
const fromFile = (f, re) => { try { const t = readFileSync(join(ROOT, f), "utf8"); return re ? (t.match(re) ?? [])[1] ?? "" : t; } catch { return ""; } };
const KEY = (process.env.REPORT_KEY || fromFile("config/telemetry-report-key.txt") || fromFile("config/live-secrets.txt", /^REPORT_KEY=(\S+)/m)).trim(); // kept off GitHub
const a = process.argv.slice(2), fp = a[0], val = (n) => { const i = a.indexOf("--" + n); return i >= 0 ? a[i + 1] : ""; };
const files = val("files"), note = val("note"), commit = val("commit");
if (!fp || fp.startsWith("--") || !files || !note) { console.error('Usage: node tools/errorlog/resolve.mjs <error id> --files "path1,path2" --note "what was wrong and what was changed" [--commit sha]'); process.exit(2); }
if (!KEY) { console.error("No report key: it is in config/live-secrets.txt (REPORT_KEY=...) or config/telemetry-report-key.txt"); process.exit(2); }
const r = await fetch(`${BASE}/api/blackbox`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify({ resolve: { fp, files: files.split(",").map((s) => s.trim()), note, commit } }) });
if (!r.ok) { console.error("The error box refused: HTTP " + r.status + " " + (await r.text())); process.exit(3); }
const log = join(ROOT, "errors/FIXED.md");
if (!existsSync(log)) writeFileSync(log, "# Errors fixed\n\nOne entry per fixed error, newest at the bottom. Written by tools/errorlog/resolve.mjs.\n");
appendFileSync(log, `\n## ${fp}  (${new Date().toISOString().slice(0, 16)}Z)\n- Files: ${files}\n- Commit: ${commit || "not given"}\n- What was done: ${note}\n`);
console.log(`Marked ${fp} as fixed and wrote it to errors/FIXED.md`);
