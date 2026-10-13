// First-party visitor-journey tracking for the PUBLIC pages only (home, pricing, legal pages, partner page, sign-in, payment entry). Owner-approved 2026-10-06.
//   - Never inside the live game (play, z, zc, big, screen, report) and never about participants: the allow-list below (`PUBLIC_PATHS`) is enforced here, so a script that
//     posts any other path is simply dropped. No names, no mobile numbers, no page query strings (only whitelisted UTM names and the public partner code, read once at landing).
//   - A visit is recognised by (a) a random first-party visitor id (browser storage + one cookie, 1 year) and (b) the network address, kept ONLY as a shortened address
//     (IPv4 last octet zeroed, IPv6 /48) and as a keyed HMAC of the full address (secret VISIT_KEY, else derived from DATA_KEY). The raw address is never stored.
//   - Global Privacy Control / Do Not Track: no visitor id, no address, no session row. Only anonymous counters (`visit_agg`, dims "gpc_*") go up.
//   - Crawlers are recorded apart (is_bot = 1) and left out of every human count; they show as "bots" for search-engine visibility.
//   - Retention: 365 days after a session began, its rows are rolled into anonymous per-day totals (`visit_agg`) and then deleted (`sweepVisits`, from the lifecycle tick).
//   - Cost: one D1 batch per beacon (the browser sends at most ~every 15 s and when the page is hidden, 20 events at most), counted against the shared daily write guard AND a
//     smaller visitor-tracking allowance (VISIT_DAILY_WRITES, default 20,000), so marketing numbers can never starve the games.
//   - Reports are owner-only (platform key, same as the audit log) and every read is written to the audit access log.
import { parseUa } from "./audit";
import { isTestMode, orgIsTest } from "./mode";
import type { D1, Env } from "./worker";

export interface VisitEnv extends Env { VISIT_KEY?: string; VISIT_DAILY_WRITES?: string; PUBLIC_ORIGIN?: string }

