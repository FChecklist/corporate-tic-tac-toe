// The owner's desk (gates A3, A5, A6, A7, E12). Everything here is OWNER ONLY (the platform key, never through an AI work link) except the two public reads
// /api/mode (kept in mode.ts) and /api/status/health, and the mail service's signed webhook. Anybody else asking an owner address gets the same 404 as an unknown address,
// and the try is written to the owner's access log (audit_access).
//
//   A5  Site switch      GET|POST /api/owner/site {off: true|false, note?}. While it is ON every page and API that reaches the Worker answers a plain 503 "Back soon" - EXCEPT
//                        /api/mode, /api/owner/*, /api/status/health, /api/lifecycle/tick (the 24-hour deletion), the payment webhook, the mail webhook and the inbound-mail webhook.
//                        The flag is one row in kv ('site/off'), read at most every few seconds per Worker instance. If it cannot be read the site stays UP (never down by accident).
//                        Static files are served by Cloudflare Pages itself and never reach the Worker: rum.js puts a "Back soon" cover over any page that gets the 503 from a call it makes.
//   A3  Organizer lookup GET /api/owner/organizer?email=...  -> that organizer's games (id, state, start, paid, created). No phone numbers, nothing about payers except the e-mail asked for.
//   A6  Data requests    GET /api/owner/data-requests?status=open|done|all   POST /api/owner/data-requests {id, action: "close"}   (the table data_request, rights.ts)
//   A7  Errors           every 5xx the Worker answers is counted in a 10-minute bucket (kv 'err/...'); GET /api/status/health (public) says {ok, errors_last_hour};
//                        GET /api/owner/errors shows the last 24 hours by hour. The scheduler's uptime check fails (GitHub mails the owner) above a threshold.
//   E12 Mail events      POST /api/mail/events  the mail service's webhook (Svix-style signature, secret RESEND_WEBHOOK_SECRET; with no secret set the address answers 404 and accepts nothing)
//                        -> table mail_bounce; GET /api/owner/mail-events shows bounced / complained / delivered, newest first.
// A recipient is kept as a one-way hash plus a masked form (j***@example.com) so the owner can recognise it; nothing else about the person. Rows are deleted after 90 days.
import { logAccess } from "./audit";
import type { D1, Env } from "./worker";

export const GAME_NAME = "Corporate Tic Tac Toe";
export interface AdminEnv extends Env { RESEND_WEBHOOK_SECRET?: string }

