// TEST / LIVE mode of the whole service (owner-controlled, stored in D1). Added 2026-10-06. Plain words: docs/TEST_AND_LIVE_MODE.md.
//   LIVE (the default, and what an un-migrated database behaves as): nothing here changes any behaviour.
//   TEST: so the owner can walk the whole product end to end without touching real people or real numbers:
//     - every engagement, organizer account, partner and payment made meanwhile carries is_test = 1;
//     - ALL outbound e-mail goes only to the owner's allow-list (everything else is dropped and logged as 'suppressed_test_mode');
//     - a labelled test payment (no Razorpay, nothing charged) can publish an engagement;
//     - test data stays out of the visitor reports, funnels, commission figures and owner lists (they show LIVE data unless ?mode=test is asked for);
//     - the owner can delete all test data in one call (test-data.ts).
//   The switch itself is owner-only (the platform key, never through an AI work link), and every switch is written to the owner's access log (audit_access).
//   The mode is read at most every few seconds per Worker instance (a switch is visible everywhere within TTL_MS; the instance that handled the switch sees it at once).
import { logAccess } from "./audit";
import type { D1, Env } from "./worker";

export type SiteMode = "TEST" | "LIVE";
export interface ModeEnv extends Env { OWNER_EMAIL?: string; TEST_MAIL_ALLOW?: string; COMPANY_JSON?: string }