export const VISIT_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS visit_session (sid TEXT PRIMARY KEY, vid TEXT, iph TEXT, ipshort TEXT, first_ms INTEGER NOT NULL, last_ms INTEGER NOT NULL, landing TEXT, src TEXT, ref_host TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, partner TEXT, device TEXT, browser TEXT, os TEXT, lang TEXT, country TEXT, city TEXT, is_bot INTEGER NOT NULL DEFAULT 0, visit_no INTEGER NOT NULL DEFAULT 1, ip_visit_no INTEGER NOT NULL DEFAULT 1, pages INTEGER NOT NULL DEFAULT 0, n_events INTEGER NOT NULL DEFAULT 0, exit_path TEXT, exit_section TEXT, exit_ms INTEGER, exit_scroll INTEGER, stage INTEGER NOT NULL DEFAULT 0, org TEXT, eh TEXT)`,
  `CREATE INDEX IF NOT EXISTS visit_session_first ON visit_session (first_ms)`,
  `CREATE INDEX IF NOT EXISTS visit_session_vid ON visit_session (vid)`,
  `CREATE INDEX IF NOT EXISTS visit_session_iph ON visit_session (iph)`,
  `CREATE INDEX IF NOT EXISTS visit_session_org ON visit_session (org)`,
  `CREATE TABLE IF NOT EXISTS visit_event (id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL, at_ms INTEGER NOT NULL, kind TEXT NOT NULL, path TEXT, name TEXT, val TEXT, n INTEGER)`,
  `CREATE INDEX IF NOT EXISTS visit_event_sid ON visit_event (sid)`,
  `CREATE INDEX IF NOT EXISTS visit_event_at ON visit_event (at_ms)`,
  `CREATE TABLE IF NOT EXISTS visit_agg (day TEXT NOT NULL, dim TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, dim, k))`,
];

const DAY = 86_400_000;
export const VISIT_RETENTION_DAYS = 365;
export const BEACON_MAX_BYTES = 6000, BEACON_MAX_EVENTS = 20, SESSION_MAX_EVENTS = 400, BEACONS_PER_MINUTE = 60, VISIT_DAILY_WRITES = 20_000;
/** The funnel, in order. A visitor's stage is the furthest step reached. visit = the session itself. */
export const STEPS = ["visit", "pricing", "size", "create", "account", "published", "paid"] as const;
export type Step = (typeof STEPS)[number];
const STAGE: Record<string, number> = Object.fromEntries(STEPS.map((s, i) => [s, i]));

/** The only pages tracked (clean paths). Everything else, in particular the live game and participant pages, is refused. */
export const PUBLIC_PATHS = new Set(["/", "/legal", "/terms", "/dpa", "/subprocessors", "/partner-terms", "/organizer-guide", "/partner", "/signin", "/pay"]);
export function normPath(p: unknown): string | null {
  if (typeof p !== "string") return null;
  let s = p.split(/[?#]/)[0]!.toLowerCase().replace(/\/index(\.html)?$/, "/").replace(/\.html$/, "");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return PUBLIC_PATHS.has(s) ? s : null;
}
const ACTIONS = new Set(["pack", "create", "cur", "signin_open", "signin_submit", "start_open", "start_submit", "partner_click", "nav", "legal_click"]);

// ------------------------------------------------------------------------------------------------ addresses and keys
/** IPv4: last octet zeroed. IPv6: first 48 bits only. Anything else: empty. */
export function shortIp(ip: string): string {
  const v = (ip ?? "").trim().toLowerCase();
  const m4 = v.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m4) { const o = m4.slice(1).map(Number); return o.some((n) => n > 255) ? "" : `${o[0]}.${o[1]}.${o[2]}.0`; }
  if (!v.includes(":") || !/^[0-9a-f:]+$/.test(v)) return "";
  let g: string[];
  if (v.includes("::")) {
    const parts = v.split("::"); if (parts.length !== 2) return "";
    const h = parts[0] ? parts[0].split(":") : [], t = parts[1] ? parts[1].split(":") : [], fill = 8 - h.length - t.length;
    if (fill < 1) return "";
    g = [...h, ...Array(fill).fill("0"), ...t];
  } else g = v.split(":");
  if (g.length !== 8 || g.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return "";
  return `${g.slice(0, 3).map((x) => parseInt(x, 16).toString(16)).join(":")}::`;
}
const enc = new TextEncoder();
const secretOf = (env: VisitEnv) => (env.VISIT_KEY ? "visit|" + env.VISIT_KEY : env.DATA_KEY ? "derived-from-data-key|" + env.DATA_KEY : env.ORGANIZER_SECRET ? "fallback|" + env.ORGANIZER_SECRET : "");
const hmacKeys = new Map<string, Promise<CryptoKey>>();
async function hmacHex(secret: string, msg: string): Promise<string> {
  let k = hmacKeys.get(secret);
  if (!k) { k = crypto.subtle.importKey("raw", enc.encode("corporate-tic-tac-toe/visit/v1|" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); if (hmacKeys.size > 8) hmacKeys.clear(); hmacKeys.set(secret, k); }
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", await k, enc.encode(msg))), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Keyed hash of the full address (32 hex): the same address always gives the same value, and without the key it cannot be reversed or guessed. Empty when no key is configured. */
export async function ipHash(env: VisitEnv, ip: string): Promise<string> {
  const s = secretOf(env), v = (ip ?? "").trim().toLowerCase().replace(/^::ffff:/, "");
  return s && v ? (await hmacHex(s, "ip|" + v)).slice(0, 32) : "";
}
export async function emailHash(env: VisitEnv, email: string): Promise<string> {
  const s = secretOf(env);
  return s && email ? (await hmacHex(s, "email|" + email.trim().toLowerCase())).slice(0, 32) : "";
}

// ------------------------------------------------------------------------------------------------ who and where from
const BOT_RE = /(googlebot|bingbot|bingpreview|slurp|duckduckbot|baiduspider|yandex(?:bot)?|sogou|exabot|facebookexternalhit|facebot|twitterbot|linkedinbot|applebot|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|bytespider|gptbot|claudebot|ccbot|amazonbot|pingdom|uptimerobot|statuscake|lighthouse|headlesschrome|phantomjs|puppeteer|playwright|python-requests|curl|wget|go-http-client|okhttp|libwww|scrapy|httpclient|axios|node-fetch|crawler|spider|\bbot\b)/i;
/** The crawler's name, or null for a person. An empty user agent counts as a bot. */
export function botName(ua: string): string | null {
  const t = (ua ?? "").trim();
  if (!t) return "unknown";
  const m = t.match(BOT_RE);
  return m ? m[1]!.toLowerCase() : null;
}
const SEARCH: [RegExp, string][] = [[/(^|\.)google\./, "google"], [/(^|\.)bing\.com$/, "bing"], [/duckduckgo\./, "duckduckgo"], [/(^|\.)yahoo\./, "yahoo"], [/baidu\./, "baidu"], [/yandex\./, "yandex"], [/ecosia\./, "ecosia"], [/search\.brave\.com$/, "brave"], [/(^|\.)ask\.com$/, "ask"]];
const SOCIAL: [RegExp, string][] = [[/facebook\.|(^|\.)fb\.com$|l\.messenger/, "facebook"], [/instagram\./, "instagram"], [/linkedin\.|lnkd\.in$/, "linkedin"], [/(^|\.)t\.co$|twitter\./, "twitter"], [/(^|\.)x\.com$/, "x"], [/youtube\.|youtu\.be$/, "youtube"], [/whatsapp\./, "whatsapp"], [/reddit\./, "reddit"], [/(^|\.)t\.me$|telegram\./, "telegram"]];
/** Where a visit came from: a campaign (UTM), a search engine, a social site, another site, our own site, or nowhere (direct). */
export function classifySource(o: { refHost: string; utmSource: string; utmMedium: string; ownHosts: string[] }): { src: string; label: string } {
  const host = o.refHost.toLowerCase();
  if (o.utmSource) return { src: /^(cpc|ppc|paid|paidsocial|display)$/i.test(o.utmMedium) ? "paid" : "campaign", label: o.utmSource.toLowerCase() };
  if (!host) return { src: "direct", label: "" };
  if (o.ownHosts.some((h) => h && (host === h || host.endsWith("." + h)))) return { src: "internal", label: host };
  for (const [re, n] of SEARCH) if (re.test(host)) return { src: "search", label: n };
  for (const [re, n] of SOCIAL) if (re.test(host)) return { src: "social", label: n };
  return { src: "referral", label: host };
}

// ------------------------------------------------------------------------------------------------ the beacon
export interface Ev { k: "pv" | "sec" | "act" | "exit"; p: string; n: string; v: string; m: number; x: number; num: number | null }
export interface Beacon { sid: string; vid: string; gpc: boolean; landing: string; ref: string; utm: { s: string; m: string; c: string }; partner: string; dv: string; lang: string; evs: Ev[] }
const clean = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>"'`]/g, " ").trim().slice(0, n) : "");
const int = (v: unknown, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };

/** Checks and trims what a browser sent. Anything unexpected is dropped, never stored. */
export function parseBeacon(text: string): { ok: true; b: Beacon } | { ok: false; status: number } {
  if (text.length > BEACON_MAX_BYTES) return { ok: false, status: 413 };
  let j: any; try { j = JSON.parse(text); } catch { return { ok: false, status: 400 }; }
  if (!j || typeof j !== "object" || !/^[a-f0-9]{16,32}$/.test(String(j.s ?? ""))) return { ok: false, status: 400 };
  const evs: Ev[] = [];
  for (const e of (Array.isArray(j.e) ? j.e : []).slice(0, BEACON_MAX_EVENTS)) {
    if (!e || typeof e !== "object") continue;
    const p = normPath(e.p); if (!p) continue;
    const k = e.k;
    if (k === "pv") evs.push({ k, p, n: "", v: "", m: 0, x: 0, num: null });
    else if (k === "sec") { const n = String(e.n ?? ""); if (/^[a-z0-9_-]{1,24}$/.test(n)) evs.push({ k, p, n, v: "", m: int(e.m, 0, 3_600_000), x: 0, num: null }); }
    else if (k === "act") { const n = String(e.n ?? ""); if (ACTIONS.has(n)) evs.push({ k, p, n, v: clean(e.v, 40), m: 0, x: 0, num: e.z == null ? null : int(e.z, 0, 1_000_000) }); }
    else if (k === "exit") { const n = String(e.n ?? ""); evs.push({ k, p, n: /^[a-z0-9_-]{1,24}$/.test(n) ? n : "", v: "", m: int(e.m, 0, 86_400_000), x: int(e.x, 0, 100), num: null }); }
  }
  const ref = String(j.r ?? "").toLowerCase();
  const u = j.u && typeof j.u === "object" ? j.u : {};
  return { ok: true, b: {
    sid: j.s, vid: /^[a-f0-9]{32}$/.test(String(j.d ?? "")) ? j.d : "", gpc: j.g === 1 || j.g === true,
    landing: normPath(j.lp) ?? "", ref: /^[a-z0-9.-]{1,80}$/.test(ref) ? ref : "",
    utm: { s: clean(u.s, 40).replace(/[^\w.\- ]/g, ""), m: clean(u.m, 40).replace(/[^\w.\- ]/g, ""), c: clean(u.c, 60).replace(/[^\w.\- ]/g, "") },
    partner: /^[A-Za-z2-9]{8}$/.test(String(j.pc ?? "")) ? String(j.pc).toUpperCase() : "",
    dv: ["mobile", "tablet", "desktop"].includes(j.dv) ? j.dv : "", lang: /^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]{2,8})?$/.test(String(j.l ?? "")) ? String(j.l).slice(0, 12) : "", evs } };
}