export const ADMIN_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS mail_bounce (id TEXT PRIMARY KEY, at_ms INTEGER NOT NULL, event TEXT NOT NULL, to_hash TEXT NOT NULL, to_mask TEXT, subject TEXT, kind TEXT, detail TEXT)`,
  `CREATE INDEX IF NOT EXISTS mail_bounce_at ON mail_bounce (at_ms)`,
];

/** How long a mail event row is kept. */
export const MAIL_EVENT_DAYS = 90;
/** The 10-minute bucket the error counter uses, and how many of them make "the last hour". */
const BUCKET_MS = 600_000, BUCKETS_PER_HOUR = 6;
/** The scheduler fails its check above this many 5xx answers in the last hour (also written in scheduler uptime.yml). */
export const ERROR_ALERT_THRESHOLD = 20;
/** A Worker instance writes at most this many error counters per bucket (a storm of errors must not become a storm of writes; the counter then reads "at least"). */
const MAX_COUNTER_WRITES = 500;

const enc = new TextEncoder();
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const jsonRes = (o: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
const normMail = (e: string): string => { const v = String(e ?? "").trim().toLowerCase(); const i = v.lastIndexOf("@"); return i < 1 ? v : v.slice(0, i).split("+")[0] + v.slice(i); };
export const maskMail = (e: string): string => { const v = String(e ?? "").trim().toLowerCase(), i = v.lastIndexOf("@"); return i < 1 ? "***" : v.slice(0, 1) + "***" + v.slice(i); };

// ------------------------------------------------------------------------------------------------ A5: the site switch
const OFF_TTL_MS = 3000;
const offCache = new WeakMap<object, { off: boolean; at: number }>();
/** True when the owner has switched the site off. Cached a few seconds per database handle; an unreadable row means UP. */
export async function siteIsOff(db: D1, nowMs = Date.now()): Promise<boolean> {
  const c = offCache.get(db);
  if (c && Math.abs(nowMs - c.at) < OFF_TTL_MS) return c.off;
  let off = c?.off ?? false;
  try { off = !!(await db.prepare("SELECT v FROM kv WHERE k='site/off'").first<{ v: string }>()); } catch { /* keep the last known state: up */ }
  offCache.set(db, { off, at: nowMs });
  return off;
}
/** Paths that keep working while the site is switched off: the owner's own tools, the deletion job, and every webhook. */
export const OFF_EXEMPT = (p: string): boolean =>
  p === "/api/mode" || p.startsWith("/api/owner/") || p === "/api/status/health" || p === "/api/lifecycle/tick" || p === "/api/payments/webhook" || p === "/api/mail/events" || p === "/api/inbound-email";

const BACK_SOON_TEXT = "Back soon. We are making a small change. Please try again in a few minutes.";
const backSoonPage = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Back soon | ${GAME_NAME}</title><style>body{font:18px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center;color:#14213d;background:#fff}h1{margin:0 0 8px;font-size:28px}p{margin:0;max-width:30em}</style></head><body><main><h1>Back soon</h1><p>We are making a small change. Please try again in a few minutes.</p></main></body></html>`;
/** The 503 every public address answers while the site is off: a plain page for a browser, JSON for everything else. */
export function backSoon(req: Request): Response {
  const wantsPage = req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html");
  const h = { "retry-after": "300", "cache-control": "no-store" };
  if (wantsPage) return new Response(backSoonPage(), { status: 503, headers: { "content-type": "text/html; charset=utf-8", ...h } });
  return jsonRes({ error: BACK_SOON_TEXT, code: "back-soon", maintenance: true }, 503, h);
}
/** The gate in front of the whole Worker: null = carry on. */
export async function maintenanceGate(req: Request, env: { DB: D1 }, now: number): Promise<Response | null> {
  const p = new URL(req.url).pathname;
  if (OFF_EXEMPT(p)) return null;
  return (await siteIsOff(env.DB, now)) ? backSoon(req) : null;
}

// ------------------------------------------------------------------------------------------------ A7: the error counter
const bucketKey = (ms: number) => "err/" + new Date(Math.floor(ms / BUCKET_MS) * BUCKET_MS).toISOString().slice(0, 15); // 2026-10-14T06:3  (10 minutes)
const writes = new WeakMap<object, Map<string, number>>();
/** Counts one 5xx answer. Best effort: a failing database must never make an error worse. */
export async function countError(db: D1, now: number): Promise<void> {
  try {
    const k = bucketKey(now);
    let m = writes.get(db); if (!m) { m = new Map(); writes.set(db, m); }
    const n = m.get(k) ?? 0; if (n >= MAX_COUNTER_WRITES) return;
    m.set(k, n + 1); if (m.size > 20) for (const old of [...m.keys()].slice(0, m.size - 20)) m.delete(old);
    await db.prepare("INSERT INTO kv(k,v) VALUES(?,'1') ON CONFLICT(k) DO UPDATE SET v=CAST(v AS INTEGER)+1").bind(k).run();
  } catch { /* best effort */ }
}
/** 5xx answers in the last 60 minutes (the current 10-minute bucket and the five before it). */
export async function errorsLastHour(db: D1, now: number): Promise<number> {
  const keys = Array.from({ length: BUCKETS_PER_HOUR }, (_, i) => bucketKey(now - i * BUCKET_MS));
  const r = await db.prepare(`SELECT COALESCE(SUM(CAST(v AS INTEGER)),0) AS n FROM kv WHERE k IN (${keys.map(() => "?").join(",")})`).bind(...keys).first<{ n: number }>();
  return Number(r?.n ?? 0);
}
async function errorsByHour(db: D1, now: number): Promise<{ hour: string; errors: number }[]> {
  const from = bucketKey(now - 24 * 3_600_000);
  const rows = (await db.prepare("SELECT k, v FROM kv WHERE k LIKE 'err/%' AND k>=? ORDER BY k").bind(from).all<{ k: string; v: string }>()).results ?? [];
  const by = new Map<string, number>();
  for (const r of rows) { const h = r.k.slice(4, 17); by.set(h, (by.get(h) ?? 0) + Number(r.v)); }
  return [...by].map(([hour, errors]) => ({ hour: hour + ":00Z", errors }));
}

