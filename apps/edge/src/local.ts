// Local stand-in for "Cloudflare Pages + one Worker + D1": serves the app files and the Worker's API from one port, with the
// database in a local SQLite file. Run: bun run apps/edge/src/local.ts   (env: PORT, ORGANIZER_SECRET, DB_FILE)
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { SCHEMA, handle, purgeOld, type D1, type D1Stmt } from "./worker";
import type { PayEnv } from "./pay";

/** Test tool only: how many database reads and writes the request in progress made (SQL_COUNT_LOG=<file> writes one line per request; exact when requests come one at a time). */
const SQLN = { r: 0, w: 0 };
/** Test tool only: D1_READ_MS / D1_WRITE_MS make every database read / write wait that long (like a real D1 call), so a local load run is not unrealistically fast. Default 0. */
const LAT_R = Number(process.env.D1_READ_MS ?? 0) || 0, LAT_W = Number(process.env.D1_WRITE_MS ?? 0) || 0;
export function sqliteD1(file: string): { db: D1; raw: Database } {
  const raw = new Database(file, { create: true });
  raw.run("PRAGMA journal_mode=WAL"); raw.run("PRAGMA busy_timeout=5000"); // a test tool reading the file at the same moment must not make a write fail
  for (const s of SCHEMA) { try { raw.run(s); } catch (e: any) { if (!/duplicate column name/i.test(String(e?.message))) throw e; } } // an ALTER for a column the CREATE already has (older databases need the ALTER) is not an error
  const stmt = (sql: string, vals: unknown[] = []): D1Stmt => ({
    bind: (...v) => stmt(sql, v),
    run: async () => { SQLN.w++; if (LAT_W) await new Promise((r) => setTimeout(r, LAT_W)); const r = raw.query(sql).run(...(vals as any[])); return { meta: { changes: r.changes } }; },
    all: async () => { SQLN.r++; if (LAT_R) await new Promise((r) => setTimeout(r, LAT_R)); return { results: raw.query(sql).all(...(vals as any[])) as any[] }; },
    first: async () => { SQLN.r++; if (LAT_R) await new Promise((r) => setTimeout(r, LAT_R)); return (raw.query(sql).get(...(vals as any[])) as any) ?? null; },
  });
  return { db: { prepare: (s) => stmt(s), batch: async (xs) => Promise.all(xs.map((x) => x.run())) }, raw };
}

export function startLocal(o: { port?: number; secret?: string; dbFile?: string; webDir?: string; budget?: string; mode?: "TEST" | "LIVE" } = {}) {
  const webDir = o.webDir ?? join(import.meta.dir, "../../web/public");
  const { db, raw } = sqliteD1(o.dbFile ?? ":memory:");
  const pe = process.env;
  { const m = (o.mode ?? pe.CB_MODE ?? "").toUpperCase(); if (m === "TEST" || m === "LIVE") raw.run("UPDATE mode SET mode=?, changed_ms=?, reason=? WHERE id=1", [m, Date.now(), "local start (CB_MODE / startLocal mode)"]); } // docs/TEST_AND_LIVE_MODE.md: run the local tools against TEST mode
  const env: PayEnv = { DB: db, TEST_MODE: pe.TEST_MODE, COMPANY_JSON: pe.COMPANY_JSON, PUBLIC_ORIGIN: pe.PUBLIC_ORIGIN, RAZORPAY_KEY_ID: pe.RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET: pe.RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: pe.RAZORPAY_WEBHOOK_SECRET, RAZORPAY_BASE_URL: pe.RAZORPAY_BASE_URL, RESEND_API_KEY: pe.RESEND_API_KEY, MAIL_FROM: pe.MAIL_FROM, MAIL_REPLY_TO: pe.MAIL_REPLY_TO, ORGANIZER_SECRET: o.secret ?? process.env.ORGANIZER_SECRET ?? "local-organizer-secret", DAILY_WRITE_BUDGET: o.budget ?? process.env.DAILY_WRITE_BUDGET ?? "80000" };
  // /version.json for local work: the live site's file says which commit is live; here it also carries `rev`, the newest file time under the web folder, so a saved edit changes it and open pages reload themselves (autoupdate.js)
  let verCache: { at: number; body: string } | null = null;
  const newest = (dir: string): number => { let m = 0; for (const e of readdirSync(dir, { withFileTypes: true })) { const f = join(dir, e.name); m = Math.max(m, e.isDirectory() ? (e.name === "node_modules" ? 0 : newest(f)) : statSync(f).mtimeMs); } return m; };
  const versionBody = () => {
    if (verCache && Date.now() - verCache.at < 1000) return verCache.body;
    let commit = "local"; try { commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: webDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* not in git */ }
    const body = JSON.stringify({ commit, rev: Math.round(newest(webDir)), game: "local", note: "local test copy" });
    verCache = { at: Date.now(), body }; return body;
  };
  const server = Bun.serve({
    port: o.port ?? Number(process.env.PORT ?? 8788),
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/ai/")) {
        const log = process.env.SQL_COUNT_LOG; if (!log) return handle(req, env);
        const r0 = SQLN.r, w0 = SQLN.w, res = await handle(req, env); (await import("node:fs")).appendFileSync(log, `${req.method} ${u.pathname.replace(/[A-Z0-9_-]{6,}/g, ":id")} reads=${SQLN.r - r0} writes=${SQLN.w - w0} status=${res.status}
`); return res;
      }
      if (u.pathname === "/version.json") return new Response(versionBody(), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      const rel = u.pathname === "/" ? "/index.html" : u.pathname;
      if (rel.includes("..")) return new Response("Not found", { status: 404 });
      const f = Bun.file(join(webDir, rel));
      return (await f.exists()) ? new Response(f, { headers: { "cache-control": "no-store" } }) : new Response("Not found", { status: 404 });
    },
  });
  return { server, env, raw, url: `http://localhost:${server.port}`, purge: () => purgeOld(env, Date.now()) };
}

/** Local use: one organizer account whose key is kept in a file next to the database, so the console keeps its history across restarts. */
export async function localOrganizerKey(s: ReturnType<typeof startLocal>, keyFile: string): Promise<string> {
  const f = Bun.file(keyFile);
  if (await f.exists()) { const k = (await f.text()).trim(); if (k) return k; }
  const r = await handle(new Request("http://x/api/org", { method: "POST", headers: { "x-organizer": s.env.ORGANIZER_SECRET! } }), s.env);
  const key = ((await r.json()) as any).organizerKey as string;
  await Bun.write(keyFile, key);
  return key;
}

if (import.meta.main) {
  const dbFile = process.env.DB_FILE ?? "ttt-local.sqlite";
  const s = startLocal({ dbFile });
  const key = await localOrganizerKey(s, dbFile + ".organizer-key");
  console.log(`Corporate Tic Tac Toe (zero-server mode, local) on ${s.url}
  organizer page: ${s.url}/zc.html
  organizer key:  ${key}`);
}