/** A small rate limit per Worker instance (free: no database): at most BEACONS_PER_MINUTE per key per minute. */
const rate = new Map<string, { w: number; n: number }>();
export const resetRate = () => rate.clear();
export function rateLimited(key: string, now: number, max = BEACONS_PER_MINUTE): boolean {
  const w = Math.floor(now / 60_000), r = rate.get(key);
  if (rate.size > 5000) rate.clear();
  if (!r || r.w !== w) { rate.set(key, { w, n: 1 }); return false; }
  return ++r.n > max;
}
/** What the visit-tracking allowance of one day has used (a separate counter from the shared one, so marketing numbers can never use up the games' allowance). */
async function visitBudget(db: D1, now: number, n: number, cap: number): Promise<boolean> {
  const k = new Date(now).toISOString().slice(0, 10) + "~v";
  const row = await db.prepare("SELECT writes FROM usage WHERE day=?").bind(k).first<{ writes: number }>();
  if ((row?.writes ?? 0) + n > cap) return false;
  await db.prepare("INSERT INTO usage(day,writes) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET writes=writes+?").bind(k, n, n).run();
  return true;
}
const cookieVid = (req: Request) => { const m = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)cbv=([a-f0-9]{32})(?:;|$)/); return m ? m[1]! : ""; };
export const gpcOn = (req: Request) => req.headers.get("sec-gpc") === "1" || req.headers.get("dnt") === "1";
const ownHosts = (req: Request, env: VisitEnv) => { const h = [new URL(req.url).hostname]; try { if (env.PUBLIC_ORIGIN) h.push(new URL(env.PUBLIC_ORIGIN).hostname); } catch { /* ignore */ } return h.map((x) => x.toLowerCase()); };
const none = (status = 204) => new Response(null, { status, headers: { "cache-control": "no-store" } });
type Spend = (n: number) => Promise<boolean>;

