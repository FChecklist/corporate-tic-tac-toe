// Central first-party visitor analytics: the collector. CANONICAL SOURCE (C:\ct\test-sites\site-analytics); every site carries a byte-for-byte copy (tools/sync.mjs, checksum test).
// It is the multi-site generalisation of the per-game tracker (apps/edge/src/visits.ts, owner-approved 2026-10-06) and keeps its privacy design:
//   - only a SHORTENED address is stored (IPv4 last number hidden, IPv6 first 48 bits) plus a keyed hash (ANALYTICS_KEY) that recognises the same address; the full address is stored ONLY when
//     the owner switches `full_ip` on in the dashboard (default OFF) and is erased 30 days later (`sweep`). No names, mobile numbers, typed text or query strings are ever read or stored.
//   - Global Privacy Control / Do Not Track: no visitor id, no address, no session row; only anonymous daily counters (a_agg, dims "gpc_*").
//   - Crawlers are kept apart (is_bot = 1), one line per beacon, and left out of every human number.
//   - A host that is not in SITES is refused, so previews and copies never pollute the numbers. Everything is first-party: the browser only talks to its own site's /api/t.
// Never throws into the page: every failure answers 204 and drops the beacon.
export interface D1Stmt { bind(...v: any[]): D1Stmt; run(): Promise<unknown>; all<T = any>(): Promise<{ results?: T[] }>; first<T = any>(): Promise<T | null> }
export interface D1Like { prepare(sql: string): D1Stmt; batch(xs: D1Stmt[]): Promise<unknown> }
export interface AEnv { ANALYTICS?: D1Like; ANALYTICS_KEY?: string; ANALYTICS_DAILY_WRITES?: string }

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS a_session (sid TEXT PRIMARY KEY, site TEXT NOT NULL, vid TEXT, iph TEXT, ipshort TEXT, ip_full TEXT, ip_full_ms INTEGER, first_ms INTEGER NOT NULL, last_ms INTEGER NOT NULL, landing TEXT, src TEXT, ref_host TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, partner TEXT, device TEXT, browser TEXT, os TEXT, lang TEXT, country TEXT, city TEXT, network TEXT, asn TEXT, is_bot INTEGER NOT NULL DEFAULT 0, visit_no INTEGER NOT NULL DEFAULT 1, ip_visit_no INTEGER NOT NULL DEFAULT 1, pages INTEGER NOT NULL DEFAULT 0, n_events INTEGER NOT NULL DEFAULT 0, exit_path TEXT, exit_section TEXT, exit_ms INTEGER, exit_scroll INTEGER, steps INTEGER NOT NULL DEFAULT 1, org TEXT)`,
  `CREATE INDEX IF NOT EXISTS a_session_first ON a_session (first_ms)`,
  `CREATE INDEX IF NOT EXISTS a_session_site ON a_session (site, first_ms)`,
  `CREATE INDEX IF NOT EXISTS a_session_vid ON a_session (vid)`,
  `CREATE INDEX IF NOT EXISTS a_session_iph ON a_session (iph)`,
  `CREATE INDEX IF NOT EXISTS a_session_org ON a_session (site, org)`,
  `CREATE TABLE IF NOT EXISTS a_event (id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL, site TEXT NOT NULL, at_ms INTEGER NOT NULL, kind TEXT NOT NULL, path TEXT, name TEXT, val TEXT, n INTEGER, x INTEGER)`,
  `CREATE INDEX IF NOT EXISTS a_event_sid ON a_event (sid)`,
  `CREATE INDEX IF NOT EXISTS a_event_at ON a_event (at_ms)`,
  `CREATE TABLE IF NOT EXISTS a_agg (day TEXT NOT NULL, site TEXT NOT NULL, dim TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site, dim, k))`,
  `CREATE TABLE IF NOT EXISTS a_alias (old TEXT PRIMARY KEY, canon TEXT NOT NULL, at_ms INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS a_alias_canon ON a_alias (canon)`,
  `CREATE TABLE IF NOT EXISTS a_setting (k TEXT PRIMARY KEY, v TEXT NOT NULL, at_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS a_usage (day TEXT PRIMARY KEY, writes INTEGER NOT NULL DEFAULT 0)`,
];
const ready = new WeakSet<object>();
/** Creates the tables on first use in this Worker instance (the deploy key cannot run migrations; migrations/0001 is the same SQL). */
export async function ensureSchema(db: D1Like): Promise<void> {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}

const DAY = 86_400_000;
export const RETENTION_DAYS = 365, FULL_IP_DAYS = 30;
export const BEACON_MAX_BYTES = 6000, BEACON_MAX_EVENTS = 20, SESSION_MAX_EVENTS = 400, BEACONS_PER_MINUTE = 60, DAILY_WRITES = 400_000;

/** The funnel. Each step is a flag on the session (a bit), counted per visitor; the order is only the usual one, a visitor may reach them in any order. */
export const STEPS = ["visit", "pricing", "signin", "create", "published", "paypage", "paid"] as const;
export type Step = (typeof STEPS)[number];
export const bitOf = (s: Step): number => 1 << STEPS.indexOf(s);
export const stepsOf = (mask: number): Step[] => STEPS.filter((_, i) => (mask & (1 << i)) !== 0);
const PATH_STEP: Record<string, Step> = { "/pricing": "pricing", "/pay": "paypage" };
const ACT_STEP: Record<string, Step> = { pack: "pricing", signin_open: "signin", signin_submit: "signin", start_open: "signin", start_submit: "signin", create: "create", publish: "published", paypage: "paypage", paid: "paid" };
/** Server-side steps a game reports (the game's own names on the left). */
const FUN_STEP: Record<string, Step> = { account: "signin", signin: "signin", create: "create", published: "published", paypage: "paypage", paid: "paid" };

// ------------------------------------------------------------------------------------------------ the sites
export interface SiteCfg {
  key: string; name: string; hosts: string[];
  /** Exact allow-list of clean paths; absent = every page of the site is tracked. */
  paths?: string[];
  /** Pages that are never tracked (a path and everything under it). */
  skip?: string[];
  /** Click names accepted from the browser; absent = any short slug. */
  acts?: string[];
}
const GAME_PATHS = ["/", "/legal", "/terms", "/dpa", "/subprocessors", "/partner-terms", "/organizer-guide", "/partner", "/signin", "/pay"];
const GAME_ACTS = ["pack", "create", "cur", "signin_open", "signin_submit", "start_open", "start_submit", "partner_click", "nav", "legal_click"];
const game = (key: string, name: string, hosts: string[]): SiteCfg => ({ key, name, hosts, paths: GAME_PATHS, acts: GAME_ACTS });
export const SITES: SiteCfg[] = [
  { key: "home", name: "Corporate Games home", hosts: ["home.corporatetambola.com"] },
  game("tambola", "Corporate Tambola", ["housie.corporatetambola.com", "corporatetambola.com", "www.corporatetambola.com"]),
  game("bingo", "Corporate Bingo", ["bingo.corporatetambola.com"]),
  game("snakes", "Corporate Snakes and Ladders", ["snakes.corporatetambola.com"]),
  game("luck", "Corporate Luck by Chance", ["luck.corporatetambola.com"]),
  game("tictactoe", "Corporate Tic Tac Toe", ["tictactoe.corporatetambola.com"]),
  game("luckydraw", "Corporate Lucky Draw", ["luckydraw.corporatetambola.com"]), // the live host (checked 3 Nov 2026: lucky.corporatetambola.com does not exist)
  { key: "console", name: "Corporate Games master console", hosts: ["console.corporatetambola.com"], paths: ["/", "/signin"] },
  { key: "dpdp", name: "VERIDIAN DPDP", hosts: ["veridian-aios.com", "www.veridian-aios.com", "app.veridian-aios.com", "dpdp.veridian-aios.com"], skip: ["/app", "/act", "/unsubscribe", "/p", "/copy", "/ai", "/api"] },
  { key: "townhall", name: "Townhall Records", hosts: ["townhall-records.com", "www.townhall-records.com"], skip: ["/api"] },
  { key: "startup", name: "Startup Coach", hosts: ["startup.rajatsir.com"], skip: ["/api"] },
  { key: "rajatsir", name: "rajatsir.com", hosts: ["www.rajatsir.com", "rajatsir.com"], skip: ["/api"] },
];
const norm = (h: string) => h.trim().toLowerCase().replace(/:\d+$/, "");
export function siteOf(host: string, sites: SiteCfg[] = SITES): SiteCfg | null { const h = norm(host); return sites.find((s) => s.hosts.includes(h)) ?? null; }
const allHosts = (sites: SiteCfg[]) => sites.flatMap((s) => s.hosts);

// ------------------------------------------------------------------------------------------------ addresses and keys
/** IPv4: last number hidden. IPv6: first 48 bits only. Anything else: empty. */
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
const hmacKeys = new Map<string, Promise<CryptoKey>>();
async function hmacHex(secret: string, msg: string): Promise<string> {
  let k = hmacKeys.get(secret);
  if (!k) { k = crypto.subtle.importKey("raw", enc.encode("site-analytics/v1|" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); if (hmacKeys.size > 8) hmacKeys.clear(); hmacKeys.set(secret, k); }
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", await k, enc.encode(msg))), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** Keyed hash of the full address (32 hex). The same address always gives the same value; without the key it cannot be reversed or guessed. Empty when no key is configured. */
export async function ipHash(env: AEnv, ip: string): Promise<string> {
  const v = (ip ?? "").trim().toLowerCase().replace(/^::ffff:/, "");
  return env.ANALYTICS_KEY && v ? (await hmacHex(env.ANALYTICS_KEY, "ip|" + v)).slice(0, 32) : "";
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
export function parseUa(ua: string): { browser: string; os: string } {
  const u = ua ?? "";
  const browser = /Edg\//.test(u) ? "Edge" : /OPR\/|Opera/.test(u) ? "Opera" : /SamsungBrowser/.test(u) ? "Samsung" : /Firefox\//.test(u) ? "Firefox" : /(Chrome|CriOS)\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "Other";
  const os = /Windows/.test(u) ? "Windows" : /Android/.test(u) ? "Android" : /(iPhone|iPad|iPod)/.test(u) ? "iOS" : /Mac OS X|Macintosh/.test(u) ? "macOS" : /CrOS/.test(u) ? "ChromeOS" : /Linux/.test(u) ? "Linux" : "Other";
  return { browser, os };
}
const SEARCH: [RegExp, string][] = [[/(^|\.)google\./, "google"], [/(^|\.)bing\.com$/, "bing"], [/duckduckgo\./, "duckduckgo"], [/(^|\.)yahoo\./, "yahoo"], [/baidu\./, "baidu"], [/yandex\./, "yandex"], [/ecosia\./, "ecosia"], [/search\.brave\.com$/, "brave"], [/(^|\.)ask\.com$/, "ask"], [/(^|\.)(chatgpt\.com|chat\.openai\.com)$/, "chatgpt"], [/(^|\.)perplexity\.ai$/, "perplexity"], [/(^|\.)claude\.ai$/, "claude"]];
const SOCIAL: [RegExp, string][] = [[/facebook\.|(^|\.)fb\.com$|l\.messenger/, "facebook"], [/instagram\./, "instagram"], [/linkedin\.|lnkd\.in$/, "linkedin"], [/(^|\.)t\.co$|twitter\./, "twitter"], [/(^|\.)x\.com$/, "x"], [/youtube\.|youtu\.be$/, "youtube"], [/whatsapp\./, "whatsapp"], [/reddit\./, "reddit"], [/(^|\.)t\.me$|telegram\./, "telegram"]];
/** Where a visit came from: a campaign (UTM), a search engine, a social site, one of our own sites, another site, or nowhere (direct). */
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
export interface Beacon { sid: string; vid: string; ov: string; gpc: boolean; landing: string; ref: string; utm: { s: string; m: string; c: string }; partner: string; dv: string; lang: string; evs: Ev[] }
const clean = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>"'`]/g, " ").trim().slice(0, n) : "");
const int = (v: unknown, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : 0; };