/** The housekeeping the scheduled tick does: old error counters and old mail events go. */
export async function adminTick(db: D1, now: number): Promise<void> {
  try {
    await db.prepare("DELETE FROM kv WHERE k LIKE 'err/%' AND k<?").bind(bucketKey(now - 48 * 3_600_000)).run();
    await db.prepare("DELETE FROM mail_bounce WHERE at_ms<?").bind(now - MAIL_EVENT_DAYS * 86_400_000).run();
  } catch { /* best effort */ }
}

// ------------------------------------------------------------------------------------------------ E12: the mail service's webhook
const b64 = (u: Uint8Array) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string): Uint8Array<ArrayBuffer> => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const SIG_TOLERANCE_S = 300;
/** Svix-style signature (what Resend sends): header svix-signature = "v1,<base64 hmac-sha256 of `${id}.${timestamp}.${body}`>" (several, space separated), the key is the base64 part of "whsec_...". */
export async function verifyMailSignature(secret: string, id: string, ts: string, sigHeader: string, body: string, nowMs: number): Promise<boolean> {
  if (!id || !ts || !sigHeader) return false;
  const t = Number(ts); if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > SIG_TOLERANCE_S) return false;
  let key: Uint8Array<ArrayBuffer>; try { key = unb64(secret.trim().replace(/^whsec_/, "")); } catch { return false; }
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(`${id}.${ts}.${body}`))));
  let ok = false;
  for (const part of sigHeader.split(" ")) { const [v, sig] = part.split(","); if (v === "v1" && sig && sig.length === want.length) { let d = 0; for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ sig.charCodeAt(i); if (d === 0) ok = true; } }
  return ok;
}
const EVENT_NAMES: Record<string, string> = { "email.bounced": "bounced", "email.complained": "complained", "email.delivered": "delivered", "email.delivery_delayed": "delayed", "email.failed": "failed" };
const clip = (v: unknown, n: number): string | null => (typeof v === "string" && v.trim() ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n) : null);

async function mailEventsWebhook(req: Request, env: AdminEnv, now: number, spend: (n: number) => Promise<boolean>): Promise<Response> {
  const secret = (env.RESEND_WEBHOOK_SECRET ?? "").trim();
  if (!secret || req.method !== "POST") return jsonRes({ error: "Not found" }, 404); // nothing is accepted until the owner has set the secret
  const raw = await req.text();
  if (raw.length > 65536) return jsonRes({ error: "Too large" }, 413);
  const ok = await verifyMailSignature(secret, req.headers.get("svix-id") ?? "", req.headers.get("svix-timestamp") ?? "", req.headers.get("svix-signature") ?? "", raw, now);
  if (!ok) return jsonRes({ error: "Bad signature" }, 400);
  let ev: any; try { ev = JSON.parse(raw); } catch { return jsonRes({ error: "Bad request" }, 400); }
  const event = EVENT_NAMES[String(ev?.type ?? "")];
  if (!event) return jsonRes({ ok: true, ignored: true });
  const d = ev?.data ?? {};
  const to = (Array.isArray(d.to) ? d.to[0] : d.to) as unknown;
  if (typeof to !== "string" || !to.includes("@")) return jsonRes({ ok: true, ignored: true });
  const tags = d.tags; const kind = clip(Array.isArray(tags) ? tags.find((t: any) => t?.name === "kind")?.value : tags?.kind, 40);
  const detail = event === "bounced" ? clip([d.bounce?.type, d.bounce?.subType].filter((x) => typeof x === "string").join("/"), 60) : null;
  if (!(await spend(1))) return jsonRes({ error: "busy" }, 503);
  const id = req.headers.get("svix-id")!;
  const r = await env.DB.prepare("INSERT OR IGNORE INTO mail_bounce(id,at_ms,event,to_hash,to_mask,subject,kind,detail) VALUES(?,?,?,?,?,?,?,?)").bind(id, now, event, await sha(normMail(to)), maskMail(to), clip(d.subject, 120), kind, detail).run();
  return jsonRes({ ok: true, event, again: (r.meta?.changes ?? 0) === 0 });
}

// ------------------------------------------------------------------------------------------------ the routes
const readBody = async (req: Request): Promise<any | null> => { const t = await req.text(); if (t.length > 4096) return null; try { const v = JSON.parse(t); return v && typeof v === "object" ? v : null; } catch { return null; } };
const GENESIS_S = 1692803367; // drand quicknet: round r is published at GENESIS_S + (r-1)*3 s
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

