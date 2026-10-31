// First-party SALES FUNNEL (owner order 1 Nov 2026): where people get to, from the first look to a finished game. Our own Worker and D1 only, no third-party script, no personal details.
// A row is one step reached by one visit or one game: (key, event). The key is a random 12-character id the page made for that page load (core makeReporter), or, for the steps the
// server sees, the first 12 characters of a hash of the game or payment id. Neither says anything about a person. The same step is kept once per key.
// A browser with Global Privacy Control or Do Not Track is not counted at all (the page sends nothing, the route drops anything that still arrives).
// Switch: FUNNEL_EVENTS = "on" turns it on. It is OFF until the owner has audited it: with any other value nothing is written and the report only shows what was already kept.
// The table is created here, the first time it is needed (CREATE TABLE IF NOT EXISTS), so there is no migration to apply before switching on; every write is guarded and never breaks a game or a payment.
import { FUNNEL_EVENTS, cleanProps, type FunnelEvent } from "../../../vendor/game-core/packages/core/src/funnel";
import type { D1 } from "./worker";

export { FUNNEL_EVENTS };
export type FunEnv = { DB: D1; FUNNEL_EVENTS?: string };
export const funnelOn = (env: { FUNNEL_EVENTS?: string }) => env.FUNNEL_EVENTS === "on";

/** The steps in order, with the words the owner reads. payment_failed is a side branch of the payment, not a step on the way to the next one. */
export const FUN_LABELS: Record<FunnelEvent, string> = {
  viewed: "Page viewed", size_chosen: "Size chosen", signup_started: "Sign-up started", game_created: "Game created", game_published: "Game published",
  payment_page_reached: "Payment page reached", payment_page_opened: "Payment page opened", payment_link_copied: "Payment link copied", payment_started: "Payment started",
  payment_succeeded: "Payment succeeded", payment_failed: "Payment failed", game_started: "Game started", game_completed: "Game completed",
};
/** What a public page may report. The other steps are written by the server, from what it sees. */
export const PAGE_EVENTS = new Set<string>(["viewed", "size_chosen", "signup_started", "payment_page_opened"]);
export const SERVER_EVENTS = new Set<string>(["game_created", "game_published", "payment_page_reached", "payment_link_copied", "payment_started", "payment_succeeded", "payment_failed", "game_started", "game_completed"]);
export const FUNNEL_RETENTION_DAYS = 400;
const DAY = 86_400_000, MAX_BODY = 600, PER_MINUTE = 60;
/** TEST mode (the mode row mode.ts keeps): nothing made while the owner is trying the site is counted. Read here so this file stays free of the heavier modules. */
const isTestMode = async (env: { DB: D1 }): Promise<boolean> => { try { return (await env.DB.prepare("SELECT mode FROM mode WHERE id=1").first<{ mode: string }>())?.mode === "TEST"; } catch { return false; } };
const hits = new Map<string, number[]>();
export const resetFunnelRate = () => hits.clear();
const rateLimited = (key: string, now: number, max: number): boolean => { const a = (hits.get(key) ?? []).filter((t) => now - t < 60_000); if (a.length >= max) { hits.set(key, a); return true; } a.push(now); hits.set(key, a); if (hits.size > 5000) hits.clear(); return false; };