/** A clean path of the site, or null when the page must not be tracked. Long random-looking parts become ":id" so one path never identifies a person. */
export function normPath(p: unknown, cfg?: SiteCfg): string | null {
  if (typeof p !== "string") return null;
  let s = p.split(/[?#]/)[0]!.toLowerCase().replace(/\/index(\.html)?$/, "/").replace(/\.html$/, "").replace(/\/{2,}/g, "/");
  if (!s.startsWith("/") || s.length > 120 || !/^[a-z0-9_\-./:~]*$/.test(s)) return null;
  if (s.length > 1) s = s.replace(/\/+$/, "");
  s = s.split("/").map((g) => (/^[0-9a-f]{12,}$/.test(g) || /^\d{5,}$/.test(g) || /^[a-z0-9]{24,}$/.test(g) ? ":id" : g)).join("/");
  if (cfg?.paths && !cfg.paths.includes(s)) return null;
  if (cfg?.skip?.some((x) => s === x || s.startsWith(x + "/"))) return null;
  return s;
}

/** Checks and trims what a browser sent. Anything unexpected is dropped, never stored. */
export function parseBeacon(text: string, cfg?: SiteCfg): { ok: true; b: Beacon } | { ok: false; status: number } {
  if (text.length > BEACON_MAX_BYTES) return { ok: false, status: 413 };
  let j: any; try { j = JSON.parse(text); } catch { return { ok: false, status: 400 }; }
  if (!j || typeof j !== "object" || !/^[a-f0-9]{16,32}$/.test(String(j.s ?? ""))) return { ok: false, status: 400 };
  const evs: Ev[] = [];
  for (const e of (Array.isArray(j.e) ? j.e : []).slice(0, BEACON_MAX_EVENTS)) {
    if (!e || typeof e !== "object") continue;
    const p = normPath(e.p, cfg); if (!p) continue;
    const k = e.k, n = String(e.n ?? "");
    if (k === "pv") evs.push({ k, p, n: "", v: "", m: 0, x: 0, num: null });
    else if (k === "sec") { if (/^[a-z0-9_-]{1,24}$/.test(n)) evs.push({ k, p, n, v: "", m: int(e.m, 0, 3_600_000), x: 0, num: null }); }
    else if (k === "act") {
      const ok = cfg?.acts ? cfg.acts.includes(n) : /^[a-z0-9][a-z0-9_:.\/-]{0,39}$/.test(n);
      if (ok) evs.push({ k, p, n, v: clean(e.v, 40), m: 0, x: 0, num: e.z == null ? null : int(e.z, 0, 1_000_000) });
    } else if (k === "exit") evs.push({ k, p, n: /^[a-z0-9_-]{1,24}$/.test(n) ? n : "", v: "", m: int(e.m, 0, 86_400_000), x: int(e.x, 0, 100), num: null });
  }
  const ref = String(j.r ?? "").toLowerCase(), u = j.u && typeof j.u === "object" ? j.u : {};
  const hex32 = (v: unknown) => (/^[a-f0-9]{32}$/.test(String(v ?? "")) ? String(v) : "");
  return { ok: true, b: {
    sid: j.s, vid: hex32(j.d), ov: hex32(j.ov), gpc: j.g === 1 || j.g === true,
    landing: normPath(j.lp, cfg) ?? "", ref: /^[a-z0-9.-]{1,80}$/.test(ref) ? ref : "",
    utm: { s: clean(u.s, 40).replace(/[^\w.\- ]/g, ""), m: clean(u.m, 40).replace(/[^\w.\- ]/g, ""), c: clean(u.c, 60).replace(/[^\w.\- ]/g, "") },
    partner: /^[A-Za-z2-9]{8}$/.test(String(j.pc ?? "")) ? String(j.pc).toUpperCase() : "",
    dv: ["mobile", "tablet", "desktop"].includes(j.dv) ? j.dv : "", lang: /^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]{2,8})?$/.test(String(j.l ?? "")) ? String(j.l).slice(0, 12) : "", evs } };
}
/** The funnel steps a batch of events reached, as a bit mask (the visit itself is always there). */
export function stepMask(evs: Ev[]): number {
  let m = bitOf("visit");
  for (const e of evs) {
    const s = e.k === "pv" ? PATH_STEP[e.p] : e.k === "sec" && e.n === "pricing" ? "pricing" : e.k === "act" ? ACT_STEP[e.n] : undefined;
    if (s) m |= bitOf(s);
  }
  return m;
}