/** is_test marks everything made while the service was in TEST mode (0 = real). The mode row defaults to LIVE. */
export const MODE_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS mode (id INTEGER PRIMARY KEY CHECK (id = 1), mode TEXT NOT NULL DEFAULT 'LIVE', changed_ms INTEGER NOT NULL DEFAULT 0, reason TEXT)`,
  `INSERT OR IGNORE INTO mode(id,mode,changed_ms,reason) VALUES(1,'LIVE',0,'default')`,
  `CREATE TABLE IF NOT EXISTS test_mail_allow (email TEXT PRIMARY KEY, added_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS mail_event (id INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, to_hash TEXT NOT NULL, subject TEXT, outcome TEXT NOT NULL)`,
  `ALTER TABLE engagement ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE payment ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE partner ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE commission ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE organizer_key ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE organizer_email ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE visit_session ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0`,
];

export const TTL_MS = 5000;
const cache = new WeakMap<object, { m: SiteMode; at: number }>();
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

/** The current mode. Cached for TTL_MS per database handle. If the row cannot be read, the last known mode is kept (a TEST service never quietly turns LIVE on a database hiccup); with no history it is LIVE. */
export async function getMode(env: { DB: D1 }): Promise<SiteMode> {
  const c = cache.get(env.DB), t = Date.now();
  if (c && t - c.at < TTL_MS) return c.m;
  let m: SiteMode = c?.m ?? "LIVE";
  try { const r = await env.DB.prepare("SELECT mode FROM mode WHERE id=1").first<{ mode: string }>(); m = r?.mode === "TEST" ? "TEST" : "LIVE"; } catch { /* keep the last known mode */ }
  cache.set(env.DB, { m, at: t });
  return m;
}
export const isTestMode = async (env: { DB: D1 }) => (await getMode(env)) === "TEST";
/** 1 when the service is in TEST mode right now (the value stored in is_test), else 0. */
export const testFlag = async (env: { DB: D1 }): Promise<0 | 1> => ((await getMode(env)) === "TEST" ? 1 : 0);
/** True when this organizer account was made in TEST mode. */
export async function orgIsTest(env: { DB: D1 }, org: string | null | undefined): Promise<boolean> {
  if (!org) return false;
  try { return !!(await env.DB.prepare("SELECT 1 AS x FROM organizer_key WHERE org=? AND is_test=1 LIMIT 1").bind(org).first()); } catch { return false; }
}
/** Tests and local tools: set the mode directly (the owner's own switch is POST /api/owner/mode). */
export async function setMode(env: { DB: D1 }, to: SiteMode, reason: string, now: number): Promise<SiteMode> {
  const from = await getMode(env);
  await env.DB.prepare("INSERT INTO mode(id,mode,changed_ms,reason) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode, changed_ms=excluded.changed_ms, reason=excluded.reason").bind(to, now, reason.slice(0, 200)).run();
  cache.set(env.DB, { m: to, at: Date.now() });
  return from;
}

// ------------------------------------------------------------------------------------------------ the e-mail allow-list
/** gmail-style plus addresses (owner+t1@x.com) count as the owner's own address, so a test can use many accounts that all reach the owner. */
export const normMail = (e: string): string => { const v = String(e ?? "").trim().toLowerCase(); const i = v.lastIndexOf("@"); return i < 1 ? v : v.slice(0, i).split("+")[0] + v.slice(i); };
function defaultAllow(env: ModeEnv): string[] {
  const out: string[] = [];
  for (const x of [env.OWNER_EMAIL, ...(env.TEST_MAIL_ALLOW ?? "").split(",")]) if (x && x.trim()) out.push(x);
  if (!out.length) { try { const e = JSON.parse(env.COMPANY_JSON ?? "{}").email; if (typeof e === "string" && e.trim()) out.push(e); } catch { /* none */ } }
  return out.map(normMail).filter((x) => x.includes("@"));
}
/** The addresses TEST mode may e-mail: the owner's list when it has entries, else the owner's address from the configuration (OWNER_EMAIL, TEST_MAIL_ALLOW, or the company e-mail). */
export async function allowList(env: ModeEnv): Promise<string[]> {
  let rows: { email: string }[] = [];
  try { rows = (await env.DB.prepare("SELECT email FROM test_mail_allow ORDER BY email").all<{ email: string }>()).results ?? []; } catch { /* default below */ }
  return rows.length ? rows.map((r) => r.email) : [...new Set(defaultAllow(env))];
}
export async function mailAllowed(env: ModeEnv, to: string): Promise<boolean> { return (await allowList(env)).includes(normMail(to)); }
export async function logMail(db: D1, now: number, to: string, subject: string, outcome: string): Promise<void> {
  try { await db.prepare("INSERT INTO mail_event(at_ms,to_hash,subject,outcome) VALUES(?,?,?,?)").bind(now, await sha(normMail(to)), String(subject).slice(0, 120), outcome).run(); } catch { /* best effort */ }
}
/** In TEST mode: may this mail go out? Records the outcome either way. LIVE: always true and nothing recorded. */
export async function mailGate(env: ModeEnv, to: string, subject: string, now: number): Promise<boolean> {
  if ((await getMode(env)) !== "TEST") return true;
  const ok = await mailAllowed(env, to);
  await logMail(env.DB, now, to, subject, ok ? "sent_test_allowlist" : "suppressed_test_mode");
  return ok;
}

// ------------------------------------------------------------------------------------------------ the routes
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const readBody = async (req: Request): Promise<any | null> => { const t = await req.text(); if (t.length > 4096) return null; try { const v = JSON.parse(t); return v && typeof v === "object" ? v : null; } catch { return null; } };
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/**
 * GET /api/mode (public, read-only: only the word TEST or LIVE) and the owner-only routes under /api/owner/ (platform key, never through an AI work link; anybody else gets the
 * same 404 as an unknown address, and the attempt is written to the access log):
 *   GET|POST /api/owner/mode {mode, reason}      GET|POST /api/owner/test-mail {add?|remove?}      POST /api/owner/purge-test-data {confirm}  (see test-data.ts)
 */
export async function modeRoute(req: Request, env: ModeEnv, now: number, owner: boolean, purge: (now: number) => Promise<Record<string, number>>): Promise<Response | null> {
  const p = new URL(req.url).pathname;
  if (p === "/api/mode") { if (req.method !== "GET") return json({ error: "Not found" }, 404); return json({ mode: await getMode(env) }); }
  const om = p.match(/^\/api\/owner\/(mode|test-mail|purge-test-data)$/);
  if (!om) return null;
  const what = om[1]!;
  if (!owner) { await logAccess(env.DB, now, "denied:" + what, null, null, 0, false, null); return json({ error: "Not found" }, 404); }
  if (what === "mode") {
    if (req.method === "GET") { const r = await env.DB.prepare("SELECT mode, changed_ms, reason FROM mode WHERE id=1").first<any>(); return json({ mode: await getMode(env), changedMs: r?.changed_ms ?? 0, reason: r?.reason ?? null }); }
    if (req.method !== "POST") return json({ error: "Not found" }, 404);
    const b = await readBody(req); const to = String(b?.mode ?? "").toUpperCase();
    if (to !== "TEST" && to !== "LIVE") return json({ error: "Say which mode: TEST or LIVE." }, 400);
    const reason = typeof b?.reason === "string" ? b.reason.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200) : "";
    const from = await setMode(env, to, reason, now);
    await logAccess(env.DB, now, "mode-switch", null, null, 0, true, `${from}->${to}${reason ? ": " + reason : ""}`);
    const left = to === "LIVE" ? Number((await env.DB.prepare("SELECT (SELECT COUNT(*) FROM engagement WHERE is_test=1) + (SELECT COUNT(*) FROM organizer_key WHERE is_test=1) + (SELECT COUNT(*) FROM payment WHERE is_test=1) + (SELECT COUNT(*) FROM partner WHERE is_test=1) AS n").first<{ n: number }>())?.n ?? 0) : 0;
    return json({ ok: true, mode: to, was: from, changedMs: now, ...(to === "LIVE" && left ? { testRecordsLeft: left, hint: "Test records are kept apart from real ones. Delete them with POST /api/owner/purge-test-data when you are done." } : {}) });
  }
  if (what === "test-mail") {
    if (req.method === "GET") return json({ allowed: await allowList(env), fromList: ((await env.DB.prepare("SELECT COUNT(*) AS c FROM test_mail_allow").first<{ c: number }>())?.c ?? 0) > 0 });
    if (req.method !== "POST") return json({ error: "Not found" }, 404);
    const b = await readBody(req); const add = typeof b?.add === "string" ? b.add.trim().toLowerCase() : "", rem = typeof b?.remove === "string" ? b.remove.trim().toLowerCase() : "";
    if (add) { if (!EMAIL.test(add)) return json({ error: "Enter a valid e-mail address." }, 400); await env.DB.prepare("INSERT OR IGNORE INTO test_mail_allow(email,added_ms) VALUES(?,?)").bind(normMail(add), now).run(); }
    if (rem) await env.DB.prepare("DELETE FROM test_mail_allow WHERE email=?").bind(normMail(rem)).run();
    if (!add && !rem) return json({ error: "Give an address to add or to remove." }, 400);
    await logAccess(env.DB, now, "test-mail-allowlist", null, null, 1, true, add ? "add" : "remove");
    return json({ ok: true, allowed: await allowList(env) });
  }
  if (req.method !== "POST") return json({ error: "Not found" }, 404);
  const b = await readBody(req);
  if (b?.confirm !== "purge test data") return json({ error: 'This deletes every test game, account, partner and payment. Send {"confirm":"purge test data"} to go ahead.' }, 400);
  return json({ ok: true, deleted: await purge(now) });
}