const made = new WeakSet<object>();
async function ensure(db: D1): Promise<void> {
  if (made.has(db as object)) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS ttt_fun (k TEXT NOT NULL, ev TEXT NOT NULL, at_ms INTEGER NOT NULL, size INTEGER, mode TEXT, reason TEXT, PRIMARY KEY (k, ev))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS ttt_fun_at ON ttt_fun (at_ms)").run();
  made.add(db as object);
}
/** A key that cannot be traced back to a game or a payment by a reader of the table. */
export async function funKey(salt: string | undefined, id: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ttt-fun|${salt ?? ""}|${id}`));
  return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function put(db: D1, k: string, ev: string, now: number, o: { size?: number; mode?: string; reason?: string }): Promise<void> {
  await ensure(db);
  await db.prepare("INSERT OR IGNORE INTO ttt_fun(k,ev,at_ms,size,mode,reason) VALUES(?,?,?,?,?,?)").bind(k, ev, now, o.size ?? null, o.mode ?? null, o.reason ?? null).run();
}

/** A step the server sees, for one game or one payment: kept once per id. Off, a test account, TEST mode or an unknown step writes nothing. Never throws. */
export async function recordFun(env: FunEnv & { PHONE_SALT?: string }, id: string | null | undefined, step: FunnelEvent, now: number, o: { test?: boolean; size?: number; mode?: "auto" | "manual"; reason?: string } = {}): Promise<void> {
  try {
    if (!funnelOn(env) || !id || o.test || !SERVER_EVENTS.has(step) || (await isTestMode(env))) return;
    const c = cleanProps({ size: o.size, mode: o.mode, reason: o.reason });
    await put(env.DB, await funKey(env.PHONE_SALT, id), step, now, c);
  } catch { /* tracking must never break a game or a payment */ }
}

const none = (status = 204) => new Response(null, { status, headers: { "cache-control": "no-store" } });
/** POST /api/f: one event from a public page (the body core makeReporter sends). Quiet by design: a browser never learns why something was dropped. */
export async function funnelBeacon(req: Request, env: FunEnv, now: number): Promise<Response> {
  if (req.method !== "POST") return none(405);
  const origin = req.headers.get("origin");
  if (origin) { let ok = false; try { ok = new URL(origin).hostname.toLowerCase() === new URL(req.url).hostname.toLowerCase() || (!!(env as any).PUBLIC_ORIGIN && new URL(origin).hostname.toLowerCase() === new URL((env as any).PUBLIC_ORIGIN).hostname.toLowerCase()); } catch { /* bad origin */ } if (!ok) return none(403); }
  if (req.headers.get("sec-fetch-site") === "cross-site") return none(403);
  if (req.headers.get("sec-gpc") === "1" || req.headers.get("dnt") === "1") return none(); // Do Not Track / Global Privacy Control: nothing is kept
  if (!funnelOn(env)) return none();
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return none(413);
  let j: any; try { const t = await req.text(); if (t.length > MAX_BODY) return none(413); j = JSON.parse(t); } catch { return none(400); }
  if (!j || typeof j !== "object" || typeof j.event !== "string" || !PAGE_EVENTS.has(j.event) || typeof j.visit !== "string" || !/^[a-z0-9]{12}$/.test(j.visit)) return none(400);
  if (rateLimited("fun/" + (req.headers.get("cf-connecting-ip") ?? "local"), now, PER_MINUTE)) return none(429);
  try {
    if (await isTestMode(env)) return none();
    const c = cleanProps({ size: j.size });
    await put(env.DB, j.visit, j.event, now, { size: c.size });
  } catch { /* quiet */ }
  return none();
}

/** Old rows go after FUNNEL_RETENTION_DAYS (no table, nothing to delete). Never throws. */
export async function sweepFunnel(env: { DB: D1 }, now: number): Promise<void> {
  try { await env.DB.prepare("DELETE FROM ttt_fun WHERE at_ms<?").bind(now - FUNNEL_RETENTION_DAYS * DAY).run(); } catch { /* quiet */ }
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Monday of the week (UTC), as a date. */
export const weekOf = (ms: number) => { const d = new Date(ms), k = (d.getUTCDay() + 6) % 7; return dayOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - k)); };
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
export interface FunRow { step: FunnelEvent; label: string; count: number; ofPrevious: number | null; ofFirst: number | null }
/** Counts per step to rows. The chain is the steps in order except payment_failed; each row says how many of the previous step went on. Pure. */
export function funnelRows(counts: Record<string, number>): FunRow[] {
  const first = counts.viewed ?? 0; let prev: number | null = null;
  return FUNNEL_EVENTS.map((step) => {
    const count = counts[step] ?? 0, side = step === "payment_failed";
    const row: FunRow = { step, label: FUN_LABELS[step], count, ofPrevious: side || prev === null ? null : pct(count, prev), ofFirst: pct(count, first) };
    if (!side) prev = count;
    return row;
  });
}
/** The funnel for steps reached in [from, to): total, per day and per week. Counts of keys, nothing else. */
export async function funnelReport(env: { DB: D1 }, from: number, to: number) {
  let rows: { ev: string; at_ms: number }[] = [];
  try { await ensure(env.DB); rows = ((await env.DB.prepare("SELECT ev, at_ms FROM ttt_fun WHERE at_ms>=? AND at_ms<? LIMIT 400000").bind(from, to).all<{ ev: string; at_ms: number }>()).results ?? []) as typeof rows; } catch { /* no table, nothing kept */ }
  const countOf = (xs: typeof rows) => { const c: Record<string, number> = {}; for (const r of xs) c[r.ev] = (c[r.ev] ?? 0) + 1; return c; };
  const by = (key: (ms: number) => string) => { const m = new Map<string, typeof rows>(); for (const r of rows) { const k = key(r.at_ms), a = m.get(k); if (a) a.push(r); else m.set(k, [r]); } return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([period, xs]) => ({ period, rows: funnelRows(countOf(xs)) })); };
  return {
    from, to, total: funnelRows(countOf(rows)), days: by(dayOf), weeks: by(weekOf),
    note: "Each step is counted once per visit (page steps) or once per game or payment (server steps). A browser with Global Privacy Control or Do Not Track is not counted. Nothing here names or identifies a person.",
  };
}
const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** The same report as CSV: scope (total, day or week), the period, the step, its count, and the two percentages. */
export function funnelCsv(r: Awaited<ReturnType<typeof funnelReport>>): string {
  const L = ["scope,period,step,label,count,percent_of_previous,percent_of_first"];
  const add = (scope: string, period: string, rows: FunRow[]) => { for (const x of rows) L.push([scope, period, x.step, q(x.label), x.count, x.ofPrevious ?? "", x.ofFirst ?? ""].join(",")); };
  add("total", "all", r.total); for (const d of r.days) add("day", d.period, d.rows); for (const w of r.weeks) add("week", w.period, w.rows);
  return L.join("\n") + "\n";
}