async function organizerLookup(env: AdminEnv, email: string, now: number): Promise<Response> {
  const mail = email.trim().toLowerCase();
  if (!EMAIL.test(mail)) return jsonRes({ error: "Give the organizer's e-mail address: ?email=name@company.com" }, 400);
  const eh = await sha("email|" + mail);
  const acct = await env.DB.prepare("SELECT org, is_test FROM organizer_email WHERE email_hash=?").bind(eh).first<{ org: string; is_test: number }>();
  const bounces = Number((await env.DB.prepare("SELECT COUNT(*) AS c FROM mail_bounce WHERE to_hash=? AND event IN ('bounced','complained')").bind(await sha(normMail(mail))).first<{ c: number }>())?.c ?? 0);
  if (!acct) return jsonRes({ found: false, email: mail, games: [], mailProblems: bounces });
  const rows = (await env.DB.prepare(
    "SELECT e.id, e.start_round, e.created_ms, e.pack, e.closed, e.cancelled_ms, e.unplayed_ms, e.is_test, (SELECT end_ms FROM life WHERE eid=e.id) AS end_ms, " +
    "(SELECT 1 FROM kv WHERE k='pub/'||e.id) AS pub, " +
    "(SELECT 1 FROM payment p WHERE p.status='paid' AND (p.eid=e.id OR p.id IN (SELECT payment_id FROM entitlement WHERE eid=e.id)) LIMIT 1) AS paid " +
    "FROM engagement e WHERE e.org=? ORDER BY e.created_ms DESC LIMIT 200").bind(acct.org).all<any>()).results ?? [];
  const games = rows.map((r) => {
    const startMs = (GENESIS_S + (Number(r.start_round) - 1) * 3) * 1000;
    const paid = !!r.paid;
    const state = r.cancelled_ms ? "cancelled" : r.end_ms && Number(r.end_ms) <= now ? "ended" : r.unplayed_ms ? "not played" : paid ? (startMs > now ? "paid, waiting to start" : "paid, started") : r.pub ? "published, not paid" : "draft";
    return { id: r.id, state, start: new Date(startMs).toISOString(), paid, created: new Date(Number(r.created_ms)).toISOString(), test: !!r.is_test };
  });
  return jsonRes({ found: true, email: mail, test: !!acct.is_test, games, mailProblems: bounces });
}

/**
 * Every owner-desk address and the two public ones. `owner` = the platform key, not through an AI work link. Returns null for an address that is not ours.
 */