/** A small rate limit per Worker instance (no database): at most BEACONS_PER_MINUTE per key per minute. */
const rate = new Map<string, { w: number; n: number }>();
export const resetRate = () => { rate.clear(); setting.at = 0; };
export function rateLimited(key: string, now: number, max = BEACONS_PER_MINUTE): boolean {
  const w = Math.floor(now / 60_000), r = rate.get(key);
  if (rate.size > 5000) rate.clear();
  if (!r || r.w !== w) { rate.set(key, { w, n: 1 }); return false; }
  return ++r.n > max;
}
async function budget(db: D1Like, now: number, n: number, cap: number): Promise<boolean> {
  const day = new Date(now).toISOString().slice(0, 10);
  const row = await db.prepare("SELECT writes FROM a_usage WHERE day=?").bind(day).first<{ writes: number }>();
  if ((row?.writes ?? 0) + n > cap) return false;
  await db.prepare("INSERT INTO a_usage(day,writes) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET writes=writes+?").bind(day, n, n).run();
  return true;
}
/** The owner's switch for storing the full network address (default OFF). Read at most every 30 s per Worker instance. */
const setting = { at: 0, fullIp: false };
export async function fullIpOn(db: D1Like, now: number): Promise<boolean> {
  if (now - setting.at < 30_000 && setting.at > 0) return setting.fullIp;
  const r = await db.prepare("SELECT v FROM a_setting WHERE k='full_ip'").first<{ v: string }>();
  setting.fullIp = r?.v === "1"; setting.at = now || 1;
  return setting.fullIp;
}
export async function setFullIp(db: D1Like, on: boolean, now: number): Promise<void> {
  await ensureSchema(db);
  await db.prepare("INSERT INTO a_setting(k,v,at_ms) VALUES('full_ip',?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, at_ms=excluded.at_ms").bind(on ? "1" : "0", now).run();
  setting.at = 0;
}