/** POST /api/v/b: one small batch of events from a public page. Quiet by design: a browser never sees why something was dropped. */
export async function beaconRoute(req: Request, env: VisitEnv, now: number, spend: Spend): Promise<Response> {
  if (req.method !== "POST") return none(405);
  const origin = req.headers.get("origin");
  if (origin) { let ok = false; try { ok = ownHosts(req, env).includes(new URL(origin).hostname.toLowerCase()); } catch { /* bad origin */ } if (!ok) return none(403); }
  if (req.headers.get("sec-fetch-site") === "cross-site") return none(403);
  if (Number(req.headers.get("content-length") ?? 0) > BEACON_MAX_BYTES) return none(413);
  const text = await req.text();
  const p = parseBeacon(text);
  if (!p.ok) return none(p.status);
  const b = p.b, ip = req.headers.get("cf-connecting-ip") ?? "", ua = req.headers.get("user-agent") ?? "";
  const iph = await ipHash(env, ip);
  if (rateLimited("ip/" + (iph || ip || "local"), now) || rateLimited("sid/" + b.sid, now)) return none(429);
  if (!b.evs.length) return none();
  const db = env.DB, cap = Number(env.VISIT_DAILY_WRITES ?? VISIT_DAILY_WRITES), cf = (req as any).cf ?? {};
  const testNow = await isTestMode(env); // TEST mode (mode.ts): visits are kept apart (is_test) and never reach the owner's reports
  const bot = botName(ua), private_ = !bot && (b.gpc || gpcOn(req));
  const day = new Date(now).toISOString().slice(0, 10);
  const country = String(cf.country ?? req.headers.get("cf-ipcountry") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  const city = clean(cf.city, 60), { src, label } = classifySource({ refHost: b.ref, utmSource: b.utm.s, utmMedium: b.utm.m, ownHosts: ownHosts(req, env) });
  const evs = bot ? b.evs.filter((e) => e.k === "pv").slice(0, 1) : b.evs; // a crawler leaves one line per beacon: that it came, and where
  if (!evs.length) return none();
  const stage = Math.max(0, ...evs.map((e) => (e.k === "act" ? (e.n === "pack" ? 2 : e.n === "create" ? 3 : 0) : e.k === "sec" && e.n === "pricing" ? 1 : 0)));

  if (private_ && testNow) return none(); // not even an anonymous counter for a test visit
  if (private_) { // counts only: nothing that could point back to one visitor
    const bump = (dim: string, k: string, n = 1, ms = 0) => db.prepare("INSERT INTO visit_agg(day,dim,k,n,ms) VALUES(?,?,?,?,?) ON CONFLICT(day,dim,k) DO UPDATE SET n=n+excluded.n, ms=ms+excluded.ms").bind(day, dim, k, n, ms);
    const s = [];
    if (evs.some((e) => e.k === "pv")) { s.push(bump("gpc_pv", evs.find((e) => e.k === "pv")!.p), bump("gpc_src", src + "|" + label)); if (country) s.push(bump("gpc_country", country)); }
    for (const e of evs) {
      if (e.k === "sec") s.push(bump("gpc_section", e.p + "#" + e.n, 1, e.m));
      else if (e.k === "act") s.push(bump("gpc_act", e.n + ":" + (e.num ?? "")));
      else if (e.k === "exit") s.push(bump("gpc_exit", e.p));
    }
    if (stage > 0) s.push(bump("gpc_step", STEPS[stage]!));
    if (!s.length || !(await visitBudget(db, now, s.length * 2, cap)) || !(await spend(s.length * 2))) return none();
    await db.batch(s);
    return none();
  }

  const ex = await db.prepare("SELECT n_events FROM visit_session WHERE sid=?").bind(b.sid).first<{ n_events: number }>();
  if (ex && ex.n_events >= SESSION_MAX_EVENTS) return none();
  const stmts = [];
  const vid = bot ? "" : b.vid, first = evs.find((e) => e.k === "pv");
  if (!ex) {
    const landing = b.landing || first?.p || evs[0]!.p;
    const vno = vid ? ((await db.prepare("SELECT COUNT(*) AS c FROM visit_session WHERE vid=?").bind(vid).first<{ c: number }>())?.c ?? 0) + 1 : 1;
    const ino = iph && !bot ? ((await db.prepare("SELECT COUNT(*) AS c FROM visit_session WHERE iph=?").bind(iph).first<{ c: number }>())?.c ?? 0) + 1 : 1;
    const { browser, os } = parseUa(ua);
    stmts.push(db.prepare("INSERT OR IGNORE INTO visit_session(sid,vid,iph,ipshort,first_ms,last_ms,landing,src,ref_host,utm_source,utm_medium,utm_campaign,partner,device,browser,os,lang,country,city,is_bot,visit_no,ip_visit_no,is_test) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(b.sid, vid || null, iph || null, shortIp(ip) || null, now, now, landing, src, label || null, b.utm.s || null, b.utm.m || null, b.utm.c || null, b.partner || null, b.dv || null, bot ? bot : browser, os, b.lang || null, country || null, city || null, bot ? 1 : 0, vno, ino, testNow ? 1 : 0));
  }
  const last = [...evs].reverse().find((e) => e.k === "exit");
  for (const e of evs) stmts.push(db.prepare("INSERT INTO visit_event(sid,at_ms,kind,path,name,val,n) VALUES(?,?,?,?,?,?,?)").bind(b.sid, now, e.k, e.p, e.n || null, e.v || null, e.k === "sec" ? e.m : e.k === "exit" ? e.m : e.num));
  stmts.push(db.prepare("UPDATE visit_session SET last_ms=?, pages=pages+?, n_events=n_events+?, stage=MAX(stage,?), exit_path=COALESCE(?,exit_path), exit_section=COALESCE(?,exit_section), exit_ms=COALESCE(?,exit_ms), exit_scroll=COALESCE(?,exit_scroll) WHERE sid=?")
    .bind(now, evs.filter((e) => e.k === "pv").length, evs.length, stage, last?.p ?? null, last ? last.n || null : null, last?.m ?? null, last?.x ?? null, b.sid));
  const cost = stmts.length * 2 + 2;
  if (!(await visitBudget(db, now, cost, cap)) || !(await spend(cost))) return none();
  await db.batch(stmts);
  return none();
}

// ------------------------------------------------------------------------------------------------ linking a visitor to the person, and the later funnel steps
/** Called when an organizer account is made (via "start") or signs in: ties the visitor's earlier visits to that organizer, so later steps are counted against the first source. */
export async function linkVisitor(env: VisitEnv, req: Request, org: string, via: "start" | "signin", now: number, email = ""): Promise<void> {
  try {
    if (await isTestMode(env)) return; // a test account never claims a real visitor's earlier visits
    const hdrVid = req.headers.get("x-cb-vid") ?? "", sid = /^[a-f0-9]{16,32}$/.test(req.headers.get("x-cb-vs") ?? "") ? req.headers.get("x-cb-vs")! : "";
    const vid = gpcOn(req) ? "" : /^[a-f0-9]{32}$/.test(hdrVid) ? hdrVid : cookieVid(req);
    const eh = await emailHash(env, email);
    if (vid) await env.DB.prepare("UPDATE visit_session SET org=?, eh=COALESCE(?,eh) WHERE vid=? AND is_bot=0 AND (org IS NULL OR org=?)").bind(org, eh || null, vid, org).run();
    else if (sid && !gpcOn(req)) await env.DB.prepare("UPDATE visit_session SET org=?, eh=COALESCE(?,eh) WHERE sid=? AND is_bot=0 AND (org IS NULL OR org=?)").bind(org, eh || null, sid, org).run();
    if (via === "start") await recordFunnelForOrg(env, org, "account", now);
  } catch { /* tracking must never break an account */ }
}
/** A later funnel step for an organizer: counted once, against the visitor's first visit. With no visit on record (private browsing or a direct link) it only raises an anonymous counter. */
export async function recordFunnelForOrg(env: { DB: D1 }, org: string | null | undefined, step: Step, now: number): Promise<void> {
  try {
    if (!org || (await orgIsTest(env, org))) return; // a test account never counts in the funnel
    const db = env.DB, s = await db.prepare("SELECT sid FROM visit_session WHERE org=? AND is_bot=0 ORDER BY first_ms ASC LIMIT 1").bind(org).first<{ sid: string }>();
    if (!s) { await db.prepare("INSERT INTO visit_agg(day,dim,k,n,ms) VALUES(?,?,?,1,0) ON CONFLICT(day,dim,k) DO UPDATE SET n=n+1").bind(new Date(now).toISOString().slice(0, 10), "gpc_fun", step).run(); return; }
    if (await db.prepare("SELECT 1 AS x FROM visit_event WHERE sid=? AND kind='fun' AND name=? LIMIT 1").bind(s.sid, step).first()) return;
    await db.batch([
      db.prepare("INSERT INTO visit_event(sid,at_ms,kind,path,name,val,n) VALUES(?,?,'fun',NULL,?,NULL,NULL)").bind(s.sid, now, step),
      db.prepare("UPDATE visit_session SET stage=MAX(stage,?), last_ms=MAX(last_ms,?) WHERE sid=?").bind(STAGE[step]!, now, s.sid),
    ]);
  } catch { /* tracking must never break a payment */ }
}

// ------------------------------------------------------------------------------------------------ owner reports
export interface SessRow { sid: string; vid: string | null; iph: string | null; first_ms: number; src: string | null; ref_host: string | null; landing: string | null; device: string | null; lang: string | null; country: string | null; city: string | null; is_bot: number; visit_no: number; ip_visit_no: number; pages: number; exit_path: string | null; exit_section: string | null; exit_ms: number | null; exit_scroll: number | null; stage: number; browser: string | null; last_ms: number }
const tally = <T>(xs: T[], key: (x: T) => string | null | undefined, top = 15) => {
  const m = new Map<string, number>(); for (const x of xs) { const k = key(x); if (k != null && k !== "") m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, top).map(([k, n]) => ({ k, n }));
};
const rate1 = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
/** The numbers of the summary that come from session rows. Pure, so the arithmetic is tested on its own. Funnel and conversions are counted per VISITOR (the furthest step any of their visits reached), against the visitor's first source. */
export function summarize(rows: SessRow[]) {
  const humans = rows.filter((r) => !r.is_bot), bots = rows.filter((r) => r.is_bot);
  const key = (r: SessRow) => r.vid ?? r.sid;
  const byV = new Map<string, SessRow[]>(); for (const r of humans) { const a = byV.get(key(r)); if (a) a.push(r); else byV.set(key(r), [r]); }
  const vis = [...byV.values()].map((a) => { const s = [...a].sort((x, y) => x.first_ms - y.first_ms); return { first: s[0]!, stage: Math.max(...s.map((x) => x.stage)), returning: s.some((x) => x.visit_no > 1) }; });
  const funnel = STEPS.map((name, i) => { const n = vis.filter((v) => v.stage >= i).length; return { step: name, visitors: n, ofVisits: rate1(n, vis.length) }; })
    .map((f, i, a) => ({ ...f, ofPrevious: i === 0 ? null : rate1(f.visitors, a[i - 1]!.visitors) }));
  const bySrc = new Map<string, { src: string; label: string; visitors: number; account: number; published: number; paid: number }>();
  for (const v of vis) { const k = (v.first.src ?? "direct") + "|" + (v.first.ref_host ?? ""); const o = bySrc.get(k) ?? { src: v.first.src ?? "direct", label: v.first.ref_host ?? "", visitors: 0, account: 0, published: 0, paid: 0 }; o.visitors++; if (v.stage >= 4) o.account++; if (v.stage >= 5) o.published++; if (v.stage >= 6) o.paid++; bySrc.set(k, o); }
  const ex = humans.filter((r) => r.exit_path);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const botMap = new Map<string, { name: string; sessions: number; lastMs: number; pages: Set<string> }>();
  for (const r of bots) { const n = r.browser ?? "unknown", o = botMap.get(n) ?? { name: n, sessions: 0, lastMs: 0, pages: new Set<string>() }; o.sessions++; o.lastMs = Math.max(o.lastMs, r.last_ms); if (r.landing) o.pages.add(r.landing); botMap.set(n, o); }
  return {
    humans: { visitors: vis.length, sessions: humans.length, returningVisitors: vis.filter((v) => v.returning).length, returningIps: new Set(humans.filter((r) => r.iph && r.ip_visit_no > 1).map((r) => r.iph)).size, avgPagesPerSession: humans.length ? Math.round((humans.reduce((a, r) => a + r.pages, 0) / humans.length) * 10) / 10 : 0 },
    bots: { sessions: bots.length, crawlers: [...botMap.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 20).map((o) => ({ name: o.name, sessions: o.sessions, lastMs: o.lastMs, pages: [...o.pages].sort() })) },
    sources: tally(humans, (r) => (r.src ?? "direct") + (r.ref_host ? " / " + r.ref_host : "")), landing: tally(humans, (r) => r.landing), devices: tally(humans, (r) => r.device ?? "?"), languages: tally(humans, (r) => (r.lang ?? "").slice(0, 2).toLowerCase() || "?"),
    countries: tally(humans, (r) => r.country ?? "?"), cities: tally(humans, (r) => (r.city ? `${r.country ?? "?"} / ${r.city}` : null)),
    exits: { pages: tally(ex, (r) => r.exit_path), sections: tally(ex, (r) => r.exit_section || "(none)"), avgTimeOnPageMs: avg(ex.map((r) => r.exit_ms ?? 0)), avgScrollPct: avg(ex.map((r) => r.exit_scroll ?? 0)) },
    funnel, convertedBySource: [...bySrc.values()].sort((a, b) => b.visitors - a.visitors).map((o) => ({ ...o, paidRate: rate1(o.paid, o.visitors) })),
  };
}
export function parseRange(sp: URLSearchParams, now: number): { from: number; to: number } {
  const one = (v: string | null, endOfDay: boolean): number | null => { if (!v) return null; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { const t = Date.parse(v + "T00:00:00Z"); return Number.isFinite(t) ? t + (endOfDay ? DAY : 0) : null; } const n = Number(v); return Number.isFinite(n) && n > 1e11 ? n : null; };
  let to = one(sp.get("to"), true) ?? now + 1, from = one(sp.get("from"), false) ?? to - 30 * DAY;
  if (from >= to) from = to - DAY;
  if (to - from > 366 * DAY) from = to - 366 * DAY;
  return { from, to };
}
export async function visitsSummary(env: VisitEnv, from: number, to: number, test = false) {
  const db = env.DB;
  const rows = (await db.prepare("SELECT sid,vid,iph,first_ms,last_ms,src,ref_host,landing,device,lang,country,city,is_bot,visit_no,ip_visit_no,pages,exit_path,exit_section,exit_ms,exit_scroll,stage,browser FROM visit_session WHERE first_ms>=? AND first_ms<? AND is_test=? ORDER BY first_ms LIMIT 50000").bind(from, to, test ? 1 : 0).all<SessRow>()).results ?? [];
  const base = summarize(rows);
  const sec = (await db.prepare("SELECT e.path AS path, e.name AS name, COUNT(DISTINCT e.sid||'|'||e.path) AS views, COALESCE(SUM(e.n),0) AS dwell FROM visit_event e JOIN visit_session s ON s.sid=e.sid WHERE e.kind='sec' AND e.at_ms>=? AND e.at_ms<? AND s.is_bot=0 AND s.is_test=? GROUP BY e.path, e.name ORDER BY views DESC LIMIT 60").bind(from, to, test ? 1 : 0).all<any>()).results ?? [];
  const act = (await db.prepare("SELECT e.name AS name, e.n AS num, e.val AS val, COUNT(*) AS c FROM visit_event e JOIN visit_session s ON s.sid=e.sid WHERE e.kind='act' AND e.at_ms>=? AND e.at_ms<? AND s.is_bot=0 AND s.is_test=? GROUP BY e.name, e.n, e.val ORDER BY c DESC LIMIT 300").bind(from, to, test ? 1 : 0).all<any>()).results ?? [];
  const actions = new Map<string, number>(), size = new Map<number, { size: number; n: number; shown: { price: string; n: number }[] }>(), cur = new Map<string, number>();
  for (const a of act) {
    actions.set(a.name, (actions.get(a.name) ?? 0) + a.c);
    if (a.name === "pack" && a.num != null) { const o = size.get(a.num) ?? { size: a.num as number, n: 0, shown: [] as { price: string; n: number }[] }; o.n += a.c; if (a.val) o.shown.push({ price: a.val, n: a.c }); size.set(a.num, o); }
    if (a.name === "cur" && a.val) cur.set(a.val, (cur.get(a.val) ?? 0) + a.c);
  }
  const d0 = new Date(from).toISOString().slice(0, 10), d1 = new Date(to - 1).toISOString().slice(0, 10);
  const agg = (await db.prepare("SELECT day, dim, k, n, ms FROM visit_agg WHERE day>=? AND day<=? ORDER BY day, dim, k LIMIT 3000").bind(d0, d1).all<any>()).results ?? [];
  return {
    from, to, fromDay: d0, toDay: d1, mode: test ? "test" : "live", ...base,
    sections: sec.map((s: any) => ({ section: s.path + "#" + s.name, views: s.views, avgDwellMs: s.views ? Math.round(s.dwell / s.views) : 0 })),
    actions: [...actions.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    sizeChoice: [...size.values()].sort((a, b) => a.size - b.size), currencyChoice: [...cur.entries()].map(([currency, n]) => ({ currency, n })),
    privateCounts: agg.filter((x: any) => x.dim.startsWith("gpc_")), archived: agg.filter((x: any) => !x.dim.startsWith("gpc_")),
    note: "Funnel and conversions are counted per visitor against their first source; a visitor with Global Privacy Control or Do Not Track appears only in privateCounts.",
  };
}
/** GET /api/owner/visits/journey/<id>: id is a visitor id (32 hex) or ip_<32 hex> for a network-address hash. Every visit from the first one, with its events in order. */
export async function visitsJourney(env: VisitEnv, id: string) {
  const byIp = id.startsWith("ip_"), v = byIp ? id.slice(3) : id;
  if (!/^[a-f0-9]{32}$/.test(v)) return null;
  const sess = (await env.DB.prepare(`SELECT * FROM visit_session WHERE ${byIp ? "iph" : "vid"}=? ORDER BY first_ms ASC LIMIT 200`).bind(v).all<any>()).results ?? [];
  const out = [];
  for (const s of sess) {
    const ev = (await env.DB.prepare("SELECT at_ms, kind, path, name, val, n FROM visit_event WHERE sid=? ORDER BY id ASC LIMIT 500").bind(s.sid).all<any>()).results ?? [];
    out.push({ ...s, stageName: STEPS[s.stage] ?? "visit", events: ev });
  }
  return { id, by: byIp ? "network address (hashed)" : "visitor id", firstSeenMs: sess[0]?.first_ms ?? null, visits: sess.length, sessions: out };
}

// ------------------------------------------------------------------------------------------------ retention
/** 365 days after a session began, its totals go into anonymous per-day rows and the session and its events are deleted. A few days of catch-up per call. */
export async function sweepVisits(env: { DB: D1 }, now: number, days = VISIT_RETENTION_DAYS, maxDays = 7): Promise<{ days: number; sessions: number }> {
  const db = env.DB, cutoff = now - days * DAY, out = { days: 0, sessions: 0 };
  // test visits are never rolled into the anonymous totals: they are simply forgotten with the same age limit
  await db.prepare("DELETE FROM visit_event WHERE sid IN (SELECT sid FROM visit_session WHERE is_test=1 AND first_ms<?)").bind(cutoff).run();
  await db.prepare("DELETE FROM visit_session WHERE is_test=1 AND first_ms<?").bind(cutoff).run();
  for (let i = 0; i < maxDays; i++) {
    const m = (await db.prepare("SELECT MIN(first_ms) AS m FROM visit_session WHERE first_ms<?").bind(cutoff).first<{ m: number | null }>())?.m;
    if (m == null) break;
    const a = Math.floor(m / DAY) * DAY, b = Math.min(a + DAY, cutoff), day = new Date(a).toISOString().slice(0, 10);
    const up = "ON CONFLICT(day,dim,k) DO UPDATE SET n=n+excluded.n, ms=ms+excluded.ms";
    const s = (dim: string, kx: string, extra = "", nx = "COUNT(*)", msx = "0") => db.prepare(`INSERT INTO visit_agg(day,dim,k,n,ms) SELECT ?, '${dim}', ${kx}, ${nx}, ${msx} FROM visit_session WHERE first_ms>=? AND first_ms<? ${extra} GROUP BY ${kx} ${up}`).bind(day, a, b);
    const ev = (dim: string, kx: string, kind: string, nx: string, msx: string) => db.prepare(`INSERT INTO visit_agg(day,dim,k,n,ms) SELECT ?, '${dim}', ${kx}, ${nx}, ${msx} FROM visit_event e JOIN visit_session s ON s.sid=e.sid WHERE s.first_ms>=? AND s.first_ms<? AND s.is_bot=0 AND e.kind='${kind}' GROUP BY ${kx} ${up}`).bind(day, a, b);
    const n = (await db.prepare("SELECT COUNT(*) AS c FROM visit_session WHERE first_ms>=? AND first_ms<?").bind(a, b).first<{ c: number }>())?.c ?? 0;
    await db.batch([
      s("sess", "CASE is_bot WHEN 0 THEN 'human' ELSE 'bot' END"),
      s("visitors", "'human'", "AND is_bot=0", "COUNT(DISTINCT COALESCE(vid,sid))"),
      s("returning", "'human'", "AND is_bot=0 AND visit_no>1", "COUNT(DISTINCT COALESCE(vid,sid))"),
      s("src", "COALESCE(src,'')||'|'||COALESCE(ref_host,'')", "AND is_bot=0"), s("landing", "COALESCE(landing,'')", "AND is_bot=0"), s("country", "COALESCE(country,'')", "AND is_bot=0"), s("device", "COALESCE(device,'')", "AND is_bot=0"),
      s("exit", "exit_path", "AND is_bot=0 AND exit_path IS NOT NULL"), s("stage", "CAST(stage AS TEXT)", "AND is_bot=0"), s("bot", "COALESCE(browser,'')", "AND is_bot=1"),
      ev("section", "e.path||'#'||e.name", "sec", "COUNT(DISTINCT e.sid||'|'||e.path)", "COALESCE(SUM(e.n),0)"),
      ev("act", "e.name||':'||COALESCE(e.n,'')", "act", "COUNT(*)", "0"),
      db.prepare("DELETE FROM visit_event WHERE sid IN (SELECT sid FROM visit_session WHERE first_ms>=? AND first_ms<?)").bind(a, b),
      db.prepare("DELETE FROM visit_session WHERE first_ms>=? AND first_ms<?").bind(a, b),
    ]);
    out.days++; out.sessions += n;
    if (b < a + DAY) break; // the cut-off falls inside this day: the rest ages out on a later day
  }
  return out;
}