export async function adminRoute(req: Request, env: AdminEnv, now: number, owner: boolean, spend: (n: number) => Promise<boolean>): Promise<Response | null> {
  const url = new URL(req.url), p = url.pathname;
  if (p === "/api/status/health") {
    if (req.method !== "GET" && req.method !== "HEAD") return jsonRes({ error: "Not found" }, 404);
    let dbOk = true, errors = 0;
    try { errors = await errorsLastHour(env.DB, now); } catch { dbOk = false; }
    return jsonRes({ ok: dbOk, errors_last_hour: errors, threshold: ERROR_ALERT_THRESHOLD, maintenance: await siteIsOff(env.DB, now), at: new Date(now).toISOString() });
  }
  if (p === "/api/mail/events") return mailEventsWebhook(req, env, now, spend);
  const m = p.match(/^\/api\/owner\/(site|organizer|data-requests|mail-events|errors)$/);
  if (!m) return null;
  const what = m[1]!;
  if (!owner) { await logAccess(env.DB, now, "denied:" + what, null, null, 0, false, null); return jsonRes({ error: "Not found" }, 404); }

  if (what === "site") {
    if (req.method === "GET") { const r = await env.DB.prepare("SELECT v FROM kv WHERE k='site/off'").first<{ v: string }>(); let info: any = null; try { info = r ? JSON.parse(r.v) : null; } catch { /* plain */ } return jsonRes({ off: !!r, since: info?.at ?? null, note: info?.note ?? null }); }
    if (req.method !== "POST") return jsonRes({ error: "Not found" }, 404);
    const b = await readBody(req);
    if (typeof b?.off !== "boolean") return jsonRes({ error: 'Say {"off": true} to switch the site off or {"off": false} to switch it on.' }, 400);
    const note = clip(b.note, 200);
    const was = !!(await env.DB.prepare("SELECT v FROM kv WHERE k='site/off'").first());
    if (b.off) await env.DB.prepare("INSERT INTO kv(k,v) VALUES('site/off',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(JSON.stringify({ at: new Date(now).toISOString(), note })).run();
    else await env.DB.prepare("DELETE FROM kv WHERE k='site/off'").run();
    offCache.set(env.DB, { off: b.off, at: now });
    await logAccess(env.DB, now, "site-switch", null, null, 0, true, `${was ? "off" : "on"}->${b.off ? "off" : "on"}${note ? ": " + note : ""}`);
    return jsonRes({ ok: true, off: b.off, was: was });
  }
  if (what === "organizer") {
    if (req.method !== "GET") return jsonRes({ error: "Not found" }, 404);
    const out = await organizerLookup(env, url.searchParams.get("email") ?? "", now);
    await logAccess(env.DB, now, "organizer-lookup", null, null, 0, out.status === 200, null); // the address looked up is not written down
    return out;
  }
  if (what === "data-requests") {
    if (req.method === "GET") {
      const st = url.searchParams.get("status") ?? "open";
      const rows = (await env.DB.prepare("SELECT id, eid, pid, kind, note, created_ms, due_ms, status, done_ms FROM data_request" + (st === "all" ? "" : " WHERE status=?") + " ORDER BY created_ms ASC LIMIT 500").bind(...(st === "all" ? [] : [st === "done" ? "done" : "open"])).all<any>()).results ?? [];
      await logAccess(env.DB, now, "data-requests-list", null, null, rows.length);
      return jsonRes({ requests: rows.map((r) => ({ id: r.id, game: r.eid, card: r.pid, kind: r.kind, note: r.note, received: new Date(r.created_ms).toISOString(), due: new Date(r.due_ms).toISOString(), overdue: r.status === "open" && r.due_ms < now, status: r.status, closed: r.done_ms ? new Date(r.done_ms).toISOString() : null })) });
    }
    if (req.method !== "POST") return jsonRes({ error: "Not found" }, 404);
    const b = await readBody(req); const id = typeof b?.id === "string" ? b.id : "";
    if (!id || b?.action !== "close") return jsonRes({ error: 'Send {"id": "...", "action": "close"}.' }, 400);
    const row = await env.DB.prepare("SELECT status FROM data_request WHERE id=?").bind(id).first<{ status: string }>();
    if (!row) return jsonRes({ error: "Not found" }, 404);
    if (row.status === "done") return jsonRes({ ok: true, again: true, id, status: "done" });
    await env.DB.prepare("UPDATE data_request SET status='done', done_ms=? WHERE id=? AND status<>'done'").bind(now, id).run();
    await logAccess(env.DB, now, "data-request-close", null, null, 1, true, id);
    return jsonRes({ ok: true, id, status: "done" });
  }
  if (what === "mail-events") {
    if (req.method !== "GET") return jsonRes({ error: "Not found" }, 404);
    const ev = url.searchParams.get("event"); const lim = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
    const rows = (await env.DB.prepare("SELECT id, at_ms, event, to_mask, subject, kind, detail FROM mail_bounce" + (ev ? " WHERE event=?" : "") + " ORDER BY at_ms DESC LIMIT ?").bind(...(ev ? [ev, lim] : [lim])).all<any>()).results ?? [];
    const counts = (await env.DB.prepare("SELECT event, COUNT(*) AS n FROM mail_bounce GROUP BY event").all<{ event: string; n: number }>()).results ?? [];
    await logAccess(env.DB, now, "mail-events-list", null, null, rows.length);
    return jsonRes({ counts: Object.fromEntries(counts.map((c) => [c.event, c.n])), events: rows.map((r) => ({ id: r.id, at: new Date(r.at_ms).toISOString(), event: r.event, to: r.to_mask, subject: r.subject, kind: r.kind, detail: r.detail })), keptDays: MAIL_EVENT_DAYS, webhook: (env.RESEND_WEBHOOK_SECRET ?? "").trim() ? "on" : "off (set RESEND_WEBHOOK_SECRET, see docs/OWNER_DESK.md)" });
  }
  // errors
  if (req.method !== "GET") return jsonRes({ error: "Not found" }, 404);
  return jsonRes({ lastHour: await errorsLastHour(env.DB, now), threshold: ERROR_ALERT_THRESHOLD, hours: await errorsByHour(env.DB, now) });
}