const none = (status = 204) => new Response(null, { status, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
export const gpcOn = (req: Request) => req.headers.get("sec-gpc") === "1" || req.headers.get("dnt") === "1";

export interface CollectOpts { text?: string; sites?: SiteCfg[] }
/** POST /api/t: one small batch of events from a page of the site. Quiet by design: a browser never sees why something was dropped. */
export async function collect(req: Request, env: AEnv, now: number, opts: CollectOpts = {}): Promise<Response> {
  try {
    const db = env.ANALYTICS; if (!db) return none(404);
    if (req.method !== "POST") return none(404);
    const sites = opts.sites ?? SITES, host = new URL(req.url).hostname, cfg = siteOf(host, sites);
    if (!cfg) return none(403);
    const origin = req.headers.get("origin");
    if (origin) { let ok = false; try { ok = cfg.hosts.includes(norm(new URL(origin).hostname)); } catch { /* bad origin */ } if (!ok) return none(403); }
    if (req.headers.get("sec-fetch-site") === "cross-site") return none(403);
    if (Number(req.headers.get("content-length") ?? 0) > BEACON_MAX_BYTES) return none(413);
    const text = opts.text ?? (await req.text()), p = parseBeacon(text, cfg);
    if (!p.ok) return none(p.status);
    const b = p.b, ip = req.headers.get("cf-connecting-ip") ?? "", ua = req.headers.get("user-agent") ?? "", cf = (req as any).cf ?? {};
    const iph = await ipHash(env, ip);
    if (rateLimited("ip/" + (iph || ip || "local"), now) || rateLimited("sid/" + b.sid, now)) return none(429);
    if (!b.evs.length) return none();
    await ensureSchema(db);
    const cap = Number(env.ANALYTICS_DAILY_WRITES ?? DAILY_WRITES), bot = botName(ua), private_ = !bot && (b.gpc || gpcOn(req));
    const day = new Date(now).toISOString().slice(0, 10), site = cfg.key;
    const country = String(cf.country ?? req.headers.get("cf-ipcountry") ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
    const city = clean(cf.city, 60), network = clean(cf.asOrganization, 60), asn = String(cf.asn ?? "").replace(/[^0-9]/g, "").slice(0, 10);
    const { src, label } = classifySource({ refHost: b.ref, utmSource: b.utm.s, utmMedium: b.utm.m, ownHosts: allHosts(sites) });
    const evs = bot ? b.evs.filter((e) => e.k === "pv").slice(0, 1) : b.evs; // a crawler leaves one line per beacon: that it came, and where
    if (!evs.length) return none();
    const mask = stepMask(evs);

    if (private_) { // counts only: nothing that could point back to one visitor
      const bump = (dim: string, k: string, n = 1, ms = 0) => db.prepare("INSERT INTO a_agg(day,site,dim,k,n,ms) VALUES(?,?,?,?,?,?) ON CONFLICT(day,site,dim,k) DO UPDATE SET n=n+excluded.n, ms=ms+excluded.ms").bind(day, site, dim, k, n, ms);
      const s: D1Stmt[] = [], first = evs.find((e) => e.k === "pv");
      if (first) { s.push(bump("gpc_pv", first.p), bump("gpc_src", src + "|" + label)); if (country) s.push(bump("gpc_country", country)); }
      for (const e of evs) {
        if (e.k === "sec") s.push(bump("gpc_section", e.p + "#" + e.n, 1, e.m));
        else if (e.k === "act") s.push(bump("gpc_act", e.n));
        else if (e.k === "exit") s.push(bump("gpc_exit", e.p, 1, e.m));
      }
      for (const st of stepsOf(mask)) if (st !== "visit") s.push(bump("gpc_step", st));
      if (s.length && (await budget(db, now, s.length * 2, cap))) await db.batch(s);
      return none();
    }

    const ex = await db.prepare("SELECT n_events, site FROM a_session WHERE sid=?").bind(b.sid).first<{ n_events: number; site: string }>();
    if (ex && (ex.site !== site || ex.n_events >= SESSION_MAX_EVENTS)) return none();
    const stmts: D1Stmt[] = [], vid = bot ? "" : b.vid, first = evs.find((e) => e.k === "pv");
    if (!ex) {
      const landing = b.landing || first?.p || evs[0]!.p;
      const vno = vid ? ((await db.prepare("SELECT COUNT(*) AS c FROM a_session WHERE vid=? AND site=?").bind(vid, site).first<{ c: number }>())?.c ?? 0) + 1 : 1;
      const ino = iph && !bot ? ((await db.prepare("SELECT COUNT(*) AS c FROM a_session WHERE iph=? AND site=?").bind(iph, site).first<{ c: number }>())?.c ?? 0) + 1 : 1;
      const full = !bot && ip && (await fullIpOn(db, now)) ? ip.trim().slice(0, 45) : null;
      const row: Record<string, unknown> = {
        sid: b.sid, site, vid: vid || null, iph: iph || null, ipshort: shortIp(ip) || null, ip_full: full, ip_full_ms: full ? now : null, first_ms: now, last_ms: now, landing,
        src, ref_host: label || null, utm_source: b.utm.s || null, utm_medium: b.utm.m || null, utm_campaign: b.utm.c || null, partner: b.partner || null,
        device: b.dv || null, browser: bot ? bot : parseUa(ua).browser, os: parseUa(ua).os, lang: b.lang || null, country: country || null, city: city || null, network: network || null, asn: asn || null,
        is_bot: bot ? 1 : 0, visit_no: vno, ip_visit_no: ino,
      };
      const keys = Object.keys(row);
      stmts.push(db.prepare(`INSERT OR IGNORE INTO a_session(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`).bind(...keys.map((k) => row[k])));
    }
    // Only the first message of a visit carries where it came from (landing page, referrer, campaign tags). When a later message of the same visit was handled first, that message made the row without them: fill them in now.
    if (b.landing) stmts.push(db.prepare("UPDATE a_session SET landing=?, src=?, ref_host=?, utm_source=?, utm_medium=?, utm_campaign=?, partner=COALESCE(?,partner) WHERE sid=? AND site=?")
      .bind(b.landing, src, label || null, b.utm.s || null, b.utm.m || null, b.utm.c || null, b.partner || null, b.sid, site));
    if (!bot && b.vid && b.ov && b.ov !== b.vid) stmts.push(db.prepare("INSERT INTO a_alias(old,canon,at_ms) VALUES(?,?,?) ON CONFLICT(old) DO UPDATE SET canon=excluded.canon, at_ms=excluded.at_ms").bind(b.ov, b.vid, now));
    const last = [...evs].reverse().find((e) => e.k === "exit");
    for (const e of evs) stmts.push(db.prepare("INSERT INTO a_event(sid,site,at_ms,kind,path,name,val,n,x) VALUES(?,?,?,?,?,?,?,?,?)").bind(b.sid, site, now, e.k, e.p, e.n || null, e.v || null, e.k === "sec" || e.k === "exit" ? e.m : e.num, e.k === "exit" ? e.x : null));
    stmts.push(db.prepare("UPDATE a_session SET last_ms=?, pages=pages+?, n_events=n_events+?, steps=steps|?, exit_path=COALESCE(?,exit_path), exit_section=COALESCE(?,exit_section), exit_ms=COALESCE(?,exit_ms), exit_scroll=COALESCE(?,exit_scroll) WHERE sid=?")
      .bind(now, evs.filter((e) => e.k === "pv").length, evs.length, mask, last?.p ?? null, last ? last.n || null : null, last?.m ?? null, last?.x ?? null, b.sid));
    if (!(await budget(db, now, stmts.length * 2 + 2, cap))) return none();
    await db.batch(stmts);
    if (Math.random() < 0.005) await sweep(db, now).catch(() => {});
    return none();
  } catch { return none(); } // monitoring must never break a page
}

// ------------------------------------------------------------------------------------------------ games: copy what a game's own tracker already validated
const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
/** A game's own beacon route calls this after it has parsed a beacon: the same text is recorded in the central database. No-op until the ANALYTICS binding exists; never throws; gives up after 1.5 s. */
export async function mirrorBeacon(env: AEnv, req: Request, text: string, now: number): Promise<void> {
  if (!env.ANALYTICS) return;
  try { await withTimeout(collect(req, env, now, { text }), 1500); } catch { /* the game never waits for analytics */ }
}
/** A game ties a visitor to an organizer (account made or signed in): the visitor's earlier visits on THAT site now carry the organizer's opaque id. */
export const mirrorLink = (env: AEnv, req: Request, o: { org: string; vid?: string; sid?: string }): Promise<void> => withTimeout(linkInner(env, req, o), 1500).catch(() => {}); // never waits more than 1.5 s
async function linkInner(env: AEnv, req: Request, o: { org: string; vid?: string; sid?: string }): Promise<void> {
  const db = env.ANALYTICS; if (!db || gpcOn(req)) return;
  try {
    const cfg = siteOf(new URL(req.url).hostname); if (!cfg) return;
    await ensureSchema(db);
    const vid = /^[a-f0-9]{32}$/.test(o.vid ?? "") ? o.vid! : "", sid = /^[a-f0-9]{16,32}$/.test(o.sid ?? "") ? o.sid! : "";
    if (vid) await db.prepare("UPDATE a_session SET org=? WHERE vid=? AND site=? AND is_bot=0 AND (org IS NULL OR org=?)").bind(o.org, vid, cfg.key, o.org).run();
    else if (sid) await db.prepare("UPDATE a_session SET org=? WHERE sid=? AND site=? AND is_bot=0 AND (org IS NULL OR org=?)").bind(o.org, sid, cfg.key, o.org).run();
  } catch { /* analytics never breaks an account */ }
}
/** A later funnel step of an organizer (account, published, paid), counted once against that organizer's first visit on the site. No visit on record: only an anonymous counter goes up. */
export const mirrorFunnel = (env: AEnv, host: string, org: string | null | undefined, step: string, now: number): Promise<void> => withTimeout(funnelInner(env, host, org, step, now), 1500).catch(() => {}); // never holds up a payment for more than 1.5 s
async function funnelInner(env: AEnv, host: string, org: string | null | undefined, step: string, now: number): Promise<void> {
  const db = env.ANALYTICS, cfg = siteOf(host), st = FUN_STEP[step];
  if (!db || !cfg || !org || !st) return;
  try {
    await ensureSchema(db);
    const s = await db.prepare("SELECT sid FROM a_session WHERE site=? AND org=? AND is_bot=0 ORDER BY first_ms ASC LIMIT 1").bind(cfg.key, org).first<{ sid: string }>();
    if (!s) { await db.prepare("INSERT INTO a_agg(day,site,dim,k,n,ms) VALUES(?,?,?,?,1,0) ON CONFLICT(day,site,dim,k) DO UPDATE SET n=n+1").bind(new Date(now).toISOString().slice(0, 10), cfg.key, "gpc_fun", st).run(); return; }
    if (await db.prepare("SELECT 1 AS x FROM a_event WHERE sid=? AND kind='fun' AND name=? LIMIT 1").bind(s.sid, st).first()) return;
    await db.batch([
      db.prepare("INSERT INTO a_event(sid,site,at_ms,kind,path,name,val,n,x) VALUES(?,?,?,'fun',NULL,?,NULL,NULL,NULL)").bind(s.sid, cfg.key, now, st),
      db.prepare("UPDATE a_session SET steps=steps|?, last_ms=MAX(last_ms,?) WHERE sid=?").bind(bitOf(st), now, s.sid),
    ]);
  } catch { /* analytics never breaks a payment */ }
}

// ------------------------------------------------------------------------------------------------ retention
/** 365 days after a session began its totals go into anonymous per-day rows and the session and its events are deleted (a few days of catch-up per call); a full address is erased after 30 days. */
export async function sweep(db: D1Like, now: number, days = RETENTION_DAYS, maxDays = 7): Promise<{ days: number; sessions: number; fullIpsErased: number }> {
  await ensureSchema(db);
  const cutoff = now - days * DAY, out = { days: 0, sessions: 0, fullIpsErased: 0 };
  const er = await db.prepare("UPDATE a_session SET ip_full=NULL, ip_full_ms=NULL WHERE ip_full IS NOT NULL AND ip_full_ms<?").bind(now - FULL_IP_DAYS * DAY).run() as { meta?: { changes?: number } };
  out.fullIpsErased = er?.meta?.changes ?? 0;
  for (let i = 0; i < maxDays; i++) {
    const m = (await db.prepare("SELECT MIN(first_ms) AS m FROM a_session WHERE first_ms<?").bind(cutoff).first<{ m: number | null }>())?.m;
    if (m == null) break;
    const a = Math.floor(m / DAY) * DAY, b = Math.min(a + DAY, cutoff), day = new Date(a).toISOString().slice(0, 10);
    const up = "ON CONFLICT(day,site,dim,k) DO UPDATE SET n=n+excluded.n, ms=ms+excluded.ms";
    const s = (dim: string, kx: string, extra = "", nx = "COUNT(*)") => db.prepare(`INSERT INTO a_agg(day,site,dim,k,n,ms) SELECT ?, site, '${dim}', ${kx}, ${nx}, 0 FROM a_session WHERE first_ms>=? AND first_ms<? ${extra} GROUP BY site, ${kx} ${up}`).bind(day, a, b);
    const ev = (dim: string, kx: string, kind: string, nx: string, msx: string) => db.prepare(`INSERT INTO a_agg(day,site,dim,k,n,ms) SELECT ?, e.site, '${dim}', ${kx}, ${nx}, ${msx} FROM a_event e JOIN a_session s ON s.sid=e.sid WHERE s.first_ms>=? AND s.first_ms<? AND s.is_bot=0 AND e.kind='${kind}' GROUP BY e.site, ${kx} ${up}`).bind(day, a, b);
    const n = (await db.prepare("SELECT COUNT(*) AS c FROM a_session WHERE first_ms>=? AND first_ms<?").bind(a, b).first<{ c: number }>())?.c ?? 0;
    await db.batch([
      s("sess", "CASE is_bot WHEN 0 THEN 'human' ELSE 'bot' END"),
      s("visitors", "'human'", "AND is_bot=0", "COUNT(DISTINCT COALESCE(vid,sid))"),
      s("returning", "'human'", "AND is_bot=0 AND visit_no>1", "COUNT(DISTINCT COALESCE(vid,sid))"),
      s("src", "COALESCE(src,'')||'|'||COALESCE(ref_host,'')", "AND is_bot=0"), s("landing", "COALESCE(landing,'')", "AND is_bot=0"), s("country", "COALESCE(country,'')", "AND is_bot=0"), s("device", "COALESCE(device,'')", "AND is_bot=0"),
      s("exit", "exit_path", "AND is_bot=0 AND exit_path IS NOT NULL"), s("bot", "COALESCE(browser,'')", "AND is_bot=1"),
      ev("section", "e.path||'#'||e.name", "sec", "COUNT(DISTINCT e.sid||'|'||e.path)", "COALESCE(SUM(e.n),0)"),
      ev("act", "e.name", "act", "COUNT(*)", "0"),
      db.prepare("DELETE FROM a_event WHERE sid IN (SELECT sid FROM a_session WHERE first_ms>=? AND first_ms<?)").bind(a, b),
      db.prepare("DELETE FROM a_session WHERE first_ms>=? AND first_ms<?").bind(a, b),
    ]);
    out.days++; out.sessions += n;
    if (b < a + DAY) break; // the cut-off falls inside this day: the rest ages out on a later day
  }
  return out;
}
