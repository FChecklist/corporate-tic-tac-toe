// Cloudflare-Workers-shaped store for the zero-server design. It keeps only what must outlive phones: who joined, which claims were made,
// and the settled results. It never draws numbers and never verifies BLS (a free Worker has ~10 ms CPU; one verify costs ~60 ms),
// so winners are never posted by a person: every phone works them out from the public numbers and reports them, and a result is accepted when several different phones agree (winners.ts).
// D1-compatible: env.DB only uses prepare/bind/run/all/first/batch.
//
// Who may do what:
//   platform key  (env.ORGANIZER_SECRET)  - us: issues organizer keys, runs the daily purge, and can act on any engagement (also single-tenant/local mode).
//   master key    - the organizer's own console: everything for that organizer's engagements, including publishing results, erasing, registering the pause key.
//   AI key        - the organizer's external AI assistant: everything a person could do in the console EXCEPT publishing results, erasing data and
//                   registering/using the pause signing key (pausing needs the organizer's own browser; the AI can only ask, see /control/request).
//                   So an AI can never decide who wins, and never change what the public beacon decides. Every AI call is written to an audit trail (winners.ts).
//   Winners: nobody posts them. Phones report what they worked out and a result is accepted when several different phones agree (winners.ts, quorumFor).
//   nobody        - phones: join, send claims, read results counts, read the engagement info and the signed control file.

import { zoneTime, tzOfRow } from "./tz";
import { BRAND_COLORS, GRACE_ROUNDS, HOUSE_ORDER, isTimeZone, PRIZE_HOUSES, brandMomentsFor, defaultCfg, validateCfg, type EngagementCfg } from "../../../packages/beacon/src/config";
import { openPii, openText, sealPii, sealText } from "./pii";
import { TEST_LOGINS, TEST_LOGIN_CODE, TEST_LOGINS_PER_IP_DAY } from "./testlogins";
import { deviceMatches, checkinRequired, checkinRoute, presenceRoute, presentMsOf, seatOfPidText } from "./checkin";
import { TERMS_VERSION } from "./brand";
import RELEASES from "./releases.json";
import { LINK_MAIL_TTL_MS, aiLinkMail, coHostLinkMail, hostLinkMail, newUseAlertMail, signInMail } from "./mails";
import { cancelGame, cancelPreview, reopenGame, teamEmails } from "./cancel";
import { LEGAL_SCHEMA } from "./legal";
import { GAME_RECORD_SCHEMA, readGameRecords } from "./gamerecord";
import { RIGHTS_SCHEMA, leaveRoute, requestRoute } from "./rights";
import { ADMIN_SCHEMA, adminRoute, adminTick, countError, maintenanceGate } from "./admin";
import { recordServerError } from "./errorbox";
import { LEDGER_SCHEMA } from "./ledger";
import { LEDGERC_SCHEMA, ledgerCTick, ownerLedger } from "./ledgerc";
import { CREDIT_SCHEMA, activeCreditSummary, creditAppliedFor, creditRoute } from "./credit";
import { cloneGame } from "./clone";
import { acceptOver, acceptWon, endBoundMs, eraseEverything, erasePersonal, erasureOf, fullDeleteAt, lifecycleTick, MAX_AHEAD_MS, PAID_WINDOW_MS, latestStartMs, personalDeleteAt, SETTINGS_KEEP_MS, recordWinners, reportApi, reportLink } from "./lifecycle";
import { PAY_SCHEMA, payRoute, retryOutbox, sendMail, freeLaunch, payMode, FREE_CAP, FREE_GAME_CAP, MAX_DRAFTS, type PayEnv } from "./pay";
import { PACKS, price } from "../../../packages/shared/src/pricing";
import { PARTNER_SCHEMA, partnerRoute } from "./partners";
import { HELPDESK_SCHEMA, HELPER_MANUAL_NOTE, helpdeskCloseStatements, helpdeskRoute, helpdeskSweep, isDeskKeyId, isHelperKey, noteHelperGame } from "./helpdesk";
import { normEmp, empHashOf, verifyOf, keptPhone, phoneDigits, cleanName as cleanPersonName, PEOPLE_SCHEMA, COHOST_FROM, HOST_FROM, ORG_FROM, COHOST_LIMIT_DEFAULT, COHOST_LIMIT_MIN, COHOST_LIMIT_MAX, WAITING_MAX, addWaiting, chainOf, cleanPhone, fromCodeOf, inviterOf, joinLinkPage, limitOfInviter, listCount, parseFrom, peopleRoute, personByPhone, personByToken, srcOf, waitingWho, type PersonRow } from "./people";
import { PAYLINK_SCHEMA, PAYLINK_TOKEN, createPayLink, packFor } from "./paylink";
import { HOST_LINK_TTL_MS, HOST_SCHEMA, confirmHostEmail, emailHashOf, hostForEmail, hostKeyStatus, hostSetupRoute, hostStateRow, identityRow, maskEmail, maskMobile, mintDeviceKey, retireHost } from "./hostsetup";
import { googleClientId, verifyGoogleCredential } from "./google";
import { MODE_SCHEMA, isTestMode, modeRoute, orgIsTest, testFlag } from "./mode";
import { PURGE_HOURS } from "./lifetimes";
import { purgeTestData } from "./test-data";
import { frontDoorText, nextHint, GET_BODY_MAX, LINK_KEY, CONVERSATION, aiPaste, manualJson, manualText, type LinkRole } from "./ai-link";
import { factsText } from "./ai-facts";
import { mapJson, mapText } from "./ai-functions";
import { goScreen, screenJson, screenText } from "./ai-go";
import { AUDIT_SCHEMA, auditRequest, analyzeChain, loadRows, logAccess, setHold, toCsv, verifyChain, closeAuditFor, sweepAudit, type AuditEnv } from "./audit";
import { VISIT_SCHEMA, beaconRoute, linkVisitor, parseRange, recordFunnelForOrg, visitsJourney, visitsSummary, type VisitEnv } from "./visits";
import { TTT_SCHEMA, TTT_MAILBOX_SCHEMA, tttRoute, ensureT, tournamentStarted, tttTick } from "./tournament";
import { CONSENT_SCHEMA, CONSENT_VERSION, KINDS, consentMissing, consentRequired, hasConsent, hasConsented, recordConsent, textFor, type Kind } from "./consent";
import { knownDial } from "./phonekit";
import { WINNERS_SCHEMA, acceptVotes, auditAi, confirmPrize, listAiAudit, listPrizes, markGiven, myPrizes, overridePrize } from "./winners";
import { PAUSE_MAX_PARTICIPANTS, safetyForCap, publishControl, readPublished, registerKey, type KV } from "../../../packages/beacon/src/control";
import { QUICKNET } from "../../../packages/beacon/src/index";

export interface D1Result<T = any> { results?: T[]; meta?: { changes?: number } }
export interface D1Stmt { bind(...v: unknown[]): D1Stmt; run(): Promise<D1Result>; all<T = any>(): Promise<D1Result<T>>; first<T = any>(): Promise<T | null> }
export interface D1 { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<D1Result[]> }
export interface R2Like { put(key: string, value: string, opts?: unknown): Promise<unknown>; delete(key: string): Promise<unknown> }
export interface Env {
  DB: D1; ORGANIZER_SECRET?: string; DAILY_WRITE_BUDGET?: string; PHONE_SALT?: string;
  /** The secret that seals names and mobile numbers at rest (AES-256-GCM). Never stored in the database. */
  DATA_KEY?: string;
  /** Optional: the key that hashes network addresses for the public-page visit tracking (visits.ts); when absent it is derived from DATA_KEY. VISIT_DAILY_WRITES caps that tracking's share of the daily write allowance (default 20,000). */
  VISIT_KEY?: string; VISIT_DAILY_WRITES?: string;
  /** Shared secret of the mail service's inbound webhook (e-mail to us asking for a deletion). */
  INBOUND_SECRET?: string;
  /** The scheduled job's own key (it can call only the lifecycle tick, nothing else). */
  CRON_KEY?: string;
  /** "1" on the live site: the Worker refuses every request (503) unless every secret below is set, so a missing key can never fall back to a built-in constant. */
  STRICT_KEYS?: string;
  /** Optional: a public R2 bucket behind a cached custom domain. Phones then read the pause file from the CDN and never invoke the Worker for it. */
  CONTROL_R2?: R2Like; CONTROL_BASE?: string;
  /** Optional: an OpenAI-compatible chat endpoint the OWNER's 'analyze' route may send MASKED aggregates to (never IPs, device ids or names). */
  ANALYZE_AI_URL?: string; ANALYZE_AI_KEY?: string; ANALYZE_AI_MODEL?: string;
  /** Optional and public (it is not a secret): the Google sign-in client id. Without it the "Continue with Google" button is hidden and /api/auth/google answers 404. */
  GOOGLE_CLIENT_ID?: string;
}
const controlKey = (id: string) => `c/${id}.json`;
const controlUrl = (env: Env, id: string) => (env.CONTROL_BASE && env.CONTROL_R2 ? `${env.CONTROL_BASE.replace(/\/$/, "")}/${controlKey(id)}` : null);
/** Keeps the static copy in step with the stored file. Best effort: the Worker's own /control answer stays correct if this fails. */
async function mirrorControl(env: Env, id: string) {
  if (!env.CONTROL_R2) return;
  try { const f = await readPublished(d1kv(env), id); if (f) await env.CONTROL_R2.put(controlKey(id), JSON.stringify(f), { httpMetadata: { contentType: "application/json", cacheControl: "public, max-age=3" } }); } catch { /* the Worker route still serves it */ }
}
export const RETENTION_DAYS = 365;
/** An engagement that was never published is forgotten after this many days. */
export const DRAFT_DAYS = 30;
/** New organizer accounts one network address may open in a day (a free-plan guard, not a security wall). */
const STARTS_PER_DAY = 10;
/** Largest page of participants one request returns, so a 10,000-person list never costs a free Worker its ~10 ms of CPU in one go. */
export const PAGE = 2000;
/** Claims are only a live cross-check (settlement never uses them), and 7 rows per phone would eat the free write allowance, so they are stored only for engagements this size or smaller. */
export const CLAIM_TRACKING_MAX_CAP = 500;
const tracks = (e: { cap: number }) => e.cap <= CLAIM_TRACKING_MAX_CAP;
/** The part of the settings every phone needs, public by design: how many tickets, what each house wins, and when the brand breaks are. */
/** The brand strip as phones see it: the full brand (with the logo) from `info`; everywhere else only name and colour (a logo can be 40 KB and a 10,000-person list must not carry it). */
const brandOut = (c: EngagementCfg, withLogo: boolean) => (c.brand ? { brand: withLogo ? c.brand : { name: c.brand.name, color: c.brand.color, ...(c.brand.logo ? { hasLogo: true } : {}) } } : {});
const pub = (e: any, withLogo = false) => { const c = cfgOf(e); return { ...(c.mark ? { mark: c.mark } : {}), joinPhone: c.join === "phone", verify: c.verify ?? "number", employeesOnly: !!c.employeesOnly, tickets: c.tickets, rewards: c.rewards, breaks: c.breaks, rounds: c.rounds, invites: c.invites, opening: c.opening, closing: c.closing, ...(c.name ? { name: c.name } : {}), ...brandOut(c, withLogo) }; };
const cfgJson = (c: EngagementCfg) => JSON.stringify({ rewards: c.rewards, breaks: c.breaks, rounds: c.rounds, invites: c.invites, opening: c.opening, closing: c.closing, ...(c.name ? { name: c.name } : {}), ...(c.brand ? { brand: c.brand } : {}), ...(c.mark ? { mark: c.mark } : {}), ...(c.join ? { join: c.join } : {}), ...(c.tz ? { tz: c.tz } : {}), ...(c.verify ? { verify: c.verify } : {}), ...(c.employeesOnly ? { employeesOnly: true } : {}) });

/** Privacy and lifecycle: sealed personal data, the role / inviter / invite kind / source of a seat, when each game ended, the winners record that outlives the personal data, and the votes that tell us a game is over. */
export const PRIVACY_SCHEMA: string[] = [
  `ALTER TABLE participant ADD COLUMN pii TEXT`,
  `ALTER TABLE seat ADD COLUMN role TEXT`,
  `ALTER TABLE seat ADD COLUMN inv INTEGER`,
  `ALTER TABLE seat ADD COLUMN cat TEXT`,
  `ALTER TABLE seat ADD COLUMN src TEXT`,
  `CREATE TABLE IF NOT EXISTS life (eid TEXT PRIMARY KEY, end_ms INTEGER NOT NULL, end_src TEXT NOT NULL, report_ms INTEGER, report_state TEXT, purged_ms INTEGER, tries INTEGER NOT NULL DEFAULT 0, notified INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS winner (eid TEXT NOT NULL, round INTEGER NOT NULL, pattern TEXT NOT NULL, ordinal INTEGER NOT NULL, seat INTEGER NOT NULL, idx INTEGER, at_ms INTEGER, src TEXT NOT NULL, PRIMARY KEY (eid, round, pattern, ordinal, seat))`,
  `CREATE TABLE IF NOT EXISTS overvote (eid TEXT NOT NULL, seat INTEGER NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, seat))`,
];

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS engagement (id TEXT PRIMARY KEY, start_round INTEGER NOT NULL, call_seconds INTEGER NOT NULL, cap INTEGER NOT NULL, created_ms INTEGER NOT NULL, org TEXT, closed INTEGER NOT NULL DEFAULT 0, pack INTEGER, tickets INTEGER NOT NULL DEFAULT 1, config TEXT)`,
  `CREATE TABLE IF NOT EXISTS participant (eid TEXT NOT NULL, pid TEXT NOT NULL, phone_hash TEXT NOT NULL, name TEXT, joined_ms INTEGER NOT NULL, PRIMARY KEY (eid, pid))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS participant_phone ON participant (eid, phone_hash)`,
  `CREATE TABLE IF NOT EXISTS claim (eid TEXT NOT NULL, pid TEXT NOT NULL, pattern TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 1, idx INTEGER NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (eid, pid, pattern, round))`,
  `CREATE TABLE IF NOT EXISTS settled (eid TEXT NOT NULL, pattern TEXT NOT NULL, ordinal INTEGER NOT NULL DEFAULT 1, round INTEGER NOT NULL DEFAULT 1, idx INTEGER NOT NULL, pids TEXT NOT NULL, PRIMARY KEY (eid, pattern, ordinal, round))`,
  `CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, writes INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS organizer_key (hash TEXT PRIMARY KEY, org TEXT NOT NULL, kind TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cbl_request (id INTEGER PRIMARY KEY AUTOINCREMENT, eid TEXT NOT NULL, action TEXT NOT NULL, note TEXT, at_ms INTEGER NOT NULL, open INTEGER NOT NULL DEFAULT 1)`,
  `CREATE TABLE IF NOT EXISTS suggestion (id INTEGER PRIMARY KEY AUTOINCREMENT, org TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', note TEXT, votes INTEGER NOT NULL DEFAULT 1, created_ms INTEGER NOT NULL, title_hash TEXT NOT NULL, UNIQUE (org, title_hash))`,
  `CREATE TABLE IF NOT EXISTS suggestion_vote (sid INTEGER NOT NULL, org TEXT NOT NULL, PRIMARY KEY (sid, org))`,
  `CREATE TABLE IF NOT EXISTS login_code (email_hash TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_ms INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, win_start INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0)`,
  ...PAY_SCHEMA,
  ...PARTNER_SCHEMA,
  // a seat is a participant's place in the engagement: its number makes the card collision-free, and `dev` ties the card to the one device that joined
  `CREATE TABLE IF NOT EXISTS seat (eid TEXT NOT NULL, seq INTEGER NOT NULL, pid TEXT NOT NULL, ph TEXT NOT NULL, dev TEXT, PRIMARY KEY (eid, seq))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS seat_phone ON seat (eid, ph)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS seat_pid ON seat (eid, pid)`,
  // the beacon round a seat joined in, when that was after the game began (0 = joined in time): every phone counts that person's numbers from there
  `ALTER TABLE seat ADD COLUMN jr INTEGER`,
  ...PRIVACY_SCHEMA,
  ...WINNERS_SCHEMA,
  // a key made only for an e-mail lives 24 hours: after expires_ms it is treated like an unknown key (null = never expires, as before)
  `ALTER TABLE organizer_key ADD COLUMN expires_ms INTEGER`,
  // the one-click sign-in link in the sign-in e-mail: only its hash is kept, single use, same expiry as the 6-digit code
  `ALTER TABLE login_code ADD COLUMN link_hash TEXT`,
  // the version of the Terms an organizer accepted by continuing (create engagement, sign in)
  `CREATE TABLE IF NOT EXISTS organizer_terms (org TEXT NOT NULL, version TEXT NOT NULL, at_ms INTEGER NOT NULL, via TEXT NOT NULL, PRIMARY KEY (org, version))`,
  // partner codes are random; the partner's mobile number and e-mail are kept only as salted hashes
  `ALTER TABLE partner ADD COLUMN phone_hash TEXT`,
  `ALTER TABLE partner ADD COLUMN email_hash TEXT`,
  // the internal audit log (append-only, hash-chained, sealed), the owner's access log, deletion certificates and anonymous statistics, legal holds
  ...AUDIT_SCHEMA,
  // first-party visitor-journey tracking of the public pages, and its anonymous per-day totals
  ...VISIT_SCHEMA,
  // TEST / LIVE mode (mode.ts): the mode row, the owner's e-mail allow-list, the mail event log and the is_test flags
  ...MODE_SCHEMA,
  // roles (Organizer / Host / Co-host): a short private label on each Host and Co-host key (0014_roles.sql)
  `ALTER TABLE organizer_key ADD COLUMN label TEXT`,
  // cancel a game, refund, credit note, Host e-mail, Co-host bound to one game (0015_cancel_refund.sql)
  `ALTER TABLE engagement ADD COLUMN cancelled_ms INTEGER`,
  `ALTER TABLE engagement ADD COLUMN cancelled_by TEXT`,
  `ALTER TABLE organizer_key ADD COLUMN email_sealed TEXT`,
  `ALTER TABLE organizer_key ADD COLUMN eid TEXT`,
  `ALTER TABLE organizer_key ADD COLUMN pii TEXT`,
  `ALTER TABLE payment ADD COLUMN eid TEXT`,
  `ALTER TABLE payment ADD COLUMN confirming_ms INTEGER`,
  `CREATE INDEX IF NOT EXISTS payment_eid ON payment (eid)`,
  `CREATE TABLE IF NOT EXISTS refund (payment_id TEXT PRIMARY KEY, eid TEXT, org TEXT, currency TEXT NOT NULL, paid REAL NOT NULL, fee REAL NOT NULL, refund REAL NOT NULL, refund_status TEXT NOT NULL, rzp_refund_id TEXT, is_test INTEGER NOT NULL DEFAULT 0, note TEXT, requested_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS credit_note (token TEXT PRIMARY KEY, payment_id TEXT UNIQUE NOT NULL, brand TEXT NOT NULL, fy TEXT NOT NULL, seq INTEGER NOT NULL, number TEXT NOT NULL, issued_ms INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE (brand, fy, seq))`,
  // people, links and joining (0016_people.sql): one list per inviter, personal links, the waiting room, a blocked flag for removed seats
  ...PEOPLE_SCHEMA,
  // brand on the card needs no table (it lives in the game's settings); pay links anyone can open, and the Host first open (0017_brand_paylink_google.sql)
  ...PAYLINK_SCHEMA,
  ...HOST_SCHEMA,
  // credit instead of refunds, games that did not start, create a game like this one (0018_credit_retention_clone.sql)
  ...CREDIT_SCHEMA,
  ...LEGAL_SCHEMA,
  // one clear payment ledger for every product and website, plus the webhook log (0020_payment_ledger.sql)
  ...LEDGER_SCHEMA,
  // the Tic Tac Toe tournament: bracket, matches, players (0021_tournament.sql)
  ...TTT_SCHEMA,
  // every consent tick: who, game, Terms version, wording, time (0022_consent.sql)
  ...CONSENT_SCHEMA,
  // the tournament mailbox: moves with the server's stamps, reports, agreed results (0023_mailbox.sql)
  ...TTT_MAILBOX_SCHEMA,
  // ledger C: txn_id, fee/tax/method/bank reference on a payment, every payment attempt (success and failure), refunds, commission sync marks (0024_ledger_c.sql)
  ...LEDGERC_SCHEMA,
  ...RIGHTS_SCHEMA,
  // the owner's desk: the mail service's bounce / complaint / delivery events (admin.ts)
  ...ADMIN_SCHEMA,
  // Help Desk: a Refer-and-earn partner prepares games for an Organizer, who publishes with one tap (helpdesk.ts, 0027_helpdesk.sql)
  ...HELPDESK_SCHEMA,
  `CREATE TABLE IF NOT EXISTS partner_key (key_hash TEXT PRIMARY KEY, code TEXT NOT NULL, created_ms INTEGER NOT NULL)`, // Refer & earn: one key per phone or laptop that signed in by e-mail
  // the permanent settings record of every game, no personal data in it (0029_game_record.sql)
  ...GAME_RECORD_SCHEMA,
];

const PATTERNS = new Set<string>([...HOUSE_ORDER, "lucky"]); // houses a phone may claim
/** What the organizer set for this engagement (tickets per participant, reward lines, brand breaks); plain defaults when nothing was set. */
const cfgOf = (e: { tickets?: number; config?: string | null }): EngagementCfg => {
  try { const j = e.config ? JSON.parse(e.config) : {}; const v = validateCfg({ tickets: e.tickets ?? 1, rewards: j.rewards, breaks: j.breaks, rounds: j.rounds, invites: j.invites, opening: j.opening, closing: j.closing, name: j.name, brand: j.brand, mark: j.mark, join: j.join, tz: j.tz, verify: j.verify, employeesOnly: j.employeesOnly }, undefined, { stored: true }); if (v.ok) return v.cfg; } catch { /* fall through */ }
  return defaultCfg();
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
/** The public beacon, relayed (GET /api/beacon/<chain>/public/<round|latest>): a company network that blocks the beacon's own servers can still reach this site, so the numbers still come. Only the beacon's one chain and plain round numbers are passed on (never an open proxy); the phone checks every answer against the beacon's public key, so this is only a postman. A finished round never changes, so it is cached for good. */
async function beaconRelay(req: Request, chain: string, round: string): Promise<Response> {
  if (chain !== QUICKNET.chainHash) return json({ error: "Not found" }, 404);
  const key = new Request(new URL(`/api/beacon/${chain}/public/${round}`, req.url).toString());
  const cache = (globalThis as any).caches?.default as { match(r: Request): Promise<Response | undefined>; put(r: Request, x: Response): Promise<void> } | undefined;
  if (cache) { try { const hit = await cache.match(key); if (hit) return hit; } catch { /* no cache here */ } }
  for (const m of QUICKNET.mirrors) {
    try {
      const r = await fetch(`${m}/${chain}/public/${round}`, { signal: AbortSignal.timeout(3500) });
      if (r.status === 404) return json({ error: "That round is not published yet." }, 404);
      if (!r.ok) continue;
      const res = new Response(await r.text(), { headers: { "content-type": "application/json", "cache-control": round === "latest" ? "public, max-age=1" : "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
      if (cache) { try { await cache.put(key, res.clone()); } catch { /* not cached */ } }
      return res;
    } catch { /* the next mirror */ }
  }
  return json({ error: "The number service cannot be reached right now. Please try again in a moment." }, 502);
}
/** One shared answer per place per `ttlSec` seconds for a public read that is the same for everybody (the data centre's Cache API; absent in tests and local runs: then every call answers itself). Calls with a sign-in are never shared. Only a 200 is kept. */
async function sharedRead(req: Request, ttlSec: number, make: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as any).caches?.default as { match(r: Request): Promise<Response | undefined>; put(r: Request, x: Response): Promise<void> } | undefined;
  if (!cache || req.method !== "GET" || req.headers.get("x-organizer") || req.headers.get("authorization")) return make();
  const key = new Request(req.url, { method: "GET" });
  try { const hit = await cache.match(key); if (hit) return hit; } catch { /* no cache here */ }
  const res = await make();
  if (res.status === 200) { try { const keep = new Response(await res.clone().text(), { status: 200, headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": `public, max-age=${ttlSec}` } }); await cache.put(key, keep); } catch { /* not kept */ } }
  return res;
}
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const randHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const MAX_BODY = 4096;
/** The gap between two numbers: 6, 9, 12 or 15 seconds (the console offers these; the server holds every caller, an AI included, to them). */
const GAPS = [6, 9, 12, 15];
const GAP_MSG = "The call speed can be 6, 9, 12 or 15 seconds (this game does not use it; 9 is fine).";
/** A game time can be set at most 30 days ahead (the server enforces it for the console, the API and an AI alike). */
const TOO_FAR_PAID = (lastMs: number) => `A paid game can be moved to any date within 365 days of the payment. The last day is ${new Date(lastMs).toISOString().slice(0, 10)}.`;
const TOO_FAR = "A game can be set at most 30 days ahead. Please pick a day within the next 30 days.";
/** Settings and game creation may carry a brand logo (at most 30 KB decoded, about 40 KB as text). */
const BRAND_BODY_MAX = 60_000;
const ID = /^[A-Za-z0-9_-]{4,40}$/;
/** A game id sent with a Host link request, kept only if it is a game of this account (so a link can never point into someone else's game); otherwise "". */
async function ownGameId(env: Env, org: string, v: unknown): Promise<string> {
  if (typeof v !== "string" || !ID.test(v)) return "";
  return (await env.DB.prepare("SELECT 1 AS x FROM engagement WHERE id=? AND org=?").bind(v, org).first()) ? v : "";
}
const GENESIS = 1692803367; // drand quicknet; round r is published at GENESIS + (r-1)*3 s (UTC)
const roundMs = (r: number) => (GENESIS + (r - 1) * 3) * 1000;
/** An unpaid engagement is held from this long BEFORE its start, so every phone (they check every few seconds) knows before the first number would be shown. */
const LOCK_LEAD_MS = 45_000;
const roundOfMs = (ms: number) => Math.floor((ms / 1000 - GENESIS) / 3) + 1;
/** A published engagement is open to participants even before it is paid for; a draft is not. Paid engagements are always published. */
async function isPublished(env: Env, e: { id: string; pack: number | null }): Promise<boolean> {
  if (e.pack !== 0) return true;
  return !!(await env.DB.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`pub/${e.id}`).first());
}
const istTime = (ms: number, tz?: string) => zoneTime(ms, tz);
/** The organizer is e-mailed once, and only about their own engagement. A mail is a nudge, never a requirement. */
async function nudge(env: Env, id: string, flag: string, now: number, subject: string, text: string): Promise<void> {
  try {
    if (await env.DB.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`${flag}/${id}`).first()) return;
    const c = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`contact/${id}`).first<{ v: string }>();
    if (!c) return;
    await env.DB.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)").bind(`${flag}/${id}`, String(now)).run();
    await sendMail(env as PayEnv, env.DB, JSON.parse(c.v).email, subject, text, now);
  } catch { /* never block a request on a nudge */ }
}

async function body(req: Request, max = MAX_BODY): Promise<any | null> {
  const t = await req.text();
  if (t.length > max) return null;
  try { const v = JSON.parse(t); return v && typeof v === "object" ? v : null; } catch { return null; }
}

/** Free-plan guard: refuse politely before the daily write cap is hit, so a busy day never turns into a surprise failure or a bill. */
/**
 * The owner's own testing accounts (owner order 2026-10-25): a game made by one of these accounts, up to the size shown, is treated as already paid for (Rs 0), so the real site can be tested end to end
 * at 100, 250 or 1,000 people without anyone paying. Nothing about it is shown to the public: the size list is the same for everybody. An account is named by its e-mail address; `until` ends the permission.
 * At most 3 unused free packs exist for an account at a time. No payment, invoice or mail is made. Remove an entry (or let `until` pass) to stop it.
 */
export const OWNER_TEST_FREE: { email: string; maxCap: number; until: number }[] = [
  { email: "demo1@xyz.in", maxCap: 1000, until: Date.UTC(2026, 10, 8) }, // the test sign-in (code always 123456, no mail): used only by the test programs; ends on 8 Nov 2026. The owner's real addresses are NOT on this list: they see the real, unpaid first-time flow.
];
/**
 * Demo passes (owner order 2026-10-26): a long secret link that gives the account that opens it ONE free game (Rs 0) of up to `cap` people, for a prospect the owner chose, one to one.
 * Nothing is shown to the public and the size list and prices stay the same for everybody. Only the hashes of the links are here; the links themselves are given by hand and are not in this repository.
 * A link works once (the first account to use it keeps it), until `until`. Remove an entry (or let `until` pass) to switch it off. The free pack is the same kind of pack the Rs 0 test account gets.
 */
export const DEMO_PASSES: { hash: string; cap: number; label: string }[] = [
  // Corporate Tic Tac Toe has no owner-chosen links yet: add { hash: sha256("dpass|" + secret), cap, label } here (or let the owner console create them) and the link /zc.html?pass=<secret> gives that account one free game.
];
export const DEMO_PASS_UNTIL = Date.UTC(2026, 11, 31);
const passShape = (x: unknown): string => (typeof x === "string" && /^[0-9a-f]{32}$/i.test(x.trim()) ? x.trim().toLowerCase() : "");
/** Uses a demo pass for an account: ONE free pack of the pass's size, once (the first account to use a pass keeps it; the same account may open it again). */
async function redeemDemoPass(env: Env, org: string, rawToken: string, now: number): Promise<{ status: number; body: any; busy?: boolean }> {
  const bad = { status: 404, body: { error: "This demo link is not valid or has ended. Please ask us for a new one.", code: "pass-invalid" } };
  const tok = passShape(rawToken);
  if (!tok || now > DEMO_PASS_UNTIL) return bad;
  const ph = await sha("dpass|" + tok), def = DEMO_PASSES.find((x) => x.hash === ph);
  if (!def) return bad;
  if (!(await spend(env, now, 4))) return { status: 503, body: {}, busy: true };
  const first = await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO NOTHING").bind(`dpass/${ph}`, JSON.stringify({ org, at: now, label: def.label })).run();
  if (!(first as any)?.meta?.changes) { // used before: the same account may open it again (nothing more is given); anybody else is told it is taken
    const row = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`dpass/${ph}`).first<{ v: string }>();
    let who = ""; try { who = JSON.parse(row?.v ?? "{}").org ?? ""; } catch { /* unreadable */ }
    if (who === org) return { status: 200, body: { ok: true, again: true, cap: def.cap } };
    return { status: 409, body: { error: "This demo link has already been used. Please ask us for a new one.", code: "pass-used" } };
  }
  await env.DB.prepare("INSERT INTO entitlement(id,org,pack,payment_id,eid,created_ms) VALUES(?,?,?,'demo-pass',NULL,?)").bind("dp_" + randHex(6), org, def.cap, now).run();
  return { status: 200, body: { ok: true, cap: def.cap } };
}
/** The link's secret is kept with the e-mail address while the person signs in, so it is used whichever browser finishes the sign-in (for example the one-click link in the e-mail opening in a mail app). Only a secret that belongs to a real pass is kept. */
async function holdPassForSignIn(env: Env, eh: string, rawToken: unknown, now: number): Promise<void> {
  const tok = passShape(rawToken); if (!tok) return;
  const ph = await sha("dpass|" + tok); if (!DEMO_PASSES.some((x) => x.hash === ph)) return;
  await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`loginpass/${eh}`, JSON.stringify({ t: tok, at: now })).run();
}
async function useHeldPass(env: Env, org: string, eh: string, now: number): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`loginpass/${eh}`).first<{ v: string }>();
    if (!row) return;
    await env.DB.prepare("DELETE FROM kv WHERE k=?").bind(`loginpass/${eh}`).run();
    const x = JSON.parse(row.v); if (now - Number(x.at) <= 2 * 3_600_000) await redeemDemoPass(env, org, String(x.t), now);
  } catch { /* the pass is only a gift: sign-in never fails because of it */ }
}
async function ownerTestGrant(env: Env, org: string, cap: number, now: number): Promise<boolean> {
  for (const t of OWNER_TEST_FREE) {
    if (now > t.until || cap > t.maxCap) continue;
    const eh = await sha("email|" + t.email.trim().toLowerCase());
    if (!(await env.DB.prepare("SELECT 1 AS x FROM organizer_email WHERE email_hash=? AND org=?").bind(eh, org).first())) continue;
    const open = (await env.DB.prepare("SELECT COUNT(*) AS c FROM entitlement WHERE org=? AND payment_id='owner-test' AND eid IS NULL").bind(org).first<{ c: number }>())?.c ?? 0;
    if (open >= 3) return true; // enough unused free packs already
    await env.DB.prepare("INSERT INTO entitlement(id,org,pack,payment_id,eid,created_ms) VALUES(?,?,?,'owner-test',NULL,?)").bind("ot_" + randHex(6), org, t.maxCap, now).run();
    return true;
  }
  return false;
}
async function spend(env: Env, now: number, n = 1): Promise<boolean> {
  const budget = Number(env.DAILY_WRITE_BUDGET ?? 80_000); // D1 free cap is 100,000 rows written per day; keep a 20% margin
  const d = day(now);
  const row = await env.DB.prepare("SELECT writes FROM usage WHERE day=?").bind(d).first<{ writes: number }>();
  if ((row?.writes ?? 0) + n > budget) return false;
  await env.DB.prepare("INSERT INTO usage(day,writes) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET writes=writes+?").bind(d, n, n).run();
  return true;
}
/** An AI key (or a Host) never receives or sends names and mobile numbers: the organizer loads the list in the console. */
const CONSOLE_ONLY = () => json({ error: "Names and mobile numbers are handled by the owner in the console, not by the AI. Ask the owner to paste the list in the Participants card. You can set the limit with settings and refer to people by card number." }, 403);
/** One network address may open only so many NEW seats a day: protects the shared daily write budget from a script.
 *  A whole office or hall sits behind ONE address, so the allowance of a PAID game never falls below its pack: one address may seat up to the pack's size in a minute (and three times that in a day).
 *  The base figures (the environment's JOIN_PER_IP_MINUTE / JOIN_PER_IP_DAY, else the defaults below) still apply to an unpaid game and to the waiting room, so a script cannot use a big free game to burn the write budget. */
const JOIN_PER_IP_DAY = 1500, JOIN_PER_IP_MINUTE = 200, ID_MISS_PER_10MIN = 30;
async function joinOverLimit(env: Env, req: Request, now: number, paidSeats = 0): Promise<boolean> {
  try {
    const ip = (await sha("jip|" + (req.headers.get("cf-connecting-ip") ?? "local"))).slice(0, 16), perDay = Math.max(Number((env as any).JOIN_PER_IP_DAY ?? JOIN_PER_IP_DAY), paidSeats * 3), perMin = Math.max(Number((env as any).JOIN_PER_IP_MINUTE ?? JOIN_PER_IP_MINUTE), paidSeats);
    const bump = async (k: string, max: number) => { const n = Number((await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first<{ v: string }>())?.v ?? 0); if (n >= max) return true; await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?").bind(k, String(n + 1), String(n + 1)).run(); return false; };
    const iso = new Date(now).toISOString();
    return (await bump(`jbm/${iso.slice(0, 16)}/${ip}`, perMin)) || (await bump(`jlim/${iso.slice(0, 10)}/${ip}`, perDay));
  } catch { return false; }
}
const BUSY = () => json({ error: "It is very busy right now. Please try again in a few minutes." }, 503);
/** What one successful join writes to the database (participant, seat, person/consent/audit rows ...: counted ~9 on the 1.1.x logs). The daily write guard charges this, so "2,000,000 writes a day" means writes, not joins x 3. */
const JOIN_WRITES = 9;

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-organizer, x-partner, authorization, x-cb-vid, x-cb-vs", "access-control-allow-methods": "GET, POST, PUT, PATCH, OPTIONS", "access-control-max-age": "86400" };
/** Phones load the app from Pages and call this Worker from another origin, so every answer carries open CORS (no cookies are used anywhere). */
/** The message an organizer pastes into any AI chat: two short lines and the short link (/ai/<key>), which opens the complete manual. The key is only inside the link. The AI key cannot pay, publish, erase, pause or settle. */
export const aiMessage = (origin: string, key: string) => aiPaste(origin, key);
/** Records that this organizer continued under the current Terms (no tick box: continuing is the acceptance). One row per organizer and version. */
async function recordTerms(env: Env, org: string, now: number, via: string): Promise<void> {
  try { await env.DB.prepare("INSERT OR IGNORE INTO organizer_terms(org,version,at_ms,via) VALUES(?,?,?,?)").bind(org, TERMS_VERSION, now, via).run(); } catch { /* never block a request on this */ }
}
/** The organizer's e-mail address for the dedicated AI-link mails (the one used at sign-up), kept sealed; older accounts fall back to the address confirmed at their latest publish. null when unknown. */
async function orgEmail(env: Env, org: string): Promise<string | null> {
  try {
    const sealed = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`orgmail/${org}`).first<{ v: string }>();
    const e = await openText(env as any, sealed?.v);
    if (e) return e;
    const c = await env.DB.prepare("SELECT v FROM kv WHERE k LIKE 'contact/%' AND substr(k,9) IN (SELECT id FROM engagement WHERE org=? ORDER BY created_ms DESC) LIMIT 1").bind(org).first<{ v: string }>();
    return c ? (JSON.parse(c.v).email as string) : null;
  } catch { return null; }
}
/** Mints a key that works for 24 hours only and e-mails it in the dedicated mail: the only way an AI link ever travels by e-mail. The lasting key never leaves the console. Returns mailed:false (and the paste, so it is not lost) when no address is known or the mail failed. */
async function mailTempLink(env: Env, req: Request, org: string, kind: "ai" | "host", why: "start" | "replace" | "fresh", now: number, knownEmail?: string): Promise<{ mailed: boolean; expiresMs: number; aiMessage?: string }> {
  const key = (kind === "ai" ? "cba_" : "cbh_") + randHex(24), expiresMs = now + LINK_MAIL_TTL_MS;
  await env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,expires_ms,is_test) VALUES(?,?,?,0,?,?,COALESCE((SELECT MAX(k2.is_test) FROM organizer_key k2 WHERE k2.org=?),0))").bind(await sha("key|" + key), org, kind, now, expiresMs, org).run(); // a key of a test account is a test key too
  const origin = (env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin;
  const to = knownEmail ?? (await orgEmail(env, org));
  let mailed = false;
  if (to) { const m = kind === "ai" ? aiLinkMail(origin, key, why, expiresMs) : coHostLinkMail(origin, key, to, expiresMs); mailed = await sendMail(env as PayEnv, env.DB, to, m.subject, m.text, now, { html: m.html, secret: true }); }
  return { mailed, expiresMs, ...(mailed ? {} : { aiMessage: aiMessage(origin, key) }) };
}
/** Replaces the organizer's AI work link: every AI key (lasting and 24-hour) stops at once, a new lasting key is made for the console, and a fresh 24-hour key goes out in the dedicated mail. */
async function replaceAiLink(env: Env, req: Request, org: string, now: number): Promise<{ aiKey: string; aiMessage: string; mailed: boolean }> {
  await env.DB.prepare("UPDATE organizer_key SET revoked=1 WHERE org=? AND kind='ai' AND COALESCE(created_by,'')<>'d'").bind(org).run(); // a Help Desk helper's own key (created_by 'd') is the helper's, not the organizer's link
  const key = "cba_" + randHex(24);
  await env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test) VALUES(?,?,?,0,?,COALESCE((SELECT MAX(k2.is_test) FROM organizer_key k2 WHERE k2.org=?),0))").bind(await sha("key|" + key), org, "ai", now, org).run();
  await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`aikey/${org}`, await sealText(env as any, key)).run();
  const origin = (env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin;
  const t = await mailTempLink(env, req, org, "ai", "replace", now);
  return { aiKey: key, aiMessage: aiMessage(origin, key), mailed: t.mailed };
}
/** Alert (once per key per 24 h): an AI or Host key was used from a country, network prefix or program this key has not been seen from. The very first use sets the baseline and never alerts. The alert carries no link and no key. */
async function noteUse(env: Env, org: string, kind: "ai" | "host", keyId: string, req: Request, now: number): Promise<void> {
  try {
    const country = (req.headers.get("cf-ipcountry") ?? "").toUpperCase().slice(0, 4);
    const ip = req.headers.get("cf-connecting-ip") ?? "";
    const prefix = ip.includes(":") ? ip.split(":").slice(0, 3).join(":") : ip.split(".").slice(0, 3).join(".");
    const ua = (req.headers.get("user-agent") ?? "").trim(); const fam = (ua.split(/[\/\s(;]/)[0] ?? "").toLowerCase().slice(0, 40);
    const row = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`seen/${keyId}`).first<{ v: string }>();
    const seen: { c: string[]; p: string[]; u: string[] } = row ? JSON.parse(row.v) : { c: [], p: [], u: [] };
    const fresh = { c: !!country && !seen.c.includes(country), p: !!prefix && !seen.p.includes(prefix), u: !!fam && !seen.u.includes(fam) };
    if (row && !fresh.c && !fresh.p && !fresh.u) return;
    const add = (arr: string[], v: string) => { if (v && !arr.includes(v)) arr.push(v); if (arr.length > 40) arr.shift(); };
    add(seen.c, country); add(seen.p, prefix); add(seen.u, fam);
    await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`seen/${keyId}`, JSON.stringify(seen)).run();
    if (!row) return; // first use of this key: the baseline
    const last = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`alert/${keyId}`).first<{ v: string }>();
    if (last && now - Number(last.v) < 86_400_000) return;
    if (await isDeskKeyId(env.DB, keyId)) return; // a Help Desk helper uses their own devices: no alert about it
    const to = await orgEmail(env, org);
    if (!to) return;
    await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`alert/${keyId}`, String(now)).run();
    const m = newUseAlertMail({ when: istTime(now), country, program: ua.slice(0, 60), kind: kind === "ai" ? "AI" : "Host", origin: (env as PayEnv).PUBLIC_ORIGIN });
    await sendMail(env as PayEnv, env.DB, to, m.subject, m.text, now, { html: m.html });
  } catch { /* an alert must never break the work */ }
}
/** Published but unpaid games starting within 36 hours: one reminder to the organizer (`nudge` sends it once per game). Run by the scheduled job every minute, and by the daily housekeeping. */
export async function remindUnpaid(env: Env, now: number): Promise<void> {
  try {
    const due = await env.DB.prepare("SELECT e.id, e.start_round, (SELECT v FROM kv WHERE k='pub/'||e.id) AS pub FROM engagement e WHERE e.pack=0 AND EXISTS (SELECT 1 FROM kv WHERE k='pub/'||e.id)").all<{ id: string; start_round: number; pub: string }>();
    for (const x of due.results ?? []) {
      const at = roundMs(x.start_round);
      if (at > now && at - now < 36 * 3_600_000 && now - (Number(x.pub) || 0) >= 2 * 3_600_000) await nudge(env, x.id, "remind", now, `Payment pending for your game ${x.id}: it starts ${istTime(at)}`, `Your game ${x.id} starts ${istTime(at)}. It is not paid yet, and a game that is not paid for does not begin.\n\nYou can pay at any time until the guest data is erased (${PURGE_HOURS} hours after the game was meant to end). If you pay late, the game opens 2 minutes after the payment is confirmed.\n\nPay now (about 2 minutes): ${(env as PayEnv).PUBLIC_ORIGIN ?? ""}/pay.html?e=${x.id}`);
    }
  } catch { /* tried again at the next tick */ }
}
/** Runs the daily clean-up (365-day purge, one more try for unsent mail) the first time an organizer-side request arrives each UTC day. Never slows or fails the request. */
export async function housekeeping(env: Env, now: number): Promise<void> {
  try {
    const d = day(now);
    const last = await env.DB.prepare("SELECT v FROM kv WHERE k='housekeeping_day'").first<{ v: string }>();
    if (last?.v === d) return;
    await env.DB.prepare("INSERT INTO kv(k,v) VALUES('housekeeping_day',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(d).run(); // claim the day first so two requests do not both run it
    await purgeOld(env, now);
    await retryOutbox(env as PayEnv, now);
    await remindUnpaid(env, now);
    await helpdeskSweep(env.DB, now);
  } catch { /* try again on the next request */ }
}
/** Everything the scheduled job does on each call (POST /api/lifecycle/tick), in one place so the lazy tick below runs exactly the same housekeeping. Records when it last ran (`tick_last_ms`). */
export async function runTick(env: Env, now: number) {
  await adminTick(env.DB, now); // old error counters and old mail events go (admin.ts)
  await remindUnpaid(env, now);
  const ledgerC = await ledgerCTick(env as PayEnv, now); // ledger C -> B: a few commission rows and, every 30 minutes, the monthly figures (ledgerc.ts)
  const life = await lifecycleTick(env as any, now);
  let tttDue = 0; try { tttDue = await tttTick(env, now); } catch { /* tried again next minute */ } // clock-outs that are due in running tournaments
  const purged = await purgeOld(env, now);
  try { await env.DB.prepare("INSERT INTO kv(k,v) VALUES('tick_last_ms',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(String(now)).run(); } catch { /* the stamp only spares a repeat */ }
  return { ...life, purged, tttDue, ledgerC };
}
/** The lazy tick (go-to-market fix, docs/RETENTION.md): GitHub's scheduler runs the real tick only about every 2 hours, but the promise to players is deletion within 24 hours. So any /api request also runs the same housekeeping when the last tick is older than LAZY_TICK_MS. It never delays the answer (waitUntil), never throws, and only one run starts at a time (an in-memory flag per instance, and one row claimed in D1 across instances). */
export const LAZY_TICK_MS = 5 * 60_000;
let lazyBusy = false, lazyCheckedAt = 0;
export function lazyTickReset() { lazyBusy = false; lazyCheckedAt = 0; }
async function lazyTick(env: Env, now: number): Promise<void> {
  if (lazyBusy) return;
  lazyBusy = true;
  try {
    lazyCheckedAt = now;
    const claimed = await env.DB.prepare("INSERT INTO kv(k,v) VALUES('tick_last_ms',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v WHERE CAST(kv.v AS INTEGER) <= ?").bind(String(now), now - LAZY_TICK_MS).run();
    if ((claimed.meta?.changes ?? 0) < 1) return; // a tick ran within the last 5 minutes (or another instance just claimed the slot)
    await runTick(env, now);
  } catch { /* the next request tries again */ } finally { lazyBusy = false; }
}
/** Safety net while the scheduled job is not running: an organizer-side request, or a phone saying the game is over, also nudges the lifecycle (at most once a minute per Worker instance). The scheduled job is the real clock. */
let lastNudge = 0;
/** The names of the secrets this Worker needs in production (STRICT_KEYS=1) and does not have. Empty when strict mode is off (local runs and tests). */
export const missingKeys = (env: Env): string[] => (env.STRICT_KEYS === "1" ? ["DATA_KEY", "PHONE_SALT", "ORGANIZER_SECRET", "CRON_KEY", "INBOUND_SECRET"].filter((k) => !String((env as any)[k] ?? "").trim()) : []);
const keysMissing = (env: Env) => missingKeys(env).length > 0;
/** The front door: the owner's site switch (admin.ts) first, then the real handler; every 5xx answer is counted for the error signal (A7). */
/** What a proven e-mail gets: an Organizer key when there is an Organizer account, a Host key when the address is a confirmed Host, and BOTH when the person is both
 *  (one is the key in use, the other comes as `alt` so the console can switch role without another code). `roles` says which ones exist. */
async function signInResult(env: Env, req: Request, acct: { org: string } | null, hostAcct: { host_id: string; org: string } | null, now: number, email: string | null) {
  const roles: string[] = [];
  let token = "", alt: { kind: "organizer" | "host"; token: string } | undefined, kind: "organizer" | "host" = "organizer", ready: boolean | undefined;
  const hostKey = async () => { const hs = await hostStateRow(env.DB, hostAcct!.host_id); ready = !!hs?.verified_ms && !!hs?.mobile_ok; return mintDeviceKey(env, hostAcct!.host_id, newHostKey(), now); };
  if (acct) {
    await linkVisitor(env as VisitEnv, req, acct.org, "signin", now, email ?? undefined);
    await recordTerms(env, acct.org, now, email ? "signin-code" : "signin-link"); // the Terms version this organizer signed in under
    if (email) { try { await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`orgmail/${acct.org}`, await sealText(env as any, email)).run(); } catch { /* the address is shown at the top right only when known */ } } // keep the address sealed: shown to the organizer at the top right
    const t = "cbk_" + randHex(24); // a fresh organizer key; the old ones keep working until the organizer retires them
    await env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test) VALUES(?,?,?,0,?,COALESCE((SELECT MAX(k2.is_test) FROM organizer_key k2 WHERE k2.org=?),0))").bind(await sha("key|" + t), acct.org, "master", now, acct.org).run();
    token = t; roles.push("organizer");
    if (hostAcct) { alt = { kind: "host", token: await hostKey() }; roles.push("host"); }
  } else if (hostAcct) { token = await hostKey(); kind = "host"; roles.push("host"); }
  return { ok: true, token, kind, roles, ...(alt ? { alt } : {}), ...(kind === "host" ? { ready } : {}) };
}

export async function handle(req: Request, env: Env, now = Date.now(), waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  const off = await maintenanceGate(req, env, now).catch(() => null);
  if (off) return off;
  let res: Response;
  try { res = await handleCore(req, env, now, waitUntil); } catch (e) { await countError(env.DB, now); const p = recordServerError(env.DB, req, e, 500, now); if (waitUntil) waitUntil(p); else await p; return json({ error: "Something went wrong. Please try again.", code: "server-error" }, 500); }
  if (res.status >= 500) { await countError(env.DB, now); const p = recordServerError(env.DB, req, undefined, res.status, now); if (waitUntil) waitUntil(p); else await p; }
  return res;
}
async function handleCore(req: Request, env: Env, now = Date.now(), waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  if (keysMissing(env)) return new Response(JSON.stringify({ error: "The service is not configured. Please try again later." }), { status: 503, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const pn = new URL(req.url).pathname;
  if (pn === "/ai" || pn.startsWith("/ai/")) return aiLink(req, env, now, waitUntil);
  if (req.method === "GET" && pn.startsWith("/j/")) return joinLinkPage(env, decodeURIComponent(pn.slice(3)).replace(/\/$/, ""), (env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin, (e) => cfgOf(e).name || e.id); // the short personal link (people.ts)
  return handle0(req, env, now, waitUntil);
}

const LINK_HEADERS = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "cache-control": "no-store", "x-content-type-options": "nosniff" };
const linkText = (s: string, status = 200) => new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8", ...LINK_HEADERS } });
/** Same answer for a mistyped, unknown, revoked or wrong-kind key: nothing to learn from it. */
const linkGone = () => linkText("Not found.", 404);
/**
 * The short AI work link: /ai/<key> is the complete manual for that key's role, and /ai/<key>/<api path> is the normal /api/<api path> route with the key
 * taken from the address instead of a header (so a chat AI that can only open web addresses can work). Only Organizer-AI (cba_) and Host (cbh_) keys work here:
 * an organizer's own sign-in key and the platform key are never accepted in an address. For browse-only AIs, GET plus _method=POST|PATCH and _body=<URL-encoded JSON> performs that action.
 * The rewritten request carries the key in x-organizer, so the audit trail records it like any other AI call, with the /api path and no key in the path.
 */
async function aiLink(req: Request, env: Env, now: number, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, ...LINK_HEADERS } });
  const m = url.pathname.match(/^\/ai\/([^/]+)(?:\/(.*))?$/s);
  if (!m || !LINK_KEY.test(m[1]!)) return linkGone();
  const key = m[1]!;
  const a = await authOfKey(env, key, now);
  if (a.plat || !a.org || (a.kind !== "ai" && a.kind !== "host")) return linkGone();
  const origin = (env as PayEnv).PUBLIC_ORIGIN ?? url.origin;
  const role: LinkRole = a.kind;
  const rest = (m[2] ?? "").replace(/^api\//, "");
  if (rest === "") {
    if (req.method !== "GET" && req.method !== "HEAD") return linkText("This address is read with GET.", 405);
    const keyId = (await sha("key|" + key)).slice(0, 10);
    const work = auditAi(env.DB, a.org, new Request(origin + "/ai/manual", { method: "GET", headers: req.headers }), keyId, 200, now);
    if (waitUntil) waitUntil(work); else await work;
    await noteUse(env, a.org, role === "ai" ? "ai" : "host", keyId, req, now);
    const h = new Headers({ ...CORS, ...LINK_HEADERS });
    const helperNote = role === "ai" && (await isHelperKey(env.DB, key)) ? HELPER_MANUAL_NOTE : ""; // a Help Desk helper's key: the manual also says "you prepare, the Organizer publishes" (helpdesk.ts)
    if (url.searchParams.get("format") === "json") { h.set("content-type", "application/json; charset=utf-8"); return new Response(req.method === "HEAD" ? null : JSON.stringify({ ...manualJson(origin, key, role, now), ...(helperNote ? { helpDesk: helperNote } : {}) }), { headers: h }); }
    h.set("content-type", "text/plain; charset=utf-8");
    return new Response(req.method === "HEAD" ? null : manualText(origin, key, role, now) + (helperNote ? "\n\n" + helperNote + "\n" : ""), { headers: h });
  }
  if (rest === "start" || rest === "map" || rest === "facts" || rest === "go" || rest.startsWith("go/")) { // the front door, the list of functions, the facts, and the guided step links
    if (req.method !== "GET" && req.method !== "HEAD") return linkText("These addresses are read with GET.", 405);
    const kind = rest === "start" || rest === "map" || rest === "facts" ? rest : "go";
    const keyId = (await sha("key|" + key)).slice(0, 10);
    const work = auditAi(env.DB, a.org, new Request(origin + "/ai/" + kind, { method: "GET", headers: req.headers }), keyId, 200, now);
    if (waitUntil) waitUntil(work); else await work;
    await noteUse(env, a.org, role === "ai" ? "ai" : "host", keyId, req, now);
    const hh = new Headers({ ...CORS, ...LINK_HEADERS }); const asJson = url.searchParams.get("format") === "json";
    hh.set("content-type", asJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
    const base = `${origin}/ai/${key}`, put = (t: string, j?: unknown) => new Response(req.method === "HEAD" ? null : asJson ? JSON.stringify(j ?? { text: t }) : t, { headers: hh });
    if (rest === "start") return put(frontDoorText(origin, key, role));
    if (role !== "ai") return linkText("This is for the organizer's AI link. A Host's AI link reads the game and messages guests (see the instructions at the main address).", 403);
    if (rest === "map") return put(mapText(base, origin), mapJson(base, origin));
    if (rest === "facts") return put(factsText(`${origin}/trust.html`), { facts: (await import("./ai-facts")).FACTS });
    const apiAs = async (method: string, path: string, body?: unknown) => {
      const gh = new Headers({ "content-type": "application/json", "x-organizer": key, "x-cb-link": "1" });
      for (const k of ["cf-connecting-ip", "user-agent", "cf-ipcountry", "cf-ray", "x-request-id", "x-ai-model", "x-ai-version", "x-ai-session", "x-ai-machine"]) { const v = req.headers.get(k); if (v) gh.set(k, v); }
      const rr = await handle0(new Request(`${url.origin}/api/${path}`, { method, headers: gh, body: body === undefined ? undefined : JSON.stringify(body) }), env, now, waitUntil);
      let jj: any = null; try { jj = await rr.json(); } catch { /* an empty answer */ }
      if (rr.status >= 400 && jj && typeof jj.error === "string" && !jj.next) jj.next = nextHint(rr.status, jj.error, base, origin, path);
      return { status: rr.status, json: jj };
    };
    const screen = await goScreen({ base, origin, now, api: apiAs }, rest === "go" ? "" : rest.slice(3), url.searchParams);
    return put(screenText(screen), screenJson(screen));
  }
  // the API call: same route, key in x-organizer
  let method = req.method === "HEAD" ? "GET" : req.method, payload: string | null = null;
  const q = new URLSearchParams(url.search);
  const asked = q.get("_method"), asBody = q.get("_body");
  q.delete("_method"); q.delete("_body");
  if (req.method === "GET" && asked !== null) {
    const mm = asked.toUpperCase();
    if (mm !== "POST" && mm !== "PATCH") return linkText("_method must be POST or PATCH.", 400);
    if (asBody !== null && asBody.length > GET_BODY_MAX) return linkText(`_body is too long (at most ${GET_BODY_MAX} characters). Send less per call: about 20 people for a roster.`, 413);
    if (asBody !== null) { try { JSON.parse(asBody); } catch { return linkText("_body is not valid JSON after decoding. Write the JSON compactly and URL-encode it (encodeURIComponent), for example _body=%7B%22cap%22%3A120%7D .", 400); } }
    method = mm; payload = asBody ?? "{}";
  } else if (req.method !== "GET" && req.method !== "HEAD") payload = await req.text();
  const h = new Headers({ "content-type": "application/json", "x-organizer": key, "x-cb-link": "1" });
  for (const k of ["cf-connecting-ip", "user-agent", "cf-ipcountry", "cf-ray", "x-request-id", "x-cb-tz", "x-cb-client-ms", "x-ai-model", "x-ai-version", "x-ai-session", "x-ai-machine"]) { const v = req.headers.get(k); if (v) h.set(k, v); }
  { const asn = (req as any).cf?.asn; if (asn) h.set("x-cb-asn", String(asn)); } // the real network number the Worker saw, passed on to the audit log
  const qs = q.toString();
  const inner = new Request(`${url.origin}/api/${rest}${qs ? "?" + qs : ""}`, { method, headers: h, body: payload });
  const r = await handle0(inner, env, now, waitUntil);
  const out = new Headers(r.headers);
  for (const [k, v] of Object.entries(LINK_HEADERS)) out.set(k, v);
  if (role === "ai" && r.status >= 400 && (r.headers.get("content-type") || "").includes("json")) { // a refusal also says what to do next, so the AI does not retry blindly
    const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* not JSON */ }
    if (j && typeof j.error === "string" && !j.next) { j.next = nextHint(r.status, j.error, `${origin}/ai/${key}`, origin, rest); out.delete("content-length"); return new Response(req.method === "HEAD" ? null : JSON.stringify(j), { status: r.status, headers: out }); }
    return new Response(req.method === "HEAD" ? null : t, { status: r.status, headers: out });
  }
  return new Response(req.method === "HEAD" ? null : r.body, { status: r.status, headers: out });
}
/** A fresh Host key (the personal link, or the key for one device of a Host). */
const newHostKey = (): string => "cbh_" + randHex(24);
/** The WhatsApp button for a Host who has only a mobile number: opens WhatsApp to that number with the one-time link ready to send (the Organizer presses send). */
const waLinkFor = (digits: string, name: string, link: string): string => `https://wa.me/${phoneDigits(digits)}?text=${encodeURIComponent(`${name ? "Hello " + name + ", you" : "You"} are a Host of a Corporate Tic Tac Toe game. Open your link to finish your setup (it works once, for 7 days): ${link}`)}`;
/** A brand-new organizer account for a work e-mail (used by the first-time start and by Google sign-up): the console key, the lasting AI key (shown only in the console), and the 24-hour AI-link mail. */
/* AI_LINK_MAIL_AT_SIGNUP="0" (a Pages variable, set on the live site): the AI work link is not offered in the organizer console, so the welcome e-mail that carried it is not sent either. A new organizer then gets only the sign-in e-mail (the 6-digit code as option 1, the sign-in link as option 2). Any other value sends it as before. */
async function createOrganizer(env: Env, req: Request, email: string, now: number, via: "start" | "signin-google" | "host-to-organizer", ticked = false): Promise<{ ok: true; token: string; aiKey: string; aiMessage: string } | { error: string; status: number }> {
  const eh = await sha("email|" + email);
    const ipk = `start/${day(now)}/${(await sha("ip|" + (req.headers.get("cf-connecting-ip") ?? "local"))).slice(0, 16)}`;
    const used = Number((await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(ipk).first<{ v: string }>())?.v ?? 0);
    if (used >= STARTS_PER_DAY) return { error: "Too many new games from this network today. Please try again tomorrow.", status: 429 };
    if (!(await spend(env, now, 6))) return { error: "busy", status: 503 };
    const org = randHex(8), token = "cbk_" + randHex(24), aiKey = "cba_" + randHex(24), test = await testFlag(env); // an account made in TEST mode is flagged is_test
    await env.DB.batch([
      env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test) VALUES(?,?,?,0,?,?)").bind(await sha("key|" + token), org, "master", now, test),
      env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test) VALUES(?,?,?,0,?,?)").bind(await sha("key|" + aiKey), org, "ai", now, test),
      env.DB.prepare("INSERT INTO organizer_email(email_hash,org,is_test) VALUES(?,?,?)").bind(eh, org, test),
      env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`orgmail/${org}`, await sealText(env as any, email)),
      env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`aikey/${org}`, await sealText(env as any, aiKey)), // so the signed-in organizer can read their lasting link again (never mailed)
      env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?").bind(ipk, String(used + 1), String(used + 1)),
    ]);
    if (ticked) await recordConsent(env.DB, { subject: org, kind: "K2", ref: org, now }); // K2: the Terms box was ticked to make this account
    await recordTerms(env, org, now, via);
    await linkVisitor(env as VisitEnv, req, org, "start", now, email); // ties the visitor's earlier visits to this new organizer (no-op when nothing was tracked)
    const origin0 = (env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin, startMsg = aiMessage(origin0, aiKey); // aiKey is the lasting key, shown only in the console
    if ((env as any).AI_LINK_MAIL_AT_SIGNUP !== "0" && !TEST_LOGINS.has(email)) await mailTempLink(env, req, org, "ai", "start", now, email); // the dedicated mail carries a separate key that expires in 24 hours
    return { ok: true, token, aiKey, aiMessage: startMsg };
}
async function handle0(req: Request, env: Env, now: number, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (waitUntil && !lazyBusy && now - lazyCheckedAt >= 60_000 && /^\/api\//.test(new URL(req.url).pathname) && new URL(req.url).pathname !== "/api/lifecycle/tick") { lazyCheckedAt = now; try { waitUntil(lazyTick(env, now)); } catch { /* never blocks or breaks a request */ } } // the lazy tick: at most one look a minute per instance
  if (waitUntil && now - lastNudge > 60_000 && (req.headers.has("x-organizer") || /\/over$/.test(new URL(req.url).pathname))) { lastNudge = now; waitUntil(lifecycleTick(env as any, now).then(() => undefined, () => undefined)); }
  if ((req.method === "POST" && new URL(req.url).pathname === "/api/z") || new URL(req.url).pathname === "/api/history") { const h = housekeeping(env, now); if (waitUntil) waitUntil(h); else await h; }
  const r = await route(req, env, now);
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(r.body, { status: r.status, headers: h });
}

function d1kv(env: Env): KV { return {
  get: async (k) => (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first<{ v: string }>())?.v ?? null,
  put: async (k, v) => { await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, v).run(); },
}; }

interface Auth { plat: boolean; org: string | null; kind: "platform" | "master" | "ai" | "host" | "cohost" | null; viaLink?: boolean; eid?: string | null; /** A Host: the identity the key belongs to and whether the first-open setup (confirmed e-mail + mobile) is finished. */ hid?: string; hostReady?: boolean ; temp?: boolean }
async function authOf(req: Request, env: Env, now: number): Promise<Auth> {
  return authOfKey(env, req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""), now);
}
async function authOfKey(env: Env, presented: string, now: number): Promise<Auth> {
  if (!presented) return { plat: false, org: null, kind: null };
  if (env.ORGANIZER_SECRET && presented === env.ORGANIZER_SECRET) return { plat: true, org: null, kind: "platform" };
  const kh = await sha("key|" + presented);
  const row = await env.DB.prepare("SELECT org, kind, eid, host_id, expires_ms FROM organizer_key WHERE hash=? AND revoked=0 AND (expires_ms IS NULL OR expires_ms>?)").bind(kh, now).first<{ org: string; kind: "master" | "ai" | "host" | "cohost"; eid: string | null; host_id: string | null; expires_ms: number | null }>();
  if (!row) return { plat: false, org: null, kind: null };
  if (row.kind === "host") { // a Host's first-open link works once and for 7 days; the console works only after setup (hostsetup.ts)
    const hs = await hostKeyStatus(env.DB, kh, row.host_id, now);
    if (!hs.usable) return { plat: false, org: null, kind: null };
    // the 24-hour Host AI-link key (cth_, mailed to the Organizer for an outside AI chat) has an expiry and no first-open record: it must never be able to finish a Host setup and turn itself into a lasting key
    const temp = row.expires_ms != null && !row.host_id && !(await hostStateRow(env.DB, kh));
    return { plat: false, org: row.org, kind: "host", eid: row.eid ?? null, hid: hs.hid, hostReady: hs.ready, ...(temp ? { temp: true } : {}) };
  }
  return { plat: false, org: row.org, kind: row.kind, eid: row.eid ?? null };
}
/** May this caller act on this engagement? `master` = needs the organizer's own key, or a Host's (both are people, never the AI), or ours. A Co-host never passes: their rights are a few named routes only. */
const can = (a: Auth, e: { org: string | null }, master = false) => a.plat || (!!a.org && e.org === a.org && a.kind !== "cohost" && (!master || a.kind === "master" || (a.kind === "host" && !a.viaLink)));
/** The organizer's own key, a Host's, their AI's key, or ours. */
const canAi = (a: Auth, e: { org: string | null }) => a.plat || (!!a.org && e.org === a.org && (a.kind === "master" || a.kind === "ai" || (a.kind === "host" && !a.viaLink)));
/** May this caller pay for this game (so credit is shown to them)? The Organizer, a Host or a Co-host of that game; never an AI key or a work link. */
const mayPay = (a: Auth, e: { id: string; org: string | null }) => !!a.org && e.org === a.org && !a.viaLink && (a.kind === "master" || a.kind === "host" || (a.kind === "cohost" && (!a.eid || a.eid === e.id)));
/** The credit fields a caller who may pay sees: their account's active credit (a number), when it next lapses, and how much of it is already applied to THIS game. Everyone else: null. */
async function creditFields(env: Env, a: Auth, e: { id: string; org: string | null }, open: boolean, now: number) {
  if (!open || !mayPay(a, e)) return { credit: null, creditExpiresMs: null, creditApplied: null };
  const c = await activeCreditSummary(env.DB, e.org!, now);
  return { credit: c.activeTotalInr, creditExpiresMs: c.nextExpiryMs, creditApplied: await creditAppliedFor(env.DB, e.id) };
}
const deny = (a: Auth) => json({ error: a.kind === "ai" ? "Your AI assistant may not do this. It is for the organizer to do themselves in their console: tell them plainly what needs doing and where (your instructions say how)." : a.kind === "host" ? "Only the Organizer can do this. A Host looks after the game, not the account." : a.kind === "cohost" ? "A Co-host can invite people and pay. Ask the Organizer or a Host for anything else." : "Not allowed." }, 403);
/** What a Host may touch through an AI work link (x-cb-link): watching, and messages to everyone. Through the console a Host may do everything inside a game. */
const HOST_ACTIONS = new Set(["participants", "summary", "results", "info", "announce", "prizes", "prizegiven", "override", "reportlink", "life"]);
const MAX_HOSTS = 5;
/** A payment the gateway has not confirmed yet shows as "Confirming your payment..." for this long; after that it is simply pending again. */
const CONFIRMING_WINDOW_MS = 30 * 60_000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const cleanLabel = (v: unknown): string => (typeof v === "string" ? v.replace(/[<>`]/g, "").trim().slice(0, 40) : "");
/** Paid or pending, and (for a game paid after roles existed) who paid and when. */
async function paymentOf(env: Env, e: { id: string }, unpaid: boolean, now: number): Promise<{ status: "paid" | "pending" | "confirming"; paidBy?: string; paidMs?: number; paidVia?: string }> {
  if (unpaid) { // "Confirming your payment...": the buyer finished paying but the gateway has not confirmed it yet (never shown as Paid before that)
    try { if (await env.DB.prepare("SELECT 1 AS x FROM payment WHERE eid=? AND status<>'paid' AND confirming_ms IS NOT NULL AND confirming_ms>?").bind(e.id, now - CONFIRMING_WINDOW_MS).first()) return { status: "confirming" }; } catch { /* no payment record: pending */ }
    return { status: "pending" };
  }
  try { const r = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`paidby/${e.id}`).first<{ v: string }>(); const j = r ? JSON.parse(r.v) : null; if (j?.by) return { status: "paid", paidBy: j.by, paidMs: j.ms, ...(j.via ? { paidVia: j.via } : {}) }; } catch { /* no record: paid before roles existed */ }
  return { status: "paid" };
}
/** A Co-host's invite link carries `from` = COHOST_FROM + the first 7 hex of their key id (28 bits), so the old join page needs no change; people who join through it are tagged `co:<7 hex>` in `seat.src`. */
const broughtBy = async (env: Env, org: string, hex7: string | null): Promise<number> =>
  (await env.DB.prepare(hex7 ? "SELECT COUNT(*) AS c FROM seat s JOIN engagement e ON e.id=s.eid WHERE e.org=? AND s.src=?" : "SELECT COUNT(*) AS c FROM seat s JOIN engagement e ON e.id=s.eid WHERE e.org=? AND s.src LIKE 'co:%'").bind(...(hex7 ? [org, "co:" + hex7] : [org])).first<{ c: number }>())?.c ?? 0;

export const AI_MANIFEST = {
  name: "Corporate Tic Tac Toe organizer API",
  how: "Send your organizer AI key in the x-organizer header (or Authorization: Bearer). Easier for chat AIs: the same key in the address, https://<site>/ai/<key>, returns the full manual with ready-made addresses, and https://<site>/ai/<key>/z/{id}/summary works like /api/z/{id}/summary (GET-only tools add _method=POST|PATCH&_body=<URL-encoded JSON>). Every call is JSON. Who plays first, the bracket and every tie-break come from one sealed random seed and are worked out on the players' phones; you cannot change them. Every call you make is recorded (time, which key, what was asked, and where it came from) in an audit trail the organizer can read.",
  your_role: "You are the organizer's event planner. Talk with them in plain, friendly words, never in API terms. Work through the steps in `conversation` IN ORDER, ONE question at a time, offering 2 to 4 clear options with a recommended default, and wait for their answer before moving on. Never invent details for them. They can watch everything you create appear live in their console (the openUrl returned when you create the game).",
  conversation: CONVERSATION.map((t) => t.replace(/\{api\}/g, "/api")),
  packs: PACKS.map(([n]) => ({ upTo: n, inr: price(n, "INR").total, usd: price(n, "USD").total })),
  choices: { call_seconds: "9 (the platform stores it and this game does not use it; 6, 9, 12 and 15 are accepted)", rewards: PRIZE_HOUSES.map((h) => h.id), winners_per_reward: "1 for every place (the ranking has no ties): " + PRIZE_HOUSES.map((h) => h.id + " " + h.max).join(", "), who_can_join: ["list", "anyone"], brand_colors: BRAND_COLORS, set_by_the_organizer_or_host_on_the_tournament_page: { format: ["solo (one against one)", "team (teams of 3 or 5)"], move_clock_seconds: [10, 20, 30, 60] } },
  you_can: [
    { do: "Turn the organizer's chosen date and time into the startRound the game needs, and check it is in the future", call: "GET /api/z/schedule?at=2026-10-03T16:00:00+05:30 -> {startRound, startMs, startsInMinutes, startsAtIST}" },
    { do: "Read back everything saved for one game (start time in the organizer's time, limit, every reward, the invitation policy, head-count, and whether it is a draft, published or paid). Use it to confirm the details with the organizer after every change", call: "GET /api/z/{id}/summary" },
    { do: "List games and head-counts", call: "GET /api/history" },
    { do: "Create a game. It is saved as a free draft that players cannot see yet; nothing is paid at this step", call: "POST /api/z {id (4-40 letters, digits, - or _), startRound, callSeconds: 9, cap, closed?, name?}  -> {ok, draft, openUrl}" },
    { do: "When everything is set up, tell the organizer it is ready. Publishing is free but only the organizer can do it (they confirm their email and mobile number), and the game does not begin until it is paid for (pay at any time until the guest data is erased; a late payment starts the game 2 minutes after it is confirmed). This returns a link: give it to the organizer and help them through every step, but never try to publish or pay yourself", call: "POST /api/z/{id}/publish -> {published:false, needsOrganizer:true, consoleUrl} (the organizer opens consoleUrl, confirms their details and presses Publish; afterwards the same call returns payUrl, the payment page, and shareUrl, the link for guests)" },
    { do: "Change start time, the limit of players (cap), invite-only, the time zone, the name of the game, the company brand and the rewards for the top places before the tournament starts. (The format, one against one or teams, and the move clock are chosen by the Organizer or a Host on the tournament page when they press Start; they are not set here.)", call: "PATCH /api/z/{id}/settings {startRound?, cap?, closed?: true|false (invite-only), tz?: an IANA time zone such as Asia/Kolkata, name?, brand?: {name (1-40 characters), color (one of choices.brand_colors), logo? (a small picture as a data URL)}, rewards?: [{pattern: <a place id from choices.rewards>, ordinal?: 1, text}], invites?: {on: true|false, per?: 1-10, cats?: [kinds of guest]}}. IMPORTANT: rewards REPLACE what was saved, they are not merged, so always send the complete list (to change one reward, read the summary, change it, send them all). A reward line is ONE winner of ONE place and every place has exactly one winner, so ordinal is always 1. Places and how each is won are in the manual. Worked example: PATCH /api/z/{id}/settings {startRound: 33146812, cap: 250, closed: true, brand: {name: Acme Ltd, color: #0B3D91}, rewards: [{pattern: first, ordinal: 1, text: Gift hamper}, {pattern: second, ordinal: 1, text: Coffee voucher}, {pattern: third, ordinal: 1, text: Book token}]}" },
    { do: "Participants: the OWNER loads the invite list in the Participants card of their console. Names and mobile numbers never pass through the AI (a roster call from an AI key answers 403). Set the limit with settings.", call: "(owner, in the console)" },
    { do: "Reuse an earlier game's people", call: "POST /api/z/{id}/reuse {from}" },
    { do: "See who joined (names and ids only, never phone numbers)", call: "GET /api/z/{id}/participants" },
    { do: "See how the tournament is going, the way everybody sees it (no key needed): whether it has started, how many players, the format, the move clock, the rounds, the champion and the final places once it is finished", call: "GET /api/z/{id}/ttt/view -> {state: open|starting|running|done, joined, paused, format, teamSize, moveSecs, players, rounds, champion, ranking}" },
    { do: "See the winners of the top places, by seat number, once the tournament has finished", call: "GET /api/z/{id}/results" },
    { do: "Ask the organizer to pause, resume or stop (they approve in their console)", call: "POST /api/z/{id}/control/request {action: pause|resume|stop, note}" },
    { do: "Ask for ALL participant names and mobile numbers of this game to be deleted (nothing is deleted until the organizer confirms in their console)", call: "POST /api/z/{id}/control/request {action: 'erase', note}" },
    { do: "Read the current pause status", call: "GET /api/z/{id}/control" },
    { do: "Send a message to every guest's phone and the big screen (160 characters; empty text clears it; once published)", call: "POST /api/z/{id}/announce {text}" },
    { do: "See the winners to hand rewards to, by seat number (names and numbers stay in the console), and tick a reward as given", call: "GET /api/z/{id}/prizes ; POST /api/z/{id}/prizegiven {round: 1, pattern: <first|second|third|fourth|fifth>, ordinal: 1, seat, given}" },
    { do: "Change of phone: let one person move their place to a new phone", call: "POST /api/z/{id}/unbind {seat} (the seat number; the console takes a mobile number, an AI never does)" },
    { do: "Flag a seat as Organizer, Host or Co-host", call: "POST /api/z/{id}/mark {seat, role: organizer|host|co-host|none} (the seat number; an AI never names a mobile number)" },
    { do: "Invitations: settle how many people each guest may invite and which kinds of guests, before the start", call: "PATCH /api/z/{id}/settings {invites: {on, per: 1-10, cats}}" },
    { do: "Create a Host key (up to 5 Hosts; through an AI link a Host may only watch, announce and tick prizes given)", call: "POST /api/org/host {label, email?, mobile?} (at least one of email or mobile) -> {hostKey, manualUrl, id, label}. The AI cannot call it (403). A Host must have an e-mail address or a mobile number (the owner gives it); their own one-time console link (7 days) is e-mailed to the Host, or sent by the owner on WhatsApp" },
    { do: "Co-hosts (unlimited; a Co-host has a name and a mobile number, no e-mail, belongs to one game, only invites people with an own link and pays) are added by the Organizer or a Host in the console, never through an AI link", call: "The people on the team: GET /api/org/team (or GET /api/org/team?e={game id}); remove one: POST /api/org/team/retire {id}" },
    { do: "Read the audit trail of AI calls, when the game ends, and whether the report is ready (the report address itself goes only to the organizer)", call: "GET /api/org/ai/audit ; GET /api/z/{id}/life ; GET /api/z/{id}/reportlink" },
    { do: "Suggest a feature, improvement or report we should build (shared with every organizer's AI, reviewed by us)", call: "POST /api/z/suggestions {kind: feature|improvement|report|bug|other, title, body}" },
    { do: "See everyone's suggestions and what we decided, and add your support to one", call: "GET /api/z/suggestions ; POST /api/z/suggestions/{id}/vote" },
  ],
  payment_faq: [
    "Building and publishing are free. Only the organizer publishes (they confirm their email and mobile number), and only the organizer pays; you never do either.",
    "Price is per game, by size: the smallest pack that covers the limit (see `packs`, the price in rupees is the whole amount: no GST is added). The limit does not have to match a pack size; people beyond the limit cannot join.",
    "The organizer pays on the payment page, online through Razorpay (the page shows the methods available). It takes about 2 minutes, and an invoice is emailed. The payment page names the seller, IT Services by Rajat Agarwal. Credit from an earlier cancelled game can pay for it (the Pay step offers it first).",
    "No payment, no game. There is no separate payment cut-off: the game can be paid at any time until the guests' data is erased (" + PURGE_HOURS + " hours after the game was meant to end). Until it is paid the Organizer and Hosts see \"Payment pending for this game\" and everyone else sees \"Waiting for the Organizer or Host to start the game.\" Nothing is charged and there is no penalty.",
    "If the organizer pays late, even hours later, the game opens 2 minutes after the payment is confirmed, for everyone already waiting, and they can also choose a new start time first (at most 30 days ahead). After the guest data is erased the game is closed (\"This game did not start. Your details have been erased.\"): nobody can join or pay, and the Organizer can create a new game like it.",
    "If they never pay, nothing is owed. They can create a new game whenever they like. The settings of a game that did not start stay for 30 days, then they are forgotten (as unpublished drafts are).",
    "We do not give refunds. If you cancel a paid game before it starts, your payment stays as credit for your next game for 365 days. Unused credit lapses at the end of day 365. The credit stays in the organizer's account. Unused places are not credited once the game has started. Rules and privacy are at /legal.html.",
  ],
  suggestions_rules: "Describe the need and the benefit, not code. Never include names, phone numbers, e-mail addresses or anything about specific people. Suggestions are visible to all organizers' AI assistants without saying who wrote them. We review them and mark each one new, under_review, planned, shipped or declined.",
  you_cannot: [
    "Pay. Payment is always the organizer's own act on the payment page (payUrl in the summary).",
    "Publish: the organizer confirms their own e-mail and mobile number and presses Publish. You prepare everything and hand over consoleUrl.",
    "Choose, change or remove the draw (who plays whom, who plays X first), a result, a place in the ranking or anyone's reward (nobody can, not even the organizer: the software decides, and a result stands only when the players' phones agree)",
    "Start the tournament, pause or resume it, or settle a board: the Organizer or a Host does these on the tournament page",
    "Erase participant data (you may ASK; the organizer confirms)",
    "Pause, resume or stop a running game (you may ASK; only the organizer's own browser holds that signing key)",
    "Create or retire the organizer's own sign-in keys, change their e-mail or delete the account, or sign in with Google",
    "Make a pay link that anyone can open (POST /api/z/{id}/paylink answers 403 to an AI key: only the Organizer, a Host or a Co-host makes one)",
    "Write or run code on the platform",
  ],
};

/** Every call made with an organizer's AI key is written to an audit trail (when, which key, what was asked, the answer, and where it came from). */
async function route(req: Request, env: Env, now: number): Promise<Response> {
  const a = await authOf(req, env, now);
  if (a.kind === "host" && req.headers.get("x-cb-link") === "1") a.viaLink = true; // a Host's AI work link keeps the narrow rights
  if (a.viaLink && /^\/api\/(payments\/|org\/(team|cohost))/.test(new URL(req.url).pathname)) return json({ error: "A Host's AI assistant cannot pay or manage the team. The Host does this in their own console.", code: "ai-not-allowed" }, 403); // paying and who is on the team are for people
  const peek = req.method === "GET" || req.method === "HEAD" ? null : req.clone(); // the internal audit log reads the body from this copy; the route reads the original
  const r = await route0(req, env, now, a);
  let kidForLog: string | null = null;
  if (a.org && (a.kind === "ai" || (a.kind === "host" && req.headers.get("x-cb-link") === "1"))) { // a co-host's calls are recorded too, when they come through a work link
    const presented = req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const kid = (await sha("key|" + presented)).slice(0, 10);
    kidForLog = kid;
    await auditAi(env.DB, a.org, req, kid, r.status, now);
    if (r.status !== 403) await noteUse(env, a.org, a.kind === "ai" ? "ai" : "host", kid, req, now);
  } else if (a.org && a.kind) kidForLog = (await sha("key|" + (req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")))).slice(0, 10);
  await auditRequest(env as AuditEnv, req, peek, a, r.status, now, kidForLog);
  return r;
}
async function route0(req: Request, env: Env, now: number, a: Auth): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  // A Host whose first-open setup is not finished (confirmed e-mail + mobile number) can do nothing but finish it (hostsetup.ts). Public routes stay public.
  if (a.kind === "host" && !a.viaLink && a.hostReady === false && !(p === "/api/whoami" || p.startsWith("/api/host/setup") || p.startsWith("/api/auth/") || p.startsWith("/api/paylink/") || (p === "/api/notices" && req.method === "GET")))
    return json({ error: "Please finish your setup first: confirm your e-mail address and add your mobile number.", code: "host-setup" }, 403);

  if (req.method === "GET" && p === "/api/z/ai-manifest") return json(AI_MANIFEST);
  { const bm = req.method === "GET" ? p.match(/^\/api\/beacon\/([0-9a-f]{64})\/public\/(latest|\d{1,10})$/) : null; if (bm) return beaconRelay(req, bm[1]!, bm[2]!); }
  { const mr = await modeRoute(req, env as any, now, a.plat && req.headers.get("x-cb-link") !== "1", (n) => purgeTestData(env, n)); if (mr) return mr; } // TEST/LIVE switch, allow-list, purge (mode.ts): owner only, except the public read of the word TEST or LIVE
  { const ar = await adminRoute(req, env as any, now, a.plat && req.headers.get("x-cb-link") !== "1", (n) => spend(env, now, n)); if (ar) return ar; } // the owner's desk (admin.ts): site switch, organizer lookup, data requests, mail events, error counts; the health read; the mail webhook
  if (p === "/api/v/b") return beaconRoute(req, env as VisitEnv, now, (n) => spend(env, now, n)); // public-page visit tracking (visits.ts); never the live game
  if (p === "/api/owner/game-records") { // OWNER ONLY (platform key, never through an AI work link): the permanent settings record of every game (no personal data of any player in it). Anybody else gets the same 404 as an unknown address.
    if (!(a.plat && req.headers.get("x-cb-link") !== "1") || req.method !== "GET") { await logAccess(env.DB, now, "denied:game-records", null, null, 0, false, a.kind ?? "anonymous"); return json({ error: "Not found" }, 404); }
    const recs = await readGameRecords(env.DB, url.searchParams.get("eid"), Number(url.searchParams.get("limit") ?? 200));
    await logAccess(env.DB, now, "game-records", url.searchParams.get("eid"), "json", recs.length);
    return json({ records: recs });
  }
  if (p === "/api/pass" && req.method === "POST") { // a prospect opened a demo pass link: ONE free game of up to its size for this account. The account must be signed in; the link is used once.
    if (!(a.kind === "master" && a.org)) return deny(a);
    const pb = await body(req, 512); const r = await redeemDemoPass(env, a.org, typeof pb?.token === "string" ? pb.token : "", now);
    return r.busy ? BUSY() : json(r.body, r.status);
  }
  if (p === "/api/owner/releases") { // OWNER ONLY (platform key, never through an AI work link): the version number of this release and the release history. Anybody else gets the same 404 as an unknown address.
    if (!(a.plat && req.headers.get("x-cb-link") !== "1") || req.method !== "GET") return json({ error: "Not found" }, 404);
    return json({ current: (RELEASES as any[])[0], releases: RELEASES });
  }
  if (p === "/api/owner/ledger") { // OWNER ONLY (platform key, never through an AI work link): this website's own payment ledger (C). Anybody else gets the same 404 as an unknown address.
    if (!(a.plat && req.headers.get("x-cb-link") !== "1") || req.method !== "GET") { await logAccess(env.DB, now, "denied:ledger-c", null, null, 0, false, a.kind ?? "anonymous"); return json({ error: "Not found" }, 404); }
    const out = await ownerLedger(env as PayEnv, url, now);
    await logAccess(env.DB, now, "ledger-c", null, url.searchParams.get("format") === "csv" ? "csv" : "json", 0);
    return out;
  }
  { // OWNER ONLY (platform key, never through an AI work link): visitor-journey reports. Every read is written to the access log; anybody else gets the same 404 as an unknown address.
    const vm = p.match(/^\/api\/owner\/visits\/(summary|journey\/([A-Za-z0-9_]{32,40}))$/);
    if (vm) {
      const ownerOk = a.plat && req.headers.get("x-cb-link") !== "1", what = vm[1] === "summary" ? "visits-summary" : "visits-journey";
      if (!ownerOk || req.method !== "GET") { await logAccess(env.DB, now, "denied:" + what, null, null, 0, false, a.kind ?? "anonymous"); return json({ error: "Not found" }, 404); }
      if (what === "visits-summary") { const { from, to } = parseRange(url.searchParams, now); const out = await visitsSummary(env as VisitEnv, from, to, url.searchParams.get("mode") === "test"); await logAccess(env.DB, now, what, null, null, out.humans.sessions + out.bots.sessions); return json(out); }
      const out = await visitsJourney(env as VisitEnv, vm[2]!);
      await logAccess(env.DB, now, what, null, null, out?.visits ?? 0, !!out);
      return out ? json(out) : json({ error: "Not found" }, 404);
    }
  }
  { const rm = p.match(/^\/api\/report\/([A-Za-z0-9_-]{4,40})$/); if (rm && req.method === "GET") return reportApi(env as any, rm[1]!, url, now); } // the report page; the key in the link is the only credential
  if (a.kind === "cohost" && req.method === "POST" && (p === "/api/checkout" || /^\/api\/z\/[A-Za-z0-9_-]{4,40}\/pay-with-credit$/.test(p) || p === "/api/proforma" || p === "/api/payments/test" || p === "/api/payments/paytest" || p === "/api/org/credit" || p.startsWith("/api/org/credit/")) && !(await hasConsent(env.DB, "c:" + (await sha("key|" + (req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")))).slice(0, 16), "K5"))) return json({ error: "Please tick the box to continue.", code: "consent-required", kind: "K5", version: CONSENT_VERSION }, 400); // a Co-host pays and uses credit only after accepting the role (these routes run before the general K5 gate below)
  const paid = await payRoute(req, env as PayEnv, now, (n) => spend(env, now, n));
  if (paid) return paid;
  { const cr = await creditRoute(req, env as PayEnv, now, (n) => spend(env, now, n), a); if (cr) return cr; } // credit instead of refunds: the account's credit, and paying a game with it (credit.ts)
  if (a.kind === "cohost") { // K5: a Co-host promises, once per Terms version, before doing anything (a Host does it in the first-open setup)
    const presentedK = req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (presentedK) {
      const who = "c:" + (await sha("key|" + presentedK)).slice(0, 16);
      if (req.method === "POST" && p === "/api/org/role/accept") {
        const b = await body(req, 512); const mt = consentRequired(b, "K5"); if (mt) return mt;
        await recordConsent(env.DB, { subject: who, kind: "K5", ref: a.eid ?? null, now });
        return json({ ok: true });
      }
      if (!(req.method === "GET" && (p === "/api/whoami" || p === "/api/consent/text")) && !(await hasConsented(env.DB, who, "K5"))) return json({ error: "Please tick the box to continue.", code: "consent-required", kind: "K5", version: CONSENT_VERSION }, 403);
    }
  }
  if (a.kind === "cohost" && !(req.method === "GET" && (p === "/api/whoami" || p === "/api/notices" || /^\/api\/z\/[A-Za-z0-9_-]{4,40}\/cohost$/.test(p))) && !/^\/api\/z\/[A-Za-z0-9_-]{4,40}\/(people|waiting)(\/|$)/.test(p) && !(req.method === "POST" && /^\/api\/z\/[A-Za-z0-9_-]{4,40}\/paylink$/.test(p))) return deny(a); // a Co-host: the header, the invite link, payment (above) and nothing else
  const partnered = await partnerRoute(req, env as PayEnv, now, (n) => spend(env, now, n), a.plat);
  if (partnered) return partnered;
  { // Help Desk (helpdesk.ts): a partner prepares games for an Organizer, who publishes with one tap. `summary` reads a game exactly as the AI's summary route does (no phone numbers).
    const hd = await helpdeskRoute(req, env as PayEnv, now, (n) => spend(env, now, n), { summary: async (org, eid) => { try { const sr = await route0(new Request(new URL(req.url).origin + "/api/z/" + eid + "/summary"), env, now, { plat: false, org, kind: "ai" }); return sr.status === 200 ? await sr.json() : null; } catch { return null; } } }, { kind: a.kind, org: a.org });
    if (hd) return hd;
  }

  /* ---- sign in with an e-mailed code (no passwords): also how an organizer who lost their key gets a fresh one ---- */
  /* ---- start: a new organizer enters a work email and the console opens at once (no mail is sent). An email that already has an account is
     asked for the e-mailed code instead, so nobody can open someone else's console by typing their address. ---- */
  if (req.method === "GET" && p === "/api/z/schedule") { // a helper for the organizer's AI: a date and time becomes a start round
    const at = Date.parse(url.searchParams.get("at") ?? "");
    if (!Number.isFinite(at)) return json({ error: "Give a date and time with a time zone, like at=2026-10-03T16:00:00+05:30." }, 400);
    if (at > now + MAX_AHEAD_MS) return json({ ok: false, error: TOO_FAR, code: "too-far", maxStartMs: now + MAX_AHEAD_MS }, 400);
    const startRound = roundOfMs(at);
    return json({ ok: at > now, startRound, startMs: roundMs(startRound), startsInMinutes: Math.round((roundMs(startRound) - now) / 60_000), startsAtIST: istTime(roundMs(startRound), isTimeZone(url.searchParams.get("tz")) ? url.searchParams.get("tz")! : undefined), ...(at > now ? {} : { error: "That time has already passed. Pick a time in the future." }) }, at > now ? 200 : 400);
  }
  if (req.method === "POST" && p === "/api/start") {
    const b = await body(req);
    const email = typeof b?.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email)) return json({ error: "Please enter a valid e-mail address." }, 400);
    const eh = await sha("email|" + email);
    if (await env.DB.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(eh).first()) { await holdPassForSignIn(env, eh, b?.pass, now); return json({ ok: true, exists: true }); }
    if (await hostForEmail(env.DB, eh)) { await holdPassForSignIn(env, eh, b?.pass, now); return json({ ok: true, exists: true }); } // a Host who confirmed this address signs in with a code, like an Organizer: the sign-in door must not offer them a new Organizer account
    { const cm = consentMissing(b, "K2"); if (cm) return cm; } // K2: a new account needs the Terms box ticked (checked on the server, not only on the page)
    const made = await createOrganizer(env, req, email, now, "start", true);
    if ("error" in made) return made.status === 503 ? BUSY() : json({ error: made.error }, made.status);
    { const pt = passShape(b?.pass); if (pt) { const acct = await env.DB.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(eh).first<{ org: string }>(); if (acct) { try { await redeemDemoPass(env, acct.org, pt, now); } catch { /* only a gift */ } } } } // a new person who came through a demo link has it at once
    return json({ ok: true, token: made.token, aiKey: made.aiKey, aiMessage: made.aiMessage });
  }
  if (req.method === "POST" && p === "/api/auth/email") {
    const b = await body(req);
    const email = typeof b?.email === "string" ? b.email.trim().toLowerCase() : "";
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email)) return json({ error: "Please enter a valid e-mail address." }, 400);
    const eh = await sha("email|" + email);
    const acct = await env.DB.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(eh).first<{ org: string }>();
    // K2: an account that already accepted the CURRENT Terms signs in with no box; anyone else (a Host, a new Terms version) must tick it, and that tick is recorded
    const ticked = consentRequired(b, "K2") === null;
    if (!(acct && (await hasConsented(env.DB, acct.org, "K2")))) { const mt = consentRequired(b, "K2"); if (mt) return mt; }
    const hostAcct = await hostForEmail(env.DB, eh); // a Host who confirmed this address signs in the same way; a person who is both gets both roles
    if (acct && ticked) await recordConsent(env.DB, { subject: acct.org, kind: "K2", ref: "signin", now });
    const test = (env as PayEnv).TEST_MODE === "1";
    let devCode: string | undefined, devToken: string | undefined;
    if (acct || hostAcct) await holdPassForSignIn(env, eh, b?.pass, now);
    if (TEST_LOGINS.has(email) && (await isTestMode(env))) return json({ ok: true }); // the owner's test addresses (TEST mode only, TT-21; in LIVE they are ordinary addresses and get no code): nothing is sent, the code is always the same
    if (acct || hostAcct) { // an unknown address gets the same answer, so nobody can find out who has an account
      const row = await env.DB.prepare("SELECT win_start, sent FROM login_code WHERE email_hash=?").bind(eh).first<{ win_start: number; sent: number }>();
      const fresh = !row || now - row.win_start > 3_600_000;
      if (!fresh && row!.sent >= 5) return json({ error: "Too many codes requested. Please try again in an hour." }, 429);
      if (!(await spend(env, now, 2))) return BUSY();
      const linkToken = randHex(24), code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000));
      await env.DB.prepare("INSERT INTO login_code(email_hash,code_hash,expires_ms,attempts,win_start,sent,link_hash) VALUES(?,?,?,0,?,1,?) ON CONFLICT(email_hash) DO UPDATE SET code_hash=excluded.code_hash, expires_ms=excluded.expires_ms, attempts=0, win_start=?, sent=?, link_hash=excluded.link_hash").bind(eh, await sha("code|" + eh + "|" + code), now + 600_000, fresh ? now : row!.win_start, await sha("link|" + linkToken), fresh ? now : row!.win_start, fresh ? 1 : row!.sent + 1).run();
      const sm = signInMail((env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin, code, linkToken); // Organizer or Host: the same two ways in, a 6-digit code or one single-use link (10 minutes)
      await sendMail(env as PayEnv, env.DB, email, sm.subject, sm.text, now, { html: sm.html, secret: true });
      if (test) { devCode = code; devToken = linkToken; }
    }
    return json({ ok: true, ...(devCode ? { devCode, devToken } : {}) });
  }
  if (req.method === "GET" && p === "/api/consent/text") { // the exact wording of the consent boxes, for the pages (consent.ts); the server checks the same list
    const k = url.searchParams.get("kind") as Kind | null;
    return json(k && KINDS.includes(k) ? textFor(k) : { version: CONSENT_VERSION, kinds: Object.fromEntries(KINDS.map((x) => [x, textFor(x).boxes])) });
  }
  if (req.method === "GET" && p === "/api/auth/config") return json({ google: googleClientId(env) }); // the public Google client id, or null: the pages show "Continue with Google" only when it is there
  if (req.method === "POST" && p === "/api/auth/google") { // "Continue with Google": proves the e-mail with Google, then does exactly what the e-mail code does (google.ts, hostsetup.ts)
    if (!googleClientId(env)) return json({ error: "Not found" }, 404);
    const b = await body(req, 8192);
    const intent = b?.intent;
    if (intent !== "signup" && intent !== "signin" && intent !== "host") return json({ error: "Say whether you are signing up, signing in or finishing a Host setup." }, 400);
    { const mt = consentRequired(b, intent === "host" ? "K5" : "K2"); if (mt) return mt; } // the Terms box (K2), or the Host's promise (K5)
    const fk = `linkfail/${day(now)}/${(await sha("ip|" + (req.headers.get("cf-connecting-ip") ?? "local"))).slice(0, 16)}`; // the same per-network failure allowance as the sign-in link
    const fails = Number((await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(fk).first<{ v: string }>())?.v ?? 0);
    if (fails >= 20) return json({ error: "Too many tries from this network. Please use an e-mail code, or try again tomorrow." }, 429);
    const bad = async (msg: string, code?: string) => { await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?").bind(fk, String(fails + 1), String(fails + 1)).run(); return json({ error: msg, ...(code ? { code } : {}) }, 400); };
    const g = await verifyGoogleCredential(env, b.credential, now);
    if (!g.ok) return bad("That Google sign-in could not be checked. Please try again, or use an e-mail code.", "google-failed");
    const email = g.email, eh = await sha("email|" + email);
    await recordConsent(env.DB, { subject: eh.slice(0, 16), kind: intent === "host" ? "K5" : "K2", ref: "google", now });
    if (intent === "host") { // a Host finishing the first open: Google confirms the e-mail the Organizer added them with
      const hk = typeof b.hostKey === "string" ? b.hostKey : "";
      const ha = hk ? await authOfKey(env, hk, now) : null;
      const kh = hk ? await sha("key|" + hk) : "";
      const ident = ha && ha.kind === "host" && ha.hid === kh ? await env.DB.prepare("SELECT expires_ms FROM organizer_key WHERE hash=?").bind(kh).first<{ expires_ms: number | null }>() : null;
      if (!ha || !ident || ident.expires_ms !== null || !ha.org) return bad("This link has been used or has expired. Ask the Organizer for a new one, or sign in with your e-mail.", "host-link-gone");
      const row = await identityRow(env.DB, ha.hid!), onFile = row?.email_sealed ? await openText(env as any, row.email_sealed) : null;
      if (onFile && onFile.toLowerCase() !== email) return json({ error: `This link is for ${maskEmail(onFile)}`, code: "email-mismatch" }, 403);
      if (!(await spend(env, now, 3))) return BUSY();
      const done = await confirmHostEmail(env, ha.hid!, ha.org, email, newHostKey(), now);
      return json({ ok: true, token: done.token, kind: "host", ready: done.ready, needMobile: done.needMobile });
    }
    const acct = await env.DB.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(eh).first<{ org: string }>();
    if (acct) { // exactly the 6-digit code's sign-in, without the code
      if (!(await spend(env, now, 2))) return BUSY();
      await recordTerms(env, acct.org, now, "signin-google");
      await linkVisitor(env as VisitEnv, req, acct.org, "signin", now, email);
      const token = "cbk_" + randHex(24);
      await env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test) VALUES(?,?,?,0,?,COALESCE((SELECT MAX(k2.is_test) FROM organizer_key k2 WHERE k2.org=?),0))").bind(await sha("key|" + token), acct.org, "master", now, acct.org).run();
      return json({ ok: true, token, created: false });
    }
    if (intent === "signup") {
      const made = await createOrganizer(env, req, email, now, "signin-google");
      if ("error" in made) return made.status === 503 ? BUSY() : json({ error: made.error }, made.status);
      return json({ ok: true, token: made.token, aiKey: made.aiKey, aiMessage: made.aiMessage, created: true });
    }
    const hostAcct = await hostForEmail(env.DB, eh);
    if (hostAcct) {
      if (!(await spend(env, now, 2))) return BUSY();
      const hs = await hostStateRow(env.DB, hostAcct.host_id);
      return json({ ok: true, token: await mintDeviceKey(env, hostAcct.host_id, newHostKey(), now), kind: "host", ready: !!hs?.verified_ms && !!hs?.mobile_ok });
    }
    return json({ error: "There is no account for this Google e-mail yet. Choose sign up to make one.", code: "no-account" }, 404);
  }
  if (req.method === "POST" && p === "/api/auth/link") { // the confirm page POSTs here; opening the link (GET, a mail scanner) consumes nothing
    const b = await body(req);
    const t = typeof b?.token === "string" && /^[0-9a-f]{48}$/.test(b.token) ? b.token : "";
    const fk = `linkfail/${day(now)}/${(await sha("ip|" + (req.headers.get("cf-connecting-ip") ?? "local"))).slice(0, 16)}`;
    const fails = Number((await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(fk).first<{ v: string }>())?.v ?? 0);
    if (fails >= 20) return json({ error: "Too many tries from this network. Please use the 6-digit code, or try again tomorrow." }, 429);
    const bad = async () => { await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?").bind(fk, String(fails + 1), String(fails + 1)).run(); return json({ error: "This sign-in link is not valid any more. Please ask for a new one from the sign-in page." }, 400); };
    if (!t) return bad();
    const lh = await sha("link|" + t);
    const row = await env.DB.prepare("SELECT email_hash, expires_ms FROM login_code WHERE link_hash=?").bind(lh).first<{ email_hash: string; expires_ms: number }>();
    if (!row || row.expires_ms < now) return bad();
    const acct = await env.DB.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(row.email_hash).first<{ org: string }>();
    const hostAcct = await hostForEmail(env.DB, row.email_hash);
    if (!acct && !hostAcct) return bad();
    if (!(await spend(env, now, 2))) return BUSY();
    const used = await env.DB.prepare("DELETE FROM login_code WHERE link_hash=? AND expires_ms>=?").bind(lh, now).run(); // single use: the first POST wins, the code dies with it
    if ((used.meta?.changes ?? 0) !== 1) return bad();
    const done = await signInResult(env, req, acct, hostAcct, now, null); if (acct) await useHeldPass(env, acct.org, row.email_hash, now); // a demo link held for this address is used now
    return json(done);
  }
  if (req.method === "POST" && p === "/api/auth/verify") {
    const b = await body(req);
    const email = typeof b?.email === "string" ? b.email.trim().toLowerCase() : "";
    const code = typeof b?.code === "string" ? b.code.replace(/\D/g, "") : "";
    if (!email || code.length !== 6) return json({ error: "Enter the 6-digit code." }, 400);
    const eh = await sha("email|" + email);
    if (TEST_LOGINS.has(email) && code === TEST_LOGIN_CODE && (await isTestMode(env))) { // TT-21: the fixed code opens an account only while the service is in TEST mode
      { // a per-network daily limit and the write budget apply, like every other public write
        const tk = `tlg/${day(now)}/${(await sha("ip|" + (req.headers.get("cf-connecting-ip") ?? "local") + "|" + email)).slice(0, 16)}`; // per network and per account: one account cannot lock out another
        const tu = Number((await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(tk).first<{ v: string }>())?.v ?? 0);
        if (tu >= TEST_LOGINS_PER_IP_DAY) return json({ error: "Too many sign-ins from this network today. Please try again tomorrow." }, 429);
        if (!(await spend(env, now, 3))) return BUSY();
        await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(tk, String(tu + 1)).run();
      }
      let ta = await env.DB.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(eh).first<{ org: string }>();
      if (!ta) { const made = await createOrganizer(env, req, email, now, "start", false); /* no Terms-box consent is recorded for an account nobody ticked for */ if ("error" in made) return json({ error: made.error }, (made as any).status ?? 400); ta = await env.DB.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(eh).first<{ org: string }>(); }
      if (ta) { const res = await signInResult(env, req, ta, null, now, email); await useHeldPass(env, ta.org, eh, now); await env.DB.prepare("DELETE FROM organizer_key WHERE org=? AND kind='master' AND hash NOT IN (SELECT hash FROM organizer_key WHERE org=? AND kind='master' ORDER BY created_ms DESC LIMIT 6)").bind(ta.org, ta.org).run(); return json(res); } // the keys made by earlier sign-ins are trimmed: these accounts are shared and public
    }
    const row = await env.DB.prepare("SELECT code_hash, expires_ms, attempts FROM login_code WHERE email_hash=?").bind(eh).first<{ code_hash: string; expires_ms: number; attempts: number }>();
    const bad = () => json({ error: "That code is not right or has expired. Please ask for a new one." }, 400);
    if (!row || row.expires_ms < now || row.attempts >= 5) return bad();
    // the try is counted BEFORE the code is compared, in one statement that only succeeds while fewer than 5 are used: guesses sent in parallel cannot all slip under the cap
    const tried = await env.DB.prepare("UPDATE login_code SET attempts=attempts+1 WHERE email_hash=? AND attempts<5").bind(eh).run();
    if (!(tried as any)?.meta?.changes) return bad();
    if (row.code_hash !== (await sha("code|" + eh + "|" + code))) return bad();
    const acct = await env.DB.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(eh).first<{ org: string }>();
    const hostAcct = await hostForEmail(env.DB, eh);
    if (!acct && !hostAcct) return bad();
    if (!(await spend(env, now, 2))) return BUSY();
    await env.DB.prepare("DELETE FROM login_code WHERE email_hash=?").bind(eh).run();
    const done = await signInResult(env, req, acct, hostAcct, now, email); if (acct) await useHeldPass(env, acct.org, eh, now);
    return json(done);
  }

  /* ---- organizers and their keys ---- */
  if (req.method === "POST" && p === "/api/org") { // platform: a new organizer (called after payment / sign-up); the key is shown once
    if (!a.plat) return deny(a);
    if (!(await spend(env, now))) return BUSY();
    const org = randHex(8), key = "cbk_" + randHex(24);
    await env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test) VALUES(?,?,?,0,?,?)").bind(await sha("key|" + key), org, "master", now, await testFlag(env)).run();
    return json({ ok: true, organizerKey: key });
  }
  if (req.method === "POST" && (p === "/api/org/ai" || p === "/api/org/ai/replace")) { // signed-in organizer only (an AI key can never mint or replace its own link); the old AI link dies at once
    if (a.kind !== "master" || !a.org) return deny(a);
    if (!(await spend(env, now, 3))) return BUSY();
    const r = await replaceAiLink(env, req, a.org, now);
    const presented = req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    await auditAi(env.DB, a.org, new Request(new URL(req.url).origin + "/api/org/ai/replace", { method: "POST", headers: req.headers }), (await sha("key|" + presented)).slice(0, 10), 200, now);
    return json({ ok: true, ...r });
  }
  if (req.method === "GET" && p === "/api/org/ai/link") { // the signed-in organizer reads their lasting AI link again (the page "Show my AI work link"); never an AI key, never in a mail
    if (a.kind !== "master" || !a.org) return deny(a);
    const sealed = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`aikey/${a.org}`).first<{ v: string }>();
    const key = await openText(env as any, sealed?.v);
    const live = key ? await env.DB.prepare("SELECT 1 AS x FROM organizer_key WHERE hash=? AND revoked=0").bind(await sha("key|" + key)).first() : null;
    return json({ ok: true, aiMessage: key && live ? aiMessage((env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin, key) : null });
  }
  if (req.method === "POST" && p === "/api/org/ai/fresh") { // "Get a fresh AI link": a new 24-hour key, e-mailed to the organizer; the lasting key and other links are untouched
    if (a.kind !== "master" || !a.org) return deny(a);
    const live = (await env.DB.prepare("SELECT COUNT(*) AS c FROM organizer_key WHERE org=? AND kind='ai' AND revoked=0 AND expires_ms>?").bind(a.org, now).first<{ c: number }>())?.c ?? 0;
    if (live >= 5) return json({ error: "You already asked for several fresh links today. Use the latest e-mail, or press Replace my AI link." }, 429);
    if (!(await spend(env, now, 3))) return BUSY();
    return json({ ok: true, ...(await mailTempLink(env, req, a.org, "ai", "fresh", now)) });
  }
  if (req.method === "GET" && p === "/api/org/keys") { // the organizer sees their own sign-in keys (never the keys themselves) and can retire old ones
    if (a.kind !== "master" || !a.org) return deny(a);
    const me = await sha("key|" + (req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")));
    const r = await env.DB.prepare("SELECT hash, kind, revoked, created_ms FROM organizer_key WHERE org=? ORDER BY created_ms DESC").bind(a.org).all<any>();
    return json({ keys: (r.results ?? []).map((k: any) => ({ id: k.hash.slice(0, 10), kind: k.kind, revoked: !!k.revoked, created_ms: k.created_ms, thisOne: k.hash === me })) });
  }
  if (req.method === "POST" && p === "/api/org/keys/revoke") {
    if (a.kind !== "master" || !a.org) return deny(a);
    const b = await body(req);
    const id = typeof b?.id === "string" && /^[0-9a-f]{10}$/.test(b.id) ? b.id : "";
    if (!id) return json({ error: "Pick a key from the list." }, 400);
    const me = await sha("key|" + (req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")));
    if (me.startsWith(id)) return json({ error: "That is the key you are using right now. Sign in with another key first." }, 409);
    if (!(await spend(env, now))) return BUSY();
    const r = await env.DB.prepare("UPDATE organizer_key SET revoked=1 WHERE org=? AND substr(hash,1,10)=? AND revoked=0").bind(a.org, id).run();
    return json({ ok: true, revoked: r.meta?.changes ?? 0 });
  }
  if (req.method === "GET" && p === "/api/whoami") { // the console uses this to show the right screen; the Organizer also gets their own e-mail address, shown at the top right
    if (!a.kind) return deny(a);
    let who: string | undefined; if (a.kind === "master" && a.org) { who = (await orgEmail(env, a.org)) || undefined; }
    return json({ kind: a.kind, ...(who ? { email: who } : {}), ...(a.kind === "host" && !a.viaLink ? { ready: a.hostReady === true } : {}) });
  } // the console uses this to show the right screen
  if (req.method === "POST" && p === "/api/host/become-organizer") { // a Host who also wants to run their own games: the same e-mail gets an Organizer account (Terms box K2), and the person then holds both roles
    if (a.kind !== "host" || a.viaLink || !a.hid || a.hostReady === false) return deny(a);
    const row = await identityRow(env.DB, a.hid), mail = row?.email_sealed ? await openText(env as any, row.email_sealed) : null;
    if (!mail) return json({ error: "Your e-mail is not confirmed yet. Finish your Host setup first." }, 409);
    const email = mail.trim().toLowerCase(), eh = await sha("email|" + email);
    if (await env.DB.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(eh).first()) return json({ error: "You already have an Organizer account. Sign out and sign in again with your e-mail code to use it.", code: "has-organizer" }, 409);
    const b = await body(req);
    { const mt = consentRequired(b, "K2"); if (mt) return mt; }
    const made = await createOrganizer(env, req, email, now, "host-to-organizer", true);
    if ("error" in made) return made.status === 503 ? BUSY() : json({ error: made.error }, made.status);
    return json({ ok: true, token: made.token, kind: "organizer", aiMessage: made.aiMessage });
  }
  if (p.startsWith("/api/host/setup")) { // a Host finishing the first open: confirm an e-mail (code; Google is /api/auth/google) and add a mobile number (hostsetup.ts)
    if (a.kind !== "host" || a.viaLink || a.temp || !a.org || !a.hid) return deny(a);
    const hr = await hostSetupRoute({
      req, env, now, p, hid: a.hid, org: a.org, presented: req.headers.get("x-organizer") || "", origin: (env as PayEnv).PUBLIC_ORIGIN ?? url.origin,
      json, body, spend: (n = 1) => spend(env, now, n), busy: BUSY, cleanPhone, newKey: newHostKey, test: (env as PayEnv).TEST_MODE === "1",
      sendMail: (to, subject, text) => sendMail(env as PayEnv, env.DB, to, subject, text, now, { secret: true }),
    });
    if (hr) return hr;
  }
  { // a pay link anyone can open (paylink.ts): the Organizer, a Host or a Co-host of the game makes it; one open link per game, a new one cancels the old
    const plm = p.match(/^\/api\/z\/([A-Za-z0-9_-]{4,40})\/paylink$/);
    if (plm && req.method === "POST") {
      if (a.kind === "ai") return json({ error: "A pay link is for people to make themselves. It is not available through an AI link. Ask the owner to make it in the console (Check, publish and pay)." }, 403);
      if (!a.org || a.viaLink || (a.kind !== "master" && a.kind !== "host" && a.kind !== "cohost")) return deny(a);
      const pe = await env.DB.prepare("SELECT id, org, cap, pack, cancelled_ms FROM engagement WHERE id=?").bind(plm[1]!).first<{ id: string; org: string | null; cap: number; pack: number | null; cancelled_ms: number | null }>();
      if (!pe || pe.org !== a.org) return json({ error: "No such game." }, 404);
      if (a.kind === "cohost" && a.eid && a.eid !== pe.id) return json({ error: "Your Co-host link is for a different game." }, 403);
      if (pe.cancelled_ms) return json({ error: "This game was cancelled. It cannot be paid for." }, 409);
      if (pe.pack !== 0) return json({ error: "This game is already paid for.", code: "already-paid" }, 409);
      if (!packFor(pe.cap)) return json({ error: "That many participants needs a custom arrangement. Please write to us." }, 400);
      if (!(await spend(env, now, 2))) return BUSY();
      const made = await createPayLink(env.DB, pe.id, a.org, a.kind, now);
      return json({ url: `${(env as PayEnv).PUBLIC_ORIGIN ?? url.origin}/paylink.html?t=${made.token}`, expiresMs: made.expiresMs });
    }
  }
  if (req.method === "POST" && p === "/api/org/host") { // the Organizer (or their AI) adds a Host: up to 5, each with a name and AT LEAST ONE of e-mail or mobile. A Host's own one-time link is e-mailed to the Host (if there is an e-mail) or sent by the Organizer on WhatsApp.
    if (a.kind === "ai") return json({ error: "A Host needs a mobile number or an e-mail address. Only the owner enters those, in the console (Your team). Tell the organizer to add the Host there." }, 403);
    if (a.kind !== "master" || !a.org) return deny(a);
    const hb = await body(req);
    const hEmail = typeof hb?.email === "string" ? hb.email.trim().toLowerCase() : "";
    const rawMob = hb?.mobile ?? hb?.phone, hasMob = rawMob !== undefined && rawMob !== null && String(rawMob).trim() !== "";
    if (!hEmail && !hasMob) return json({ error: "Please give the Host's e-mail address or mobile number (at least one). Their own link is sent there." }, 400);
    if (hEmail && !EMAIL_RE.test(hEmail)) return json({ error: "That e-mail address does not look right. Please check it." }, 400);
    const hMob = hasMob ? cleanPhone(rawMob) : null;
    if (hMob && !hMob.ok) return json({ error: "Please check the Host's mobile number. " + hMob.why }, 400);
    const n = (await env.DB.prepare("SELECT COUNT(*) AS c FROM organizer_key WHERE org=? AND kind='host' AND revoked=0 AND expires_ms IS NULL AND (host_id IS NULL OR host_id=hash) AND COALESCE(created_by,'')<>'d'").bind(a.org).first<{ c: number }>())?.c ?? 0; // a Help Desk Host (created_by 'd') does not use one of the 5 places
    if (n >= MAX_HOSTS) return json({ error: `You can have up to ${MAX_HOSTS} Hosts at a time. Retire one first.` }, 409);
    if (!(await spend(env, now, 4))) return BUSY();
    const key = "cbh_" + randHex(24), label = cleanLabel(hb?.label), kh = await sha("key|" + key);
    const hGame = await ownGameId(env, a.org, hb?.e); // added from inside a game: the Host's link opens that game
    const sealedEmail = hEmail ? await sealText(env as any, hEmail) : null, sealedWho = hMob && hMob.ok ? await sealPii(env, { phone: hMob.digits, name: label || null }) : null; // the Host's e-mail and mobile are kept sealed, on the key row
    await env.DB.batch([
      env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test,label,email_sealed,pii,created_by,host_id) VALUES(?,?,?,0,?,COALESCE((SELECT MAX(k2.is_test) FROM organizer_key k2 WHERE k2.org=?),0),?,?,?,'o',?)").bind(kh, a.org, "host", now, a.org, label, sealedEmail, sealedWho, kh),
      env.DB.prepare("INSERT INTO host_state(host_id,org,link_exp_ms,mobile_ok) VALUES(?,?,?,?)").bind(kh, a.org, now + HOST_LINK_TTL_MS, hMob ? 1 : 0),
    ]);
    const hOrigin = (env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin, hLink = `${hOrigin}/zc.html?k=${key}${hGame ? "&e=" + encodeURIComponent(hGame) : ""}`;
    let hostMailed = false;
    if (hEmail) { const hostMail = hostLinkMail(hOrigin, key, label, hGame); hostMailed = await sendMail(env as PayEnv, env.DB, hEmail, hostMail.subject, hostMail.text, now, { html: hostMail.html, secret: true }); } // to the Host only
    const hm = await mailTempLink(env, req, a.org, "host", "start", now); // the dedicated Host AI-link mail (24-hour key) still goes to the Organizer, as before
    return json({ ok: true, hostKey: key, link: hLink, manualUrl: `${hOrigin}/ai/${key}`, mailed: hm.mailed, emailed: hostMailed, id: kh.slice(0, 10), label, ...(hEmail ? { email: hEmail } : {}), ...(hMob && hMob.ok ? { mobileMasked: maskMobile(hMob.digits), waLink: waLinkFor(hMob.digits, label, hLink) } : {}), expiresMs: now + HOST_LINK_TTL_MS });
  }
  if (req.method === "POST" && p === "/api/org/host/link") { // the Organizer sends a Host a NEW first-open link: the old link stops at once. Only for a Host who has not confirmed their e-mail yet (later they sign in with it).
    if (a.kind === "ai") return json({ error: "Only the owner sends a Host's link, in the console (Your team)." }, 403);
    if (a.kind !== "master" || !a.org) return deny(a);
    const lb = await body(req);
    const lid = typeof lb?.id === "string" && /^[0-9a-f]{10}$/.test(lb.id) ? lb.id : "";
    if (!lid) return json({ error: "Pick a Host from the list." }, 400);
    const hr = await env.DB.prepare("SELECT hash, label, email_sealed, pii FROM organizer_key WHERE org=? AND substr(hash,1,10)=? AND kind='host' AND revoked=0 AND expires_ms IS NULL AND (host_id IS NULL OR host_id=hash)").bind(a.org, lid).first<{ hash: string; label: string | null; email_sealed: string | null; pii: string | null }>();
    if (!hr) return json({ error: "That person is not on your team." }, 404);
    const hst = await hostStateRow(env.DB, hr.hash);
    if (hst?.verified_ms) return json({ error: "This Host has already finished setup and signs in with their e-mail. If they cannot get in, retire them and add them again.", code: "host-active" }, 409);
    if (!(await spend(env, now, 4))) return BUSY();
    const nk = "cbh_" + randHex(24), nh = await sha("key|" + nk);
    await env.DB.batch([
      env.DB.prepare("UPDATE organizer_key SET hash=?, host_id=?, created_ms=? WHERE hash=?").bind(nh, nh, now, hr.hash),
      env.DB.prepare("INSERT INTO host_state(host_id,org,link_exp_ms,mobile_ok) VALUES(?,?,?,?) ON CONFLICT(host_id) DO NOTHING").bind(hr.hash, a.org, now + HOST_LINK_TTL_MS, hr.pii ? 1 : 0),
      env.DB.prepare("UPDATE host_state SET host_id=?, link_exp_ms=?, spent=0, pend_hash=NULL, pend_sealed=NULL WHERE host_id=?").bind(nh, now + HOST_LINK_TTL_MS, hr.hash),
    ]);
    const lGame = await ownGameId(env, a.org, lb?.e);
    const lOrigin = (env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin, lLink = `${lOrigin}/zc.html?k=${nk}${lGame ? "&e=" + encodeURIComponent(lGame) : ""}`;
    const lEmail = await openText(env as any, hr.email_sealed), lWho = await openPii(env as any, hr.pii);
    let lMailed = false;
    if (lEmail) { const m = hostLinkMail(lOrigin, nk, hr.label ?? "", lGame); lMailed = await sendMail(env as PayEnv, env.DB, lEmail, m.subject, m.text, now, { html: m.html, secret: true }); }
    return json({ ok: true, link: lLink, hostKey: nk, id: nh.slice(0, 10), label: hr.label ?? "", emailed: lMailed, expiresMs: now + HOST_LINK_TTL_MS, ...(lWho?.phone ? { mobileMasked: maskMobile(lWho.phone), waLink: waLinkFor(lWho.phone, hr.label ?? "", lLink) } : {}) });
  }
  if (req.method === "GET" && p === "/api/org/team") { // who is on the team (never the keys): the Organizer, their AI and a Host may look; a Co-host may not. ?e=<game> lists that game's Co-hosts. Host e-mails only for the Organizer and Hosts.
    if ((a.kind !== "master" && a.kind !== "ai" && a.kind !== "host") || !a.org) return deny(a);
    const forGame = url.searchParams.get("e");
    const rows = (await env.DB.prepare("SELECT hash, kind, label, created_ms, email_sealed, eid, pii, created_by FROM organizer_key WHERE org=? AND revoked=0 AND expires_ms IS NULL AND kind IN ('host','cohost') AND (host_id IS NULL OR host_id=hash) ORDER BY created_ms").bind(a.org).all<{ hash: string; kind: string; label: string | null; created_ms: number; email_sealed: string | null; eid: string | null; pii: string | null; created_by: string | null }>()).results ?? [];
    const cohosts = [];
    for (const r of rows.filter((x) => x.kind === "cohost" && (!forGame || x.eid === forGame))) {
      const who = a.kind === "ai" ? null : await openPii(env as any, r.pii); // an AI never sees a mobile number
      cohosts.push({ id: r.hash.slice(0, 10), label: r.label ?? "", createdMs: r.created_ms, eid: r.eid, ...(who ? { phoneMasked: "******" + who.phone.slice(-4) } : {}), brought: await broughtBy(env, a.org, r.hash.slice(0, 7)) });
    }
    const hosts = [];
    for (const r of rows.filter((x) => x.kind === "host")) {
      const hst = await hostStateRow(env.DB, r.hash), emailOk = !!hst?.verified_ms, mobileOk = !!hst?.mobile_ok || !!r.pii;
      const setup = emailOk && mobileOk ? "ready" : emailOk ? "needs-mobile" : hst && !hst.spent && now > hst.link_exp_ms ? "link-expired" : "waiting-for-host"; // what the Organizer sees next to a Host: ready, or why not (a new link can be sent for the last two)
      hosts.push({ id: r.hash.slice(0, 10), label: r.label ?? "", createdMs: r.created_ms, ...(r.created_by === "d" ? { helpDesk: true } : {}), setup, emailConfirmed: emailOk, hasMobile: mobileOk, ...(hst && !emailOk ? { linkExpiresMs: hst.link_exp_ms } : {}), ...(a.kind !== "ai" && r.email_sealed ? { email: await openText(env as any, r.email_sealed) } : {}) });
    }
    return json({ maxHosts: MAX_HOSTS, hosts, cohosts });
  }
  if (req.method === "POST" && p === "/api/org/cohost") { // the Organizer or a Host adds a Co-host for ONE game: a name and a mobile number (no e-mail). The key invites people with an own link and pays, nothing else. No limit.
    if ((a.kind !== "master" && a.kind !== "host") || !a.org) return a.kind === "ai" ? json({ error: "A Co-host needs a name and a mobile number. Only the owner enters those, in the console." }, 403) : deny(a);
    const cb = await body(req);
    const cName = cleanLabel(cb?.label), cDigits = String(cb?.phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
    if (cName.length < 2) return json({ error: "Please give the Co-host's name." }, 400);
    if (cDigits.length < 10 || cDigits.length > 15) return json({ error: "Please give a valid mobile number for the Co-host." }, 400);
    const cEid = typeof cb?.e === "string" ? cb.e : typeof cb?.eid === "string" ? cb.eid : "";
    const cg = ID.test(cEid) ? await env.DB.prepare("SELECT id, org, cancelled_ms FROM engagement WHERE id=?").bind(cEid).first<{ id: string; org: string | null; cancelled_ms: number | null }>() : null;
    if (!cg || cg.org !== a.org) return json({ error: "Choose which game this Co-host is for." }, 400);
    if (cg.cancelled_ms) return json({ error: "That game was cancelled." }, 409);
    if (!(await spend(env, now, 2))) return BUSY();
    const key = "cbc_" + randHex(24), kh = await sha("key|" + key);
    await env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test,label,eid,pii,created_by) VALUES(?,?,?,0,?,COALESCE((SELECT MAX(k2.is_test) FROM organizer_key k2 WHERE k2.org=?),0),?,?,?,?)").bind(kh, a.org, "cohost", now, a.org, cName, cEid, await sealPii(env, { phone: cDigits, name: cName }), a.kind === "host" ? "h:" + (a.hid ?? (await sha("key|" + (req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")))).slice(0, 7)).slice(0, 7) : "o").run(); // name in the label, mobile sealed; both erased with the game's participant data
    const cOrigin = (env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin;
    return json({ ok: true, cohostKey: key, link: cEid ? `${cOrigin}/zc.html?e=${encodeURIComponent(cEid)}#cohost=${key}` : `${cOrigin}/zc.html?k=${key}`, id: kh.slice(0, 10), label: cName, eid: cEid, phoneMasked: "******" + cDigits.slice(-4) });
  }
  if (req.method === "POST" && p === "/api/org/team/retire") { // the Organizer retires Hosts or Co-hosts; a Host retires Co-hosts only. The key stops at once; a Co-host's name and mobile are erased.
    if ((a.kind !== "master" && a.kind !== "host") || !a.org) return deny(a);
    const b = await body(req);
    const id = typeof b?.id === "string" && /^[0-9a-f]{10}$/.test(b.id) ? b.id : "";
    if (!id) return json({ error: "Pick a person from the list." }, 400);
    const row = await env.DB.prepare("SELECT hash, kind FROM organizer_key WHERE org=? AND substr(hash,1,10)=? AND revoked=0 AND kind IN ('host','cohost')").bind(a.org, id).first<{ hash: string; kind: string }>();
    if (!row) return json({ error: "That person is not on your team." }, 404);
    if (row.kind === "host" && a.kind !== "master") return deny(a);
    const me = await sha("key|" + (req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")));
    if (row.hash === me) return json({ error: "That is the key you are using right now." }, 409);
    if (row.kind === "host") await retireHost(env.DB, row.hash); // the identity row, every device key and the e-mail sign-in
    else await env.DB.prepare("UPDATE organizer_key SET revoked=1, pii=NULL, email_sealed=NULL WHERE hash=?").bind(row.hash).run();
    return json({ ok: true, revoked: 1 });
  }
  if (req.method === "GET" && p === "/api/org/ai/audit") { // the organizer sees every call their external AI made; we can see all (the AI may read its own trail)
    if (a.kind !== "master" && a.kind !== "ai" && !a.plat) return deny(a);
    return listAiAudit(env.DB, a.plat ? null : a.org, json);
  }
  { // OWNER ONLY (platform key, never through an AI work link): the internal audit log. No organizer, co-host, participant or AI route reads it. Every use is written to the access log.
    const om = p.match(/^\/api\/owner\/audit\/(access|(sys|org:[0-9a-f]{16}|[A-Za-z0-9_-]{4,40}))(?:\/(verify|analyze|hold))?$/);
    if (om) {
      const what = om[1] === "access" ? "access" : om[3] ?? "download", chain = om[2] ?? "", ownerOk = a.plat && req.headers.get("x-cb-link") !== "1";
      if (!ownerOk) { await logAccess(env.DB, now, "denied:" + what, chain || null, null, 0, false, a.kind ?? "anonymous"); return json({ error: "Not found" }, 404); }
      const aenv = env as AuditEnv;
      if (what === "access") { const r = await env.DB.prepare("SELECT at_ms, action, eid, fmt, row_count, ok, note FROM audit_access ORDER BY id DESC LIMIT 500").all<any>(); await logAccess(env.DB, now, "read-access-log", null, null, (r.results ?? []).length); return json({ access: r.results ?? [] }); }
      if (what === "verify" && req.method === "GET") { const v = await verifyChain(env.DB, chain); await logAccess(env.DB, now, "verify", chain, null, v.rows, v.ok); return json(v); }
      if (what === "analyze" && req.method === "POST") { const out = await analyzeChain(aenv, chain); await logAccess(env.DB, now, "analyze", chain, out.summarizedBy, out.aggregate.rows); return json(out); }
      if (what === "hold" && req.method === "POST") { const b = await body(req); await setHold(env.DB, chain, b?.on === true, now, typeof b?.note === "string" ? b.note : null); await logAccess(env.DB, now, b?.on === true ? "hold-on" : "hold-off", chain, null, 0); return json({ ok: true, held: b?.on === true }); }
      if (what === "download" && req.method === "GET") {
        const fmt = url.searchParams.get("format") === "csv" ? "csv" : "json", limit = Math.min(5000, Math.max(1, Number(url.searchParams.get("limit")) || 5000)), offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        const rows = await loadRows(aenv, chain, limit, offset);
        await logAccess(env.DB, now, "download", chain, fmt, rows.length);
        return fmt === "csv" ? new Response(toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="audit-${chain.replace(/[^A-Za-z0-9_-]/g, "_")}.csv"` } }) : json({ chain, rows });
      }
      return json({ error: "Not found" }, 404);
    }
  }
  if (req.method === "POST" && p === "/api/org/close") { // "Close my organizer account": only the organizer's own sign-in key, never an AI key. Deletes the account and every engagement; payment and invoice records stay because the law requires them.
    if (a.kind !== "master" || !a.org) return deny(a);
    const b = await body(req);
    if (b?.confirm !== true) return json({ error: "Please confirm in your console." }, 400);
    const engs = (await env.DB.prepare("SELECT * FROM engagement WHERE org=?").bind(a.org).all<any>()).results ?? [];
    for (const g of engs) if (now >= roundMs(g.start_round) && now < (await endBoundMs(env as any, g))) return json({ error: "A game is running. Close the account after it ends." }, 409);
    if (!(await spend(env, now, 8 + engs.length * 4))) return BUSY();
    const forfeited = (await activeCreditSummary(env.DB, a.org, now)).activeTotalInr; // closing the account ends its credit (no refunds); the credit records stay with the payment and invoice records
    for (const g of engs) await eraseEverything(env as any, g.id);
    const keys = (await env.DB.prepare("SELECT hash FROM organizer_key WHERE org=?").bind(a.org).all<{ hash: string }>()).results ?? [];
    for (const k of keys) await env.DB.prepare("DELETE FROM kv WHERE k=? OR k=?").bind(`seen/${k.hash.slice(0, 10)}`, `alert/${k.hash.slice(0, 10)}`).run();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM kv WHERE k=? OR k=?").bind(`orgmail/${a.org}`, `aikey/${a.org}`), env.DB.prepare("DELETE FROM organizer_email WHERE org=?").bind(a.org),
      env.DB.prepare("DELETE FROM organizer_terms WHERE org=?").bind(a.org), env.DB.prepare("DELETE FROM consent_log WHERE subject=? AND kind IN ('K1','K2','K5','K6')").bind(a.org), env.DB.prepare("DELETE FROM ai_audit WHERE org=?").bind(a.org), env.DB.prepare("DELETE FROM audit_log WHERE chain=?").bind("org:" + a.org), env.DB.prepare("DELETE FROM organizer_key WHERE org=?").bind(a.org),
      ...helpdeskCloseStatements(env.DB, a.org), env.DB.prepare("DELETE FROM host_state WHERE org=?").bind(a.org), env.DB.prepare("DELETE FROM host_login WHERE org=?").bind(a.org), env.DB.prepare("DELETE FROM paylink WHERE org=?").bind(a.org),
    ]);
    return json({ ok: true, closed: true, engagementsDeleted: engs.length, creditForfeitedInr: forfeited });
  }
  if (req.method === "POST" && p === "/api/org/ai/revoke") {
    if (a.kind !== "master" || !a.org) return deny(a);
    if (!(await spend(env, now))) return BUSY();
    const r = await env.DB.prepare("UPDATE organizer_key SET revoked=1 WHERE org=? AND kind='ai' AND revoked=0 AND COALESCE(created_by,'')<>'d'").bind(a.org).run();
    await env.DB.prepare("DELETE FROM kv WHERE k=?").bind(`aikey/${a.org}`).run();
    return json({ ok: true, revoked: r.meta?.changes ?? 0 });
  }

  /* ---- signed pause / resume / extend / stop: the signature is the authorisation, the Worker just stores and serves one small file ---- */
  const cm = p.match(/^\/api\/z\/([A-Za-z0-9_-]{3,40})\/control(\/key|\/request|\/request\/clear)?$/);
  if (cm) {
    const [, cid, sub] = cm;
    if (sub && a.kind === "host" && req.headers.get("x-cb-link") === "1") return deny(a); // a Host's narrow work link may read the pause file but cannot register keys or file pause / stop / erase requests
    const kv = d1kv(env);
    if (!sub && req.method === "GET") return sharedRead(req, 1, async () => { // the pause file every phone asks for every few seconds: one answer per place per second is shared by all of them (far fewer database reads); a pause reaches phones at most a second later
      const f = await readPublished(kv, cid!);
      const ge = await env.DB.prepare("SELECT id, pack, start_round, cancelled_ms, unplayed_ms FROM engagement WHERE id=?").bind(cid).first<{ id: string; pack: number | null; start_round: number; cancelled_ms: number | null; unplayed_ms: number | null }>();
      if (ge?.cancelled_ms) return new Response(JSON.stringify({ ...(f ?? {}), cancelled: true }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3" } }); // phones and the big screen: "This game was cancelled by the organizer"
      if (ge?.unplayed_ms) return new Response(JSON.stringify({ ...(f ?? {}), didNotStart: true }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3" } }); // "This game did not start. Your details have been erased."
      if (ge && ge.pack === 0 && roundMs(ge.start_round) - LOCK_LEAD_MS <= now && (await isPublished(env, ge))) // published, unpaid, start time reached: phones hold, nothing is shown
        return new Response(JSON.stringify({ ...(f ?? {}), locked: true }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3" } });
      if (f) { // the organizer's latest message rides along with the pause file phones already ask for, so it costs no extra requests
        const an = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`ann/${cid}`).first<{ v: string }>();
        if (an) { const x = JSON.parse(an.v); return new Response(JSON.stringify({ ...f, ann: { id: x.id, text: x.text } }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3" } }); }
      }
      return f ? new Response(JSON.stringify(f), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3" } }) : json({ registered: false }, 404);
    });
    if (!sub && req.method === "POST") {
      const b = await body(req);
      if (!b) return json({ error: "Bad message." }, 400);
      const r = await publishControl(kv, cid!, b.message);
      // The write guard is charged only for a message that was ACCEPTED (its signature held): anyone can post garbage here, and charging first let a script use up the day's budget and make every join answer "very busy". A pause or stop also still works on a day the budget is spent.
      if (r.ok && !(r as any).duplicate) { await spend(env, now); await mirrorControl(env, cid!); }
      return r.ok ? json(r) : json({ error: r.error }, r.status);
    }
    const ce = await env.DB.prepare("SELECT id, org, cap FROM engagement WHERE id=?").bind(cid).first<{ id: string; org: string | null; cap: number }>();
    if (!ce) return json({ error: "No such game." }, 404);
    if (sub === "/key" && req.method === "PUT") { // only the organizer's own console registers the key that signs pauses
      if (!can(a, ce, true)) return deny(a);
      const b = await body(req);
      if (!b || typeof b.publicKey !== "string") return json({ error: "Bad key." }, 400);
      if (!(await spend(env, now))) return BUSY();
      const safety = safetyForCap(ce.cap, b.profile === "fast");
      if (!safety) return json({ error: `Pause is available for games of up to ${PAUSE_MAX_PARTICIPANTS.toLocaleString("en-IN")} participants. Larger ones run without it, which keeps every phone's traffic off the free plan's daily allowance.` }, 409);
      const r = await registerKey(kv, cid!, b.publicKey, safety);
      if (r.ok) await mirrorControl(env, cid!);
      return r.ok ? json({ ok: true }) : json({ error: r.error }, 409);
    }
    if (sub === "/request" && req.method === "POST") { // the AI (or organizer) asks; the organizer's browser approves by signing
      if (!can(a, ce)) return deny(a);
      const b = await body(req);
      if (!b || !["pause", "resume", "stop", "erase"].includes(b.action)) return json({ error: "Ask for pause, resume, stop or erase." }, 400);
      if (!(await spend(env, now))) return BUSY();
      if (b.action === "erase") { // the AI may ASK to delete all participant data; only the organizer's own confirmation in their console does it
        await nudge(env, cid!, `delreq-${day(now)}`, now, `Your AI assistant asked to delete all participant data: game ${cid}`, `Your AI assistant asked to delete all participant data for ${cid}. Nothing is deleted yet.\n\nTo confirm, press Confirm in your console: ${(env as PayEnv).PUBLIC_ORIGIN ?? ""}/zc.html?e=${cid}\n\nNot you? Press Dismiss.`);
        await env.DB.prepare("INSERT INTO cbl_request(eid,action,note,at_ms,open) VALUES(?,?,?,?,1)").bind(cid, "erase", typeof b.note === "string" ? b.note.replace(/[<>`]/g, "").slice(0, 200) : null, now).run();
        return json({ ok: true, message: "Nothing has been deleted yet. The organizer has been asked and must confirm in their console (we also e-mailed them). Tell them to open the console and press Confirm." });
      }
      await env.DB.prepare("INSERT INTO cbl_request(eid,action,note,at_ms,open) VALUES(?,?,?,?,1)").bind(cid, b.action, typeof b.note === "string" ? b.note.replace(/[<>`]/g, "").slice(0, 200) : null, now).run();
      return json({ ok: true, message: "The organizer has been asked and must approve it in their console." });
    }
    if (sub === "/request" && req.method === "GET") {
      if (!can(a, ce)) return deny(a);
      const r = await env.DB.prepare("SELECT id, action, note, at_ms FROM cbl_request WHERE eid=? AND open=1 ORDER BY id").bind(cid).all<any>();
      return json({ requests: r.results ?? [] });
    }
    if (sub === "/request/clear" && req.method === "POST") {
      if (!can(a, ce, true)) return deny(a);
      await env.DB.prepare("UPDATE cbl_request SET open=0 WHERE eid=?").bind(cid).run();
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }

  /* ---- suggestions: one shared board for every organizer's AI; we (platform) decide what to build ---- */
  if (p === "/api/z/suggestions" || /^\/api\/z\/suggestions\/\d{1,9}\/(vote|status)$/.test(p)) {
    const KINDS = ["feature", "improvement", "report", "bug", "other"], STATUSES = ["new", "under_review", "planned", "shipped", "declined"];
    if (!a.plat && !a.org) return deny(a);
    if (req.method === "GET" && p === "/api/z/suggestions") {
      const st = url.searchParams.get("status");
      const q = st && STATUSES.includes(st) ? env.DB.prepare("SELECT id, kind, title, body, status, note, votes, created_ms, org FROM suggestion WHERE status=? ORDER BY votes DESC, id DESC LIMIT 200").bind(st) : env.DB.prepare("SELECT id, kind, title, body, status, note, votes, created_ms, org FROM suggestion ORDER BY votes DESC, id DESC LIMIT 200");
      const rows = (await q.all<any>()).results ?? [];
      const mine = a.org ? new Set(((await env.DB.prepare("SELECT sid FROM suggestion_vote WHERE org=?").bind(a.org).all<any>()).results ?? []).map((r: any) => r.sid)) : new Set();
      return json({ suggestions: rows.map((r: any) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, status: r.status, note: r.note, votes: r.votes, created_ms: r.created_ms, yours: !!a.org && r.org === a.org, youSupported: mine.has(r.id), ...(a.plat ? { org: r.org } : {}) })) }); // authors are never shown to other organizers
    }
    if (req.method === "POST" && p === "/api/z/suggestions") {
      if (!a.org) return deny(a); // platform has its own tools; this is for organizers and their AI
      const b = await body(req, 8192);
      const title = typeof b?.title === "string" ? b.title.replace(/[<>`]/g, "").trim() : "";
      const text = typeof b?.body === "string" ? b.body.replace(/[<>`]/g, "").trim() : "";
      if (!b || !KINDS.includes(b.kind) || title.length < 4 || title.length > 120 || text.length < 10 || text.length > 2000) return json({ error: "Give a kind (feature, improvement, report, bug or other), a short title (4 to 120 characters) and a description (10 to 2000 characters)." }, 400);
      if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(title + " " + text) || /(?:\d[\s-]?){10,}/.test(title + " " + text)) return json({ error: "Please do not include e-mail addresses or phone numbers, or anything about specific people. Describe the need in general terms." }, 400);
      const today = (await env.DB.prepare("SELECT COUNT(*) AS c FROM suggestion WHERE org=? AND created_ms>?").bind(a.org, now - 86_400_000).first<{ c: number }>())?.c ?? 0;
      if (today >= 20) return json({ error: "That is plenty for today. Please try again tomorrow." }, 429);
      const th = await sha("title|" + title.toLowerCase().replace(/\s+/g, " "));
      const dup = await env.DB.prepare("SELECT id FROM suggestion WHERE org=? AND title_hash=?").bind(a.org, th).first<{ id: number }>();
      if (dup) return json({ ok: true, id: dup.id, duplicate: true });
      if (!(await spend(env, now, 2))) return BUSY();
      const r = await env.DB.prepare("INSERT INTO suggestion(org,kind,title,body,status,votes,created_ms,title_hash) VALUES(?,?,?,?, 'new', 1, ?, ?)").bind(a.org, b.kind, title, text, now, th).run();
      const id = (await env.DB.prepare("SELECT id FROM suggestion WHERE org=? AND title_hash=?").bind(a.org, th).first<{ id: number }>())!.id;
      await env.DB.prepare("INSERT OR IGNORE INTO suggestion_vote(sid,org) VALUES(?,?)").bind(id, a.org).run();
      return json({ ok: true, id, stored: r.meta?.changes ?? 0 });
    }
    const sm = p.match(/^\/api\/z\/suggestions\/(\d+)\/(vote|status)$/);
    if (sm && req.method === "POST") {
      const sid = Number(sm[1]);
      const row = await env.DB.prepare("SELECT id FROM suggestion WHERE id=?").bind(sid).first();
      if (!row) return json({ error: "No such suggestion." }, 404);
      if (sm[2] === "vote") {
        if (!a.org) return deny(a);
        if (!(await spend(env, now, 2))) return BUSY();
        const r = await env.DB.prepare("INSERT OR IGNORE INTO suggestion_vote(sid,org) VALUES(?,?)").bind(sid, a.org).run();
        if (r.meta?.changes) await env.DB.prepare("UPDATE suggestion SET votes=votes+1 WHERE id=?").bind(sid).run();
        return json({ ok: true, counted: !!r.meta?.changes });
      }
      if (!a.plat) return deny(a); // only we decide status
      const b = await body(req);
      if (!b || !STATUSES.includes(b.status)) return json({ error: "Pick a status." }, 400);
      await env.DB.prepare("UPDATE suggestion SET status=?, note=? WHERE id=?").bind(b.status, typeof b.note === "string" ? b.note.replace(/[<>`]/g, "").slice(0, 300) : null, sid).run();
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }

  /* ---- engagements ---- */
  if (req.method === "POST" && p === "/api/z") {
    if (!a.plat && !a.org) return deny(a);
    if (a.kind === "host") return deny(a);
    const b = await body(req, BRAND_BODY_MAX); // room for a brand logo (30 KB picture = about 40 KB of text)
    if (b && Number.isInteger(b.callSeconds) && !GAPS.includes(b.callSeconds)) return json({ error: GAP_MSG }, 400);
    if (!b) return json({ error: "Check the details and try again." }, 400);
    if (!ID.test(b.id ?? "")) return json({ error: "The game code can use letters, numbers, - and _ only (3 to 40 characters)." }, 400);
    if (!Number.isInteger(b.startRound)) return json({ error: "Pick the day and time the game starts." }, 400);
    if (!Number.isInteger(b.callSeconds) || b.callSeconds % 3 || b.callSeconds < 6) return json({ error: GAP_MSG }, 400);
    if (!Number.isInteger(b.cap) || b.cap < 1 || b.cap > 100000) return json({ error: "The number of people must be a whole number from 1 up. Please check it." }, 400);
    if (b.whoCanJoin !== undefined && b.whoCanJoin !== "list" && b.whoCanJoin !== "anyone") return json({ error: "Who can join: choose \"list\" (only people on a list) or \"anyone\" (anyone with the link)." }, 400);
    if (roundMs(b.startRound) > now + MAX_AHEAD_MS) return json({ error: TOO_FAR, code: "too-far" }, 400);
    const vc = validateCfg({ tickets: b.tickets, rewards: b.rewards, breaks: b.breaks, rounds: b.rounds, opening: b.opening, closing: b.closing, name: b.name, brand: b.brand, mark: b.mark, join: b.join, tz: b.tz, verify: b.verify, employeesOnly: b.employeesOnly });
    if (!vc.ok) return json({ error: vc.error }, 400);
    const have = await env.DB.prepare("SELECT org FROM engagement WHERE id=?").bind(b.id).first<{ org: string | null }>();
    if (have) return json({ ok: true, existed: true }); // creating twice never overwrites (and never reveals whose it is)
    // an organizer needs a purchased engagement (entitlement) big enough for the limit they ask for; we (platform) do not. A demo game never uses up a bought pack.
    if (!a.plat && a.org) { try { await ownerTestGrant(env, a.org, b.cap, now); } catch { /* no grant: the game is a draft as for everybody */ } }
    const ent = a.plat ? null : await env.DB.prepare("SELECT id, pack FROM entitlement WHERE org=? AND eid IS NULL AND pack>=? ORDER BY pack, created_ms LIMIT 1").bind(a.org, b.cap).first<{ id: string; pack: number }>();
    // no payment is needed to BUILD an engagement: without a purchased pack it is saved as a draft (pack 0) that participants cannot see or join;
    // payment is asked only when the organizer publishes it (POST /api/z/:id/publish)
    const draft = !a.plat && !ent;
    if (draft) {
      const n = (await env.DB.prepare("SELECT COUNT(*) AS c FROM engagement e WHERE e.org=? AND e.pack=0 AND NOT EXISTS (SELECT 1 FROM kv WHERE k='pub/' || e.id)").bind(a.org).first<{ c: number }>())?.c ?? 0;
      if (n >= MAX_DRAFTS) return json({ error: `You have ${MAX_DRAFTS} unpublished drafts. Publish one, or delete one you do not need (open Your games, then press Delete next to it). An unpublished draft is also forgotten after ${DRAFT_DAYS} days.` }, 409);
    }
    if (!(await spend(env, now, 2))) return BUSY();
    const isTestEng = (await testFlag(env)) === 1 || (await orgIsTest(env, a.org)) ? 1 : 0; // made in TEST mode, or by a test account
    await env.DB.prepare("INSERT OR IGNORE INTO engagement(id,start_round,call_seconds,cap,created_ms,org,closed,pack,tickets,config,is_test) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(b.id, b.startRound, b.callSeconds, b.cap, now, a.org, b.whoCanJoin === "list" || (b.whoCanJoin === undefined && b.closed) || vc.cfg.employeesOnly ? 1 : 0, draft ? 0 : ent?.pack ?? b.cap, vc.cfg.tickets, cfgJson(vc.cfg), isTestEng).run(); // the console sends whoCanJoin "list"; the API default stays "anyone"
    if (ent) await env.DB.prepare("UPDATE entitlement SET eid=? WHERE id=? AND eid IS NULL").bind(b.id, ent.id).run();
    if (a.kind === "ai" && a.org) await noteHelperGame(env.DB, req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""), a.org, b.id, now); // a game made with a Help Desk helper's key is recorded as theirs
    if (a.org) await recordTerms(env, a.org, now, "engagement");
    return json({ ok: true, draft, openUrl: `${(env as PayEnv).PUBLIC_ORIGIN ?? ""}/zc.html?e=${b.id}` });
  }
  if (req.method === "GET" && p === "/api/history") {
    if (!a.plat && !a.org) return deny(a);
    const q = a.plat
      ? env.DB.prepare("SELECT e.id, e.created_ms, e.start_round, e.call_seconds, e.closed, (e.pack=0) AS draft, (e.pack=0 AND e.cancelled_ms IS NULL AND e.unplayed_ms IS NULL AND NOT EXISTS (SELECT 1 FROM kv WHERE k='pub/'||e.id)) AS deletable, (SELECT COUNT(*) FROM participant p WHERE p.eid=e.id) AS participants, CASE WHEN json_valid(e.config) THEN json_extract(e.config,'$.name') END AS name FROM engagement e WHERE e.is_test=? ORDER BY e.created_ms DESC LIMIT 50").bind(url.searchParams.get("mode") === "test" ? 1 : 0) // the owner's list shows real engagements unless the test ones are asked for
      : env.DB.prepare("SELECT e.id, e.created_ms, e.start_round, e.call_seconds, e.closed, (e.pack=0) AS draft, (e.pack=0 AND e.cancelled_ms IS NULL AND e.unplayed_ms IS NULL AND NOT EXISTS (SELECT 1 FROM kv WHERE k='pub/'||e.id)) AS deletable, (SELECT COUNT(*) FROM participant p WHERE p.eid=e.id) AS participants, CASE WHEN json_valid(e.config) THEN json_extract(e.config,'$.name') END AS name FROM engagement e WHERE e.org=? ORDER BY e.created_ms DESC LIMIT 50").bind(a.org);
    const r = await q.all<any>();
    return json({ engagements: (r.results ?? []).map((x: any) => ({ ...x, startsAtIST: istTime(roundMs(x.start_round)) })), retentionDays: RETENTION_DAYS });
  }
  if (req.method === "POST" && p === "/api/inbound-email") { // the mail service forwards e-mail sent to our address; a deletion request counts only from the organizer's registered address
    if (!(env.INBOUND_SECRET ?? "").trim() || (req.headers.get("x-inbound-secret") ?? "").trim() !== (env.INBOUND_SECRET ?? "").trim()) return deny(a);
    const b = await body(req, 200_000);
    const from = String(b?.from ?? "").toLowerCase().match(/[^\s<>"',;]+@[^\s<>"',;]+/)?.[0];
    const text = `${b?.subject ?? ""}\n${b?.text ?? ""}`;
    if (!from || !/\bdelete\b|\berase\b/i.test(text)) return json({ ok: true, action: "none" });
    // The sender field of an e-mail can be forged, so it is never enough: the first mail only makes us send a 6-digit code to the registered address; the deletion happens when a reply carrying that code arrives.
    const done: string[] = [], asked: string[] = [];
    const codes = [...new Set(text.match(/\b\d{6}\b/g) ?? [])].slice(0, 5);
    for (const tok of [...new Set(text.match(/[A-Za-z0-9_-]{4,40}/g) ?? [])].slice(0, 80)) {
      const c = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`contact/${tok}`).first<{ v: string }>();
      if (!c || String(JSON.parse(c.v).email ?? "").toLowerCase() !== from) continue;
      const registered = String(JSON.parse(c.v).email);
      const pend = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`delreq/${tok}`).first<{ v: string }>();
      const pv = pend ? JSON.parse(pend.v) : null;
      let confirmed = false;
      if (pv && pv.x > now) for (const cd of codes) if ((await sha(`delcode|${tok}|${cd}`)) === pv.c) confirmed = true;
      if (confirmed) { await erasePersonal(env, tok, now, "email"); await env.DB.prepare("DELETE FROM kv WHERE k=?").bind(`delreq/${tok}`).run(); done.push(tok); continue; }
      if (pv && pv.x > now && now - pv.t < 300_000) continue; // a code was sent a moment ago: do not send another
      const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900000));
      await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`delreq/${tok}`, JSON.stringify({ c: await sha(`delcode|${tok}|${code}`), x: now + 1_800_000, t: now })).run();
      await sendMail(env as PayEnv, env.DB, registered, `Confirm the deletion of participant data: ${tok}`, `We got a request to delete all participant data for ${tok}. Nothing is deleted yet.\n\nTo confirm, reply to the e-mail you sent with this code: ${code}\n\nIt works for 30 minutes. Not you? Ignore this e-mail.`, now);
      asked.push(tok);
    }
    if (done.length) await sendMail(env as PayEnv, env.DB, from, `Deleted: participant data of ${done.join(", ")}`, `Done. We deleted all participant data for: ${done.join(", ")}.\n\nWe keep the winners record (seat, prize, round, time) and winners' prize hand-over details for up to 365 days. We also keep your organizer details.`, now);
    return json({ ok: true, action: done.length ? "deleted" : asked.length ? "confirm-sent" : "no-match", engagements: done });
  }
  if (req.method === "GET" && p === "/api/notices") { // our public news list: the same for everyone, nothing about the reader is stored or asked
    const raw = (await env.DB.prepare("SELECT v FROM kv WHERE k='notices'").first<{ v: string }>())?.v ?? "[]";
    return new Response(JSON.stringify({ notices: (JSON.parse(raw) as any[]).filter((n) => now - (n.at ?? 0) < 30 * 86_400_000).slice(-10) }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
  }
  if (req.method === "POST" && p === "/api/notices") { // only we can publish news (platform key): up to 10 current items, each shown once per device
    if (!a.plat) return deny(a);
    const b = await body(req, 8192);
    const items = Array.isArray(b?.notices) ? b.notices : null;
    if (!items || items.length > 10 || items.some((n: any) => typeof n?.id !== "string" || !/^[A-Za-z0-9_-]{2,40}$/.test(n.id) || typeof n.title !== "string" || n.title.length < 1 || n.title.length > 80 || typeof n.body !== "string" || n.body.length > 200 || (n.url !== undefined && !(typeof n.url === "string" && /^\/[^\s]*$/.test(n.url)))))
      return json({ error: "Send up to 10 notices: {id, title (max 80), body (max 200), url (a path on this site, optional)}." }, 400);
    await env.DB.prepare("INSERT INTO kv(k,v) VALUES('notices',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(JSON.stringify(items.map((n: any) => ({ id: n.id, title: n.title, body: n.body, ...(n.url ? { url: n.url } : {}), at: now })))).run();
    return json({ ok: true, count: items.length });
  }
  if (req.method === "POST" && p === "/api/lifecycle/tick") { // run every minute by the scheduled job: reports, deletions, reminders. Idempotent and bounded per call.
    const jobKey = req.headers.get("x-cron-key") ?? "";
    const jobSecret = (env.CRON_KEY ?? "").trim(); // a secret pasted in with a trailing line break still matches
    if (!a.plat && !(jobSecret.length >= 16 && jobKey.trim() === jobSecret)) return deny(a);
    return json({ ok: true, ...(await runTick(env, now)) });
  }
  if (req.method === "POST" && p === "/api/purge") { // run daily (Cron trigger) or by hand: removes everything older than the retention period
    if (!a.plat) return deny(a);
    return json({ ok: true, purged: await purgeOld(env, now) });
  }
  { // people, links and waiting room (people.ts): one list per inviter. Organizer, Host, Co-host and a level-1 guest only; an AI key and an AI work link are refused inside.
    const pm = p.match(/^\/api\/z\/([A-Za-z0-9_-]{4,40})\/(people|waiting|me)((?:\/[A-Za-z0-9_-]+){0,2})$/);
    if (pm) {
      const pe = await env.DB.prepare("SELECT * FROM engagement WHERE id=?").bind(pm[1]!).first<any>();
      if (!pe) return json({ error: "No such game." }, 404);
      const presented = req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const isDraftP = pe.pack === 0 && !(await isPublished(env, pe));
      return peopleRoute({
        req, env, now, url, e: pe, eid: pe.id, tail: pm[2]! + pm[3]!, a, keyId7: a.kind === "host" && a.hid ? a.hid.slice(0, 7) : presented ? (await sha("key|" + presented)).slice(0, 7) : "", /* a Host keeps one list on every device (their identity, not the device key) */ viaLink: req.headers.get("x-cb-link") === "1",
        origin: (env as PayEnv).PUBLIC_ORIGIN ?? url.origin, gameName: cfgOf(pe).name || pe.id, invites: cfgOf(pe).invites ?? { on: false, per: 4, cats: [] }, started: now >= roundMs(pe.start_round) || (await tournamentStarted(env, pe.id)), draft: isDraftP, /* a tournament the host started before the planned time has started: the list is closed and a removal keeps the seat (blocked) instead of deleting it */ cancelled: !!pe.cancelled_ms || !!pe.unplayed_ms,
        json, body, spend: (n = 1) => spend(env, now, n), busy: BUSY, endBound: () => endBoundMs(env as any, pe), istTime,
        sendMail: (to, subject, text) => sendMail(env as PayEnv, env.DB, to, subject, text, now), orgEmail: async () => (await teamEmails(env as PayEnv, pe.org, pe.id)).organizer,
      });
    }
  }
  const m = p.match(/^\/api\/z\/([A-Za-z0-9_-]{4,40})\/(join|claims|settle|results|info|participants|erase|discard|reuse|roster|settings|publish|summary|announce|unbind|seats|names|mark|won|over|invites|life|vote|confirm|prizes|prizegiven|myprizes|reportlink|person|forget|cohost|cancel-preview|cancel|reopen|clone|leave|datareq|ttt|checkin|presence|who|override)(?:\/([a-z]+(?:\/[A-Za-z0-9]+)?))?$/);
  if (!m) return json({ error: "Not found", hint: "Read the list of what you can do at /api/z/ai-manifest. Game routes look like /api/z/{id}/summary, /settings, /roster, /participants, /results, /publish." }, 404);
  const [, eid, action, sub] = m;
  const e = await env.DB.prepare("SELECT * FROM engagement WHERE id=?").bind(eid).first<any>();
  if (!e) return json({ error: "No such game." }, 404);
  const digitsOf = (raw: unknown): string | null => { // a number typed with its country code (+65 ..., 0044 ...) may be as short as 8 digits in all: some countries have 5-digit numbers; a number typed without a code is 10 to 15 digits as before
    const s = String(raw ?? ""), d = s.replace(/\D/g, ""), withCode = /^\s*(\+|00)/.test(s), n = withCode && !/^(00)?91/.test(d) ? d.replace(/^00/, "") : d;
    if (n.length < (withCode ? 8 : 10) || n.length > 15) return null;
    if (withCode && !/^(00)?91/.test(n) && !knownDial(n.replace(/^00/, ""))) return null; // a +code the country list does not have
    const ind = n.length === 12 && n.startsWith("91") ? n.slice(2) : !withCode && n.length === 10 ? n : !withCode && n.length === 11 && n[0] === "0" ? n.slice(1) : null; // an Indian mobile number (typed with +91, 91, 0 or nothing in front) starts with 6, 7, 8 or 9, the same rule as a list
    return ind !== null && !/^[6-9]/.test(ind) ? null : n;
  };
  const phoneHash = async (raw: unknown): Promise<string | null> => {
    const d = digitsOf(raw);
    if (!d) return null;
    return sha(`${env.PHONE_SALT ?? env.ORGANIZER_SECRET ?? "unset"}|${d.slice(-10)}`); // +91 98765 43210, 098765 43210 and 9876543210 are the same person; one hash in every engagement so a roster can be reused without storing the number
  };
  const pidOf = async (ph: string) => (await sha(`${eid}|${ph}`)).slice(0, 16);
  const lateNow = () => { const nr = roundOfMs(now); return nr > e.start_round + GRACE_ROUNDS ? nr : 0; }; // joined after the first number: that round, else 0
  /** Gives a person a seat (and so a collision-free card) and a sealed record of their name and number. The rows go in together, with the head-count and (for a person who joins under a limited inviter: a Co-host or a level-1 guest) that inviter's list limit checked inside the insert, so a crowd arriving at the same instant can never pass a limit or share a seat. `ownerId` also puts the person on the inviter's list (people.ts); roster / reuse give none. */
  const addSeat = async (ph: string, pii: string, dev: string | null, jr: number, o: { inv?: number | null; cat?: string | null; src: string; guardId?: string | null; guardLimit?: number | null; ownerId?: string | null; role?: string | null; joinedMs?: number }) => {
    const tail = (await pidOf(ph)).slice(0, 12);
    await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO seat(eid,seq,pid,ph,dev,jr,inv,cat,src,role) SELECT ?, s, s || 'x' || ?, ?, ?, ?, ?, ?, ?, ? FROM (SELECT COALESCE(MAX(seq),0)+1 AS s FROM seat WHERE eid=?) WHERE (SELECT COUNT(*) FROM participant WHERE eid=?) < ? AND (EXISTS (SELECT 1 FROM person WHERE eid=? AND ph=? AND status='invited') OR (SELECT COUNT(*) FROM participant WHERE eid=?) + (SELECT COUNT(*) FROM person p WHERE p.eid=? AND p.status='invited' AND NOT EXISTS (SELECT 1 FROM seat s2 WHERE s2.eid=p.eid AND s2.ph=p.ph)) < ?) AND (? IS NULL OR (SELECT COUNT(*) FROM person WHERE eid=? AND inviter=? AND status<>'removed' AND role IS NULL) < ?) AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM seat WHERE eid=? AND dev=?))")
        .bind(eid, tail, ph, dev, jr, o.inv ?? null, o.cat ?? null, o.src, o.role ?? null, eid, eid, e.cap, eid, ph, eid, eid, e.cap, o.guardId ?? null, eid, o.guardId ?? null, o.guardLimit ?? 0, dev, eid, dev),
      env.DB.prepare("INSERT OR IGNORE INTO participant(eid,pid,phone_hash,name,pii,joined_ms) SELECT eid, pid, ph, NULL, ?, ? FROM seat WHERE eid=? AND ph=?").bind(pii, o.joinedMs ?? now, eid, ph),
      env.DB.prepare("UPDATE person SET status='joined', joined_ms=? WHERE eid=? AND ph=? AND status='invited' AND EXISTS (SELECT 1 FROM seat WHERE eid=? AND ph=?)").bind(now, eid, ph, eid, ph),
      env.DB.prepare("INSERT OR IGNORE INTO person(eid,id,ph,pii,inviter,role,status,added_ms,joined_ms) SELECT ?, ?, ph, ?, ?, ?, 'joined', ?, ? FROM seat WHERE eid=? AND ph=? AND ? IS NOT NULL").bind(eid, randHex(6), pii, o.ownerId ?? null, o.role ?? null, now, now, eid, ph, o.ownerId ?? null),
    ]);
  };
  const cleanName = (n: unknown) => cleanPersonName(n) || null; // the same cleaner the lists use: no control or hidden characters, nothing at the front that a spreadsheet would run as a formula

  if (a.kind === "host" && req.headers.get("x-cb-link") === "1" && !HOST_ACTIONS.has(action!)) return deny(a); // a Host's AI work link keeps its narrow rights; the Host in the console may do everything inside a game
  const unpaid = e.pack === 0;
  const freeGame = !unpaid && e.pack <= FREE_GAME_CAP; // the Rs 0 game for up to 10 people: a real game, nothing to pay
  const isDraft = unpaid && !(await isPublished(env, e));
  const payment = await paymentOf(env, e, unpaid, now);
  const cancelled = !!e.cancelled_ms; // a cancelled game can only be read (and its guests' data erased on request): nobody joins, nothing is changed, published or paid
  const didNotStart = !!e.unplayed_ms; // a game nobody paid for whose time and 23 hours went by: its guest data is erased and it is closed. Nobody joins, nobody pays; settings stay 30 days so a new game can be made like it.
  const DNS_MSG = "This game did not start. Your details have been erased.";
  if (didNotStart && req.method === "POST" && action === "join") return json({ error: DNS_MSG, code: "did-not-start", didNotStart: true }, 403);
  if (didNotStart && req.method !== "GET" && !["erase", "forget", "person", "cancel", "clone", "leave", "datareq"].includes(action!)) return json({ error: DNS_MSG, code: "did-not-start", didNotStart: true }, 409);
  if (cancelled && req.method === "POST" && action === "join") return json({ error: "This game was cancelled by the organizer.", code: "cancelled", cancelled: true }, 403);
  if (cancelled && req.method !== "GET" && !["erase", "forget", "person", "cancel", "reopen", "clone", "leave", "datareq"].includes(action!)) return json({ error: "This game was cancelled by the organizer.", code: "cancelled", cancelled: true }, 409);
  if (action === "cancel-preview" && req.method === "GET") { // what cancelling would do, and the refund in numbers: Organizer and Host only
    if (!can(a, e, true)) return deny(a);
    return json(await cancelPreview(env as PayEnv, e, now));
  }
  if (action === "cancel" && req.method === "POST") { // three confirmations in the console, three required here
    if (!can(a, e, true)) return deny(a);
    const cb = await body(req, 512);
    if (cb?.confirmations !== 3) return json({ error: "Please confirm three times to cancel the game.", code: "confirmations" }, 400);
    if (!cancelled && !(await spend(env, now, 14))) return BUSY();
    const out = await cancelGame(env as PayEnv, e, now, a.plat ? "platform" : a.kind!);
    return json(out.body, out.status);
  }
  if (action === "reopen" && req.method === "POST") { // a cancelled PAID game moved to a new date within 30 days of the cancel (cancel.ts): Organizer and Host only, never an AI key or a Co-host
    if (!can(a, e, true)) return deny(a);
    const rb = await body(req, 512);
    if (!(await spend(env, now, 14))) return BUSY();
    const out = await reopenGame(env as PayEnv, e, rb?.startRound, now, a.plat ? "platform" : a.kind!, PAID_WINDOW_MS); // a paid game: any date within 365 days of the payment (the credit's end is checked inside)
    return json(out.body, out.status);
  }
  if (action === "clone" && req.method === "POST") { // "Create a new game like this one": Organizer and Host (equal rights), never an AI key or a Co-host (clone.ts)
    if (!can(a, e, true)) return deny(a);
    return cloneGame(env, e, (await body(req, 512)) ?? {}, now, (env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin, (n) => spend(env, now, n), json);
  }
  if (action === "cohost" && req.method === "GET") { // the small game header a Co-host sees: no names, no list, no settings
    if (!a.plat && !(a.org && a.org === e.org)) return deny(a);
    if (a.kind === "cohost" && a.eid && a.eid !== e.id) return json({ error: "Your Co-host link is for a different game." }, 403); // a Co-host belongs to one game
    const kid = a.kind === "cohost" ? (await sha("key|" + (req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")))).slice(0, 7) : null;
    const c = cfgOf(e), origin = (env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin;
    const joined = (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 0;
    const pk = unpaid ? PACKS.find((x) => x[0] >= e.cap)?.[0] ?? null : PACKS.some((x) => x[0] === e.pack) ? e.pack : null; // a Rs 0 (or free-launch) game is "paid" with its own size, which is no price list entry
    const lockedC = unpaid && !isDraft && !cancelled && !e.unplayed_ms && roundMs(e.start_round) - LOCK_LEAD_MS <= now;
    return json({ name: c.name || e.id, ...(freeGame ? { rs0: true } : {}), startMs: roundMs(e.start_round), cap: e.cap, joined, brought: await broughtBy(env, e.org, kid), price: pk ? price(pk, "INR").total : null, payment, ...(cancelled ? { cancelled: true } : {}), waitingFor: lockedC ? "organizer" : null, didNotStart: !!e.unplayed_ms, erasureMs: await erasureOf(env, e), ...(await creditFields(env, a, e, unpaid && !cancelled && !e.unplayed_ms, now)), inviteLink: kid && !isDraft && !cancelled ? `${origin}/z.html?e=${e.id}&from=${COHOST_FROM + parseInt(kid, 16)}` : null });
  }
  const locked = unpaid && !isDraft && !cancelled && !didNotStart && roundMs(e.start_round) - LOCK_LEAD_MS <= now; // published but not paid by its start time: it does not begin
  if (isDraft && (((action === "join" || action === "who") && req.method === "POST") || (action === "info" && !can(a, e)))) return json({ error: "This game is not open yet." }, 403);
  if (locked && !can(a, e) && (action === "info" || action === "join")) await nudge(env, e.id, "lockmail", now, `Your game ${e.id} could not begin: payment is due`, `Your game ${e.id} could not begin: payment is due.\n\nPay now and the game opens 2 minutes after your payment is confirmed: ${(env as PayEnv).PUBLIC_ORIGIN ?? ""}/pay.html?e=${e.id}`);
  if (action === "who" && req.method === "POST") { // "Is this you?": once the employee ID is typed and both boxes are ticked, the first name and the first letter of the last name the organizer gave, so the person sees the name that will be used. Nothing is kept; a wrong ID counts like a wrong ID at the door.
    const b = await body(req), vf = verifyOf(e), id = normEmp(b?.empId);
    if (vf.mode === "mobile" || !id) return json({ known: false });
    const ck = consentMissing(b, "K4"); if (ck) return ck;
    const eh = await empHashOf(env, id);
    let hit = await personByPhone(env, eid!, eh);
    if (!hit) { const al = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`idx/${eid}/${eh}`).first<{ v: string }>(); if (al) hit = await personByPhone(env, eid!, al.v); }
    if (!hit || hit.status === "removed") {
      try {
        const ipk = (await sha("jip|" + (req.headers.get("cf-connecting-ip") ?? "local"))).slice(0, 16), k = `idmiss/${eid}/${new Date(now).toISOString().slice(0, 15)}/${ipk}`;
        const n = Number((await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first<{ v: string }>())?.v ?? 0);
        if (n >= ID_MISS_PER_10MIN) return json({ error: "Too many tries with an employee ID that is not on the list. Please ask your organizer for help.", code: "too-many-tries" }, 429);
        await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(n + 1)).run();
      } catch { /* a counter never blocks */ }
      return json({ known: false });
    }
    const nm = ((await openPii(env, hit.pii))?.name ?? "").trim().split(/\s+/);
    return json({ known: true, name: nm[0] ? (nm.length > 1 ? `${nm[0]} ${Array.from(nm[nm.length - 1]!)[0]}.` : nm[0]) : "" });
  }
  if (action === "ttt") { // the tournament (tournament.ts): view and rank are public, me and move belong to a player, start / pause / resume to the Organizer or a Host
    const gate = cancelled ? json({ error: "This game was cancelled by the organizer.", code: "cancelled", cancelled: true }, 409) : didNotStart ? json({ error: DNS_MSG, code: "did-not-start", didNotStart: true }, 409) : isDraft && !can(a, e) ? json({ error: "This game is not open yet." }, 403) : locked && !can(a, e) ? json({ error: "This game is waiting for the organizer's payment.", code: "payment-due", waitingFor: "organizer" }, 402) : null;
    if (!sub) return json({ error: "Not found" }, 404);
    return tttRoute({ env, req, now, eid: eid!, e, sub, url: new URL(req.url), body, spend, allowed: can(a, e, true), openName: async (pii) => (await openPii(env, pii))?.name ?? null, gate, BUSY });
  }
  if (action === "join" && req.method === "POST") {
    const b = await body(req);
    { const mt = consentRequired(b, "K4"); if (mt) return mt; } // K4: the 24-hour notice (with the invite chain) and the 18+ box, ticked BEFORE a name or number is used
    // a personal link (/j/<token>) stands for one listed person: their number is then not typed at all. The strong proof is the secret in the link, a typed number is only matched to a list.
    let tok: PersonRow | null = null, tokPii: { phone: string; name: string | null } | null = null;
    if (typeof b?.token === "string" && b.token) {
      tok = await personByToken(env, eid!, b.token);
      if (!tok || tok.status === "removed") return json({ error: "This link is not valid any more. Please ask the person who invited you to send it again.", code: "link-gone" }, 404);
      tokPii = await openPii(env, tok.pii);
    }
    const typedGiven = typeof b?.phone === "string" ? b.phone.trim() !== "" : b?.phone != null;
    let typedDigits = digitsOf(b?.phone), typedPh = await phoneHash(b?.phone);
    if (typedDigits) typedDigits = keptPhone(b?.phone); // kept with its country: 91 + 10 digits for India, +<code><number> for any other country
    if (typedGiven && !typedPh) return json({ error: "Enter a valid mobile number." }, 400);
    // What the organizer asked people to give: a mobile number (default), an employee ID, or both. An outsider (a vendor, a customer, a family member) has no ID and gives a mobile number.
    const vf = verifyOf(e), empNorm = normEmp(b?.empId);
    if (empNorm === null) return json({ error: "An employee ID has letters and numbers only.", code: "bad-id" }, 400);
    const dev = typeof b?.device === "string" && /^[0-9a-f]{16,64}$/.test(b.device) ? (await sha(`dev|${eid}|${b.device}`)).slice(0, 32) : null; // one card, one device: the phone's own random id, only its hash is kept
    if (vf.employeesOnly && vf.mode !== "mobile" && vf.mode !== "either" && !empNorm && !tok) return json({ error: vf.mode === "id" ? "Enter your employee ID." : "Enter your employee ID and your mobile number.", code: "need-id" }, 400);
    if (vf.employeesOnly && vf.mode === "either" && !empNorm && !typedGiven && !tok) return json({ error: "Enter your mobile number or your employee ID.", code: "need-id" }, 400);
    let extraDigits: string | null = null, idHit = false; // a mobile number given together with an employee ID that is on the list: kept as the person's contact, never a reason to refuse
    if ((vf.mode === "either" || vf.mode === "id") && empNorm && !tok) { // "mobile number or employee ID" (and ID alone): an ID on the list is as good as the listed mobile number (the person is then known by their listed number)
      const eh = await empHashOf(env, empNorm);
      let hit = await personByPhone(env, eid!, eh);
      if (!hit) { const al = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`idx/${eid}/${eh}`).first<{ v: string }>(); if (al) hit = await personByPhone(env, eid!, al.v); }
      if (hit) { tok = hit; tokPii = await openPii(env, hit.pii); extraDigits = typedDigits; idHit = true; typedPh = null; typedDigits = null; }
    }
    const idOnly = (vf.mode === "id" || vf.mode === "either") && !!empNorm && !typedGiven && !tok; // known by employee ID alone
    let digits = typedDigits ?? tokPii?.phone ?? (idOnly ? "" : null);
    if (vf.mode === "both" && empNorm && !tok && !typedGiven) return json({ error: "Enter your employee ID and your mobile number.", code: "need-id" }, 400);
    let nameOnly = false;
    if (vf.mode !== "mobile" && !empNorm && !typedGiven && !tok) return json({ error: vf.mode === "either" ? "Enter your mobile number or your employee ID." : vf.mode === "id" ? "Enter your employee ID, or your mobile number if you have no employee ID." : "Enter your employee ID and your mobile number.", code: "need-id" }, 400); // the name alone is not enough when the organizer asked for IDs
    let ph = idOnly ? await empHashOf(env, empNorm) : typedPh ?? tok?.ph ?? null;
    if (!ph && !tok && !typedGiven && !empNorm && !vf.employeesOnly && vf.mode === "mobile" && cfgOf(e).join !== "phone") { // joining with a name only (the default for the common link): the guest is known by their name, and their phone by its own random id
      const typedName = cleanName(b?.name)?.replace(/\s+/g, " ").trim() ?? "";
      if (typedName.length < 2) return json({ error: "Please type your name." }, 400);
      if (!dev) return json({ error: "Please refresh this page and try again." }, 400);
      ph = await sha(`nm|${eid}|${dev}`); digits = ""; nameOnly = true;
    }
    if (!ph || (!digits && !idOnly && !nameOnly && !((vf.mode === "id" || vf.mode === "either") && tokPii))) return json({ error: vf.mode === "id" ? "Enter your employee ID, or your mobile number if you have no employee ID." : vf.mode === "either" ? "Enter your mobile number or your employee ID." : "Enter a valid mobile number." }, 400);
    const ck = consentMissing(b, "K4"); // K4: both boxes, checked on the server before any name or number is kept
    const k4 = (subject: string) => recordConsent(env.DB, { subject, kind: "K4", ref: eid!, now });
    const otherNumber = !!(tok && typedPh && typedPh !== tok.ph); // somebody else opened this person's link
    const reply = (pid: string, extra: object = {}) => json({ pid, startRound: e.start_round, callSeconds: e.call_seconds, trackClaims: tracks(e), ...pub(e), ...extra });
    const lateRound = lateNow();
    const have = await env.DB.prepare("SELECT p.pid AS pid, s.dev AS dev, s.pid AS seat, s.jr AS jr, s.blocked AS blocked, s.role AS role FROM participant p LEFT JOIN seat s ON s.eid=p.eid AND s.pid=p.pid WHERE p.eid=? AND p.phone_hash=?").bind(eid, ph).first<{ pid: string; dev: string | null; seat: string | null; jr: number | null; blocked: number | null; role: string | null }>();
    const removedReply = () => json({ error: "You were removed from this game by the organizer.", code: "removed", removed: true }, 403);
    if (have) {
      if (have.blocked) return removedReply();
      if (have.seat && have.dev && have.dev !== dev) {
        if (idHit) return json({ error: "This employee ID already has a place on another phone. A place plays on one phone only. If it is you on a new phone, ask your organizer to move your place to this phone.", code: "id-used" }, 423);
        if (tok && !typedPh) return json({ error: "This link was already opened on another phone. If you are someone else, type your own mobile number to ask to join. If it is you on a new phone, ask whoever invited you to send the link again.", code: "link-used", needPhone: true }, 423);
        return json({ error: "This place was opened in a different browser or app (or on another phone). A place plays on one device only. Open your link in the same browser or app you used first. If you cannot, ask your organizer to move your place to this phone.", code: "other-phone" }, 423);
      }
      if (have.seat && !have.dev && dev && (await env.DB.prepare("SELECT 1 AS x FROM seat WHERE eid=? AND dev=?").bind(eid, dev).first())) return json({ error: "This phone already holds a place in this game. One phone, one place. Ask the person to open the link on their own phone.", code: "device-used" }, 409);
      if (have.seat && !have.dev && !dev) return json({ error: "Please refresh this page and try again." }, 400); // an unbound place is handed over only to a phone that proves its device, like a new person
      if (have.seat && !have.dev && dev) { // first device to open the link of someone who was on the list (or whom the organizer let move) keeps the card
        if (!(await spend(env, now, 2))) return BUSY();
        await env.DB.batch([env.DB.prepare("UPDATE seat SET dev=? WHERE eid=? AND pid=? AND dev IS NULL").bind(dev, eid, have.pid), env.DB.prepare("UPDATE participant SET joined_ms=? WHERE eid=? AND pid=? AND joined_ms<?").bind(now, eid, have.pid, now), env.DB.prepare("UPDATE person SET status='joined', joined_ms=? WHERE eid=? AND ph=? AND status='invited'").bind(now, eid, ph)]);
        const nm = cleanName(b?.name);
        if (nm) { const old = await env.DB.prepare("SELECT pii FROM participant WHERE eid=? AND pid=?").bind(eid, have.pid).first<{ pii: string | null }>(); const o = await openPii(env, old?.pii); if (o && !o.name) await env.DB.prepare("UPDATE participant SET pii=? WHERE eid=? AND pid=?").bind(await sealPii(env, { phone: o.phone, name: nm, ...(o.empId ? { empId: o.empId } : {}) }), eid, have.pid).run(); }
      }
      return reply(have.pid, { again: true, jr: have.jr ?? 0, ...(have.role ? { role: have.role } : {}) }); // same number twice = same participant
    }
    // A NEW person cannot take a place when the game could not begin because payment is due (a person who already holds a card is handled above and keeps it).
    // (A person who opens the link AFTER the game is over still gets a card: the page then shows "Game complete", the thank-you and the share button. That is designed, so there is no "ended" refusal here.)
    if (locked) return json({ error: "This game could not begin because the organizer's payment is not complete. Please ask your organizer.", code: "locked" }, 403);
    let pr = await personByPhone(env, eid!, ph); // is this number (or employee ID) on any list of the game?
    const admitted = vf.mode !== "mobile" && !!pr && !!(await env.DB.prepare("SELECT 1 AS x FROM waiting WHERE eid=? AND ph=? AND status='admitted'").bind(eid, ph).first()); // the organizer already said yes to this person: the ID typed is not checked again, or they would wait for ever
    let idMiss = false, needIdAfterConsent = false; // an employee ID that does not match the list: the organizer decides
    if (vf.mode !== "mobile" && empNorm && !tok && !admitted) {
      if (vf.mode === "both") { const pp0 = pr ? await openPii(env, pr.pii) : null; if (!pr || (pp0?.empId && pp0.empId !== empNorm)) { pr = null; idMiss = true; } }
      else if (!pr) idMiss = true; // ID alone, not on the list
      if (idMiss) { // guessing IDs: only so many wrong IDs per network per game per 10 minutes
        try {
          const ipk = (await sha("jip|" + (req.headers.get("cf-connecting-ip") ?? "local"))).slice(0, 16), k = `idmiss/${eid}/${new Date(now).toISOString().slice(0, 15)}/${ipk}`;
          const n = Number((await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(k).first<{ v: string }>())?.v ?? 0);
          if (n >= ID_MISS_PER_10MIN) return json({ error: "Too many tries with an employee ID that is not on the list. Please ask your organizer for help.", code: "too-many-tries" }, 429);
          await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(n + 1)).run();
        } catch { /* a counter never blocks a join */ }
      }
    } else if (vf.mode === "both" && pr && !tok && !admitted) { const pp0 = await openPii(env, pr.pii); if (pp0?.empId) needIdAfterConsent = true; } // asked only after the consent box is ticked: an untick-and-ask cannot be used to find out who is on the list
    if (pr?.status === "removed") return removedReply();
    const tickedBefore = !!(await env.DB.prepare("SELECT 1 AS x FROM consent_log WHERE kind='K4' AND ref=? AND subject=?").bind(eid, await pidOf(ph)).first()); // ticked when they asked to come in; the page does not keep it across a reload
    if (ck && !tickedBefore) return ck;
    if (needIdAfterConsent) return json({ error: "Enter your employee ID.", code: "need-id" }, 400);
    if (!dev) return json({ error: "Please refresh this page and try again." }, 400);
    if (await env.DB.prepare("SELECT 1 AS x FROM seat WHERE eid=? AND dev=?").bind(eid, dev).first()) return json({ error: "This phone already holds a place in this game. One phone, one place. Others can join from their own phones.", code: "device-used" }, 409);
    if (await tournamentStarted(env, eid!)) return json({ error: "The tournament has started and the list is closed. You can still watch it.", code: "closed", spectator: true }, 409);
    const n = await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>();
    if ((n?.c ?? 0) >= e.cap) return json({ error: "This game is full." }, 409);
    await ensureT(env, eid!); // the sealed fingerprint of the draw exists before anybody has joined
    // who owns the link this person came through? Only used when they are on no list.
    const inviteCfg = cfgOf(e).invites;
    let owner: string | null = null, cat: string | null = null;
    const fo = parseFrom(b?.from);
    if (otherNumber) owner = tok!.inviter; // a different number on a personal link asks the link owner's chain
    else if (fo?.kind === "org" && e.org) owner = "o";
    else if ((fo?.kind === "host" || fo?.kind === "cohost") && e.org) { // a Host's or a Co-host's own common link
      if (await env.DB.prepare("SELECT 1 AS x FROM organizer_key WHERE org=? AND kind=? AND revoked=0 AND (eid IS NULL OR eid=?) AND substr(hash,1,7)=?").bind(e.org, fo.kind, e.id, fo.hex).first()) owner = inviterOf(fo);
    } else if (fo?.kind === "guest" && inviteCfg?.on) { // a level-1 guest's common link, only while the organizer allows guest invitations
      const inviter = await env.DB.prepare("SELECT seq, role, inv, blocked FROM seat WHERE eid=? AND seq=?").bind(eid, fo.seq).first<{ seq: number; role: string | null; inv: number | null; blocked: number | null }>();
      // only two levels: a person who was themselves invited by a participant cannot invite; their link still lets the guest in, but records no inviter
      if (inviter && !inviter.blocked && (inviter.role || inviter.inv === null)) { owner = "s:" + inviter.seq; cat = typeof b?.cat === "string" && inviteCfg.cats.includes(b.cat) ? b.cat : null; }
    }
    const via = otherNumber ? "personal-link" : fo ? "common-link" : "direct";
    const target = owner ?? "o";
    const lateName = cleanName(b?.name);
    const wait = async (overlimit: boolean, limit: number | null) => { // the waiting room: no place is used while someone waits
      if (await joinOverLimit(env, req, now)) return json({ error: "It is busy right now. Please try again in a few minutes.", code: "busy" }, 429);
      if (!(await spend(env, now, 2))) return json({ error: "It is very busy right now. Please try again in a few minutes.", code: "busy" }, 503);
      const w = await addWaiting({ env, eid: eid!, e, now }, { ph, digits: digits ?? "", empId: empNorm || null, name: lateName || tokPii?.name || null, via, inviter: target, overlimit });
      if ("full" in w) return json({ error: "Many people are waiting for an answer right now. Please try again a little later.", code: "waiting-full" }, 429);
      if (w.status === "declined") return json({ error: "This game could not add you. Please talk to whoever invited you.", code: "declined", declined: true, wid: w.id }, 403);
      const who = await waitingWho({ env, e, eid: eid! }, overlimit ? "o" : target);
      const msg = `Your request is with ${who}. You can come in as soon as they say yes.`;
      return overlimit
        ? json({ error: `This invitation has already been used by ${limit} people, which is the most one person can invite. ${msg}`, code: "invite-full", waiting: true, wid: w.id, with: who }, 409)
        : json({ error: `This game is by invitation. ${msg}`, code: "waiting", waiting: true, wid: w.id, with: who }, 403);
    };
    let inviter: string | null = null, role: string | null = null, guardId: string | null = null, guardLimit: number | null = null, pii: string;
    if (pr) { inviter = pr.inviter; role = pr.role; const pp = await openPii(env, pr.pii); digits = pp?.phone || digits; const addName = !!(lateName && pp && !pp.name), addPhone = !!(extraDigits && pp && !pp.phone); pii = addName || addPhone ? await sealPii(env, { phone: addPhone ? extraDigits! : pp!.phone, name: addName ? lateName : pp!.name, ...(pp!.empId ? { empId: pp!.empId } : {}) }) : pr.pii; }
    else {
      if (e.closed || idMiss) return wait(false, null); // "Only people on a list" (or an employee ID not on the list): the person waits for an answer
      const limit = await limitOfInviter({ env, eid: eid!, e, invites: inviteCfg ?? { on: false, per: 4 } }, target);
      if (limit !== null && (await listCount(env.DB, eid!, target)) >= limit) return wait(true, limit);
      inviter = target; if (limit !== null) { guardId = target; guardLimit = limit; }
      pii = await sealPii(env, { phone: digits ?? "", name: lateName || tokPii?.name || null, empId: vf.mode !== "mobile" && empNorm ? empNorm : null });
    }
    if (await joinOverLimit(env, req, now, e.pack ?? 0)) return json({ error: "It is busy right now. Please try again in a few minutes.", code: "busy" }, 429);
    if (!(await spend(env, now, JOIN_WRITES))) return json({ error: "It is very busy right now. Please try again in a few minutes.", code: "busy" }, 503);
    const inv = inviter.startsWith("s:") ? Number(inviter.slice(2)) : null;
    await addSeat(ph, pii, dev, lateRound, { inv, cat: inv !== null ? cat : null, src: srcOf(inviter), ownerId: inviter, guardId, guardLimit, role });
    const row = await env.DB.prepare("SELECT p.pid AS pid, s.dev AS dev, s.jr AS jr, s.role AS role FROM participant p LEFT JOIN seat s ON s.eid=p.eid AND s.pid=p.pid WHERE p.eid=? AND p.phone_hash=?").bind(eid, ph).first<{ pid: string; dev: string | null; jr: number | null; role: string | null }>();
    if (!row) return (await env.DB.prepare("SELECT 1 AS x FROM seat WHERE eid=? AND dev=?").bind(eid, dev).first()) ? json({ error: "This phone already holds a place in this game. One phone, one place.", code: "device-used" }, 409) : guardId !== null ? wait(true, guardLimit) : json({ error: "This game is full." }, 409); // lost a race for the last place
    if (row.dev && row.dev !== dev) return json({ error: "This place was opened in a different browser or app (or on another phone). A place plays on one device only. Open your link in the same browser or app you used first. If you cannot, ask your organizer to move your place to this phone.", code: "other-phone" }, 423);
    if (!ck) await k4(row.pid);
    return reply(row.pid, { jr: row.jr ?? 0, ...(row.role ? { role: row.role } : {}) });
  }
  if ((action === "leave" || action === "datareq") && req.method === "POST") { // a player's own rights (rights.ts): leave at any time, and "what do you hold about me / correct / delete me"; the player's card id AND their phone's own device id are the proof
    const rc = { env: env as PayEnv, db: env.DB, e, eid: eid!, now, started: await tournamentStarted(env, eid!), // the tournament begins when the Organizer or a Host starts it (tournament.ts), not at a clock time
      extraLeave: (x: string, pid: string) => [env.DB.prepare("UPDATE ttt_p SET name='Left player' WHERE eid=? AND pid=?").bind(x, pid), env.DB.prepare("UPDATE ttt_e SET name='Left player' WHERE eid=? AND members=?").bind(x, JSON.stringify([pid]))], // the draw lists the player by id; the name goes, the place stays (a team keeps its team name)
      b: await body(req, 2_048), json, gameName: cfgOf(e).name || e.id, orgEmail: async () => (await teamEmails(env as PayEnv, e.org, e.id)).organizer, erasureMs: () => erasureOf(env, e), spend: (n: number) => spend(env, now, n) };
    return action === "leave" ? leaveRoute(rc) : requestRoute(rc);
  }
  if (action === "seats" && req.method === "GET") {
    // Public: seat number, participant id and join round of everyone who joined (no names, no phone numbers). Every phone reads this to work out the winners itself.
    // The first answer after the game began is saved once as one stored text (so 10,000 phones read one row, not 10,000), and later joiners come as a small tail.
    if (isDraft) return json({ error: "This game is not open yet." }, 403);
    if (now < roundMs(e.start_round + GRACE_ROUNDS)) return json({ ready: false });
    const after = Math.max(0, Math.floor(Number(url.searchParams.get("after")) || 0));
    const key = `seats-base/${eid}`;
    let base = (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(key).first<{ v: string }>())?.v ?? null;
    let n = base ? Number(base.slice(base.lastIndexOf('"upto":') + 7, -1)) : 0;
    if (!base) {
      const rows = (await env.DB.prepare("SELECT seq, pid, COALESCE(jr,0) AS jr, CASE WHEN role IS NULL THEN 0 ELSE 1 END AS ex FROM seat WHERE eid=? ORDER BY seq").bind(eid).all<{ seq: number; pid: string; jr: number; ex: number }>()).results ?? [];
      n = rows.length ? rows[rows.length - 1]!.seq : 0;
      base = `{"ready":true,"seats":[${rows.map((r) => `[${r.seq},"${r.pid}",${r.jr},${r.ex}]`).join(",")}],"upto":${n}}`;
      if (await spend(env, now)) await env.DB.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)").bind(key, base).run();
    }
    const blk = (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`seats-blk/${eid}`).first<{ v: string }>())?.v ?? "[]"; // removed seats: still listed, never a winner of Unlucky
    if (after < n) return new Response(base.slice(0, -1) + `,"blk":${blk}}`, { headers: { "content-type": "application/json", "cache-control": "public, max-age=20" } }); // the saved text as it is: nothing to parse
    const rows = (await env.DB.prepare("SELECT seq, pid, COALESCE(jr,0) AS jr, CASE WHEN role IS NULL THEN 0 ELSE 1 END AS ex FROM seat WHERE eid=? AND seq>? ORDER BY seq LIMIT 2000").bind(eid, after).all<{ seq: number; pid: string; jr: number; ex: number }>()).results ?? [];
    return json({ ready: true, seats: rows.map((r) => [r.seq, r.pid, r.jr, r.ex]), upto: rows.length ? rows[rows.length - 1]!.seq : after, blk: JSON.parse(blk) });
  }
  if ((action === "person" || action === "forget") && req.method === "POST") { // a participant asks the organizer to see, or to delete, their own data: the organizer does it in the console (never an AI)
    if (!can(a, e, true)) return deny(a);
    const b = await body(req);
    const seatNo = Number.isInteger(b?.seat) && b.seat > 0 ? (b.seat as number) : 0; // a guest who joined with a name only has no number: the console names the card by its number
    const ph = seatNo ? "" : await phoneHash(b?.phone);
    if (!seatNo && !ph) return json({ error: "Enter a valid mobile number or the seat number." }, 400);
    const seat = seatNo ? await env.DB.prepare("SELECT seq, pid, role FROM seat WHERE eid=? AND seq=?").bind(eid, seatNo).first<{ seq: number; pid: string; role: string | null }>() : await env.DB.prepare("SELECT seq, pid, role FROM seat WHERE eid=? AND ph=?").bind(eid, ph).first<{ seq: number; pid: string; role: string | null }>();
    if (!seat) return json({ error: seatNo ? "That seat number has not joined this game." : "That number has not joined this game." }, 404);
    if (action === "person") {
      const row = await env.DB.prepare("SELECT pii FROM participant WHERE eid=? AND pid=?").bind(eid, seat.pid).first<{ pii: string | null }>();
      const who = await openPii(env as any, row?.pii);
      return json({ ok: true, seat: seat.seq, name: who?.name ?? "", role: seat.role ?? "" });
    }
    const running = now >= roundMs(e.start_round) && now < (await endBoundMs(env as any, e));
    if (running) return json({ error: "The game is running. Please delete this person after it ends." }, 409);
    if (!(await spend(env, now, 4))) return BUSY();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM participant WHERE eid=? AND pid=?").bind(eid, seat.pid), env.DB.prepare("DELETE FROM seat WHERE eid=? AND seq=?").bind(eid, seat.seq),
      env.DB.prepare("DELETE FROM claim WHERE eid=? AND pid=?").bind(eid, seat.pid),
      env.DB.prepare("UPDATE prize SET pii=NULL, orig=NULL, trail=NULL WHERE eid=? AND seat=?").bind(eid, seat.seq), // the prize record keeps no identity once the person asks
    ]);
    return json({ ok: true, deleted: true });
  }
  if (action === "unbind" && req.method === "POST") { // the organizer (or their AI) lets one person move their card to a new phone: the first device that comes back keeps it
    if (!canAi(a, e)) return deny(a);
    const b = await body(req);
    const seatNo = Number.isInteger(b?.seat) && b.seat > 0 ? (b.seat as number) : 0;
    if (a.kind === "ai" && !seatNo) return CONSOLE_ONLY(); // an AI names the card by its number, never by a mobile number
    const ph = seatNo ? "" : await phoneHash(b?.phone);
    if (!seatNo && !ph) return json({ error: "Enter a valid mobile number." }, 400);
    if (!(await spend(env, now))) return BUSY();
    const r = seatNo ? await env.DB.prepare("UPDATE seat SET dev=NULL WHERE eid=? AND seq=?").bind(eid, seatNo).run() : await env.DB.prepare("UPDATE seat SET dev=NULL WHERE eid=? AND ph=?").bind(eid, ph).run();
    return (r.meta?.changes ?? 0) > 0 ? json({ ok: true }) : json({ error: "That number has not joined this game." }, 404);
  }
  if (action === "claims" && req.method === "POST") {
    const b = await body(req);
    const list = Array.isArray(b?.claims) ? b.claims.slice(0, 7) : null;
    if (!b || typeof b.pid !== "string" || !list) return json({ error: "Bad claim." }, 400);
    const who = await env.DB.prepare("SELECT p.pid AS pid, s.blocked AS blocked FROM participant p LEFT JOIN seat s ON s.eid=p.eid AND s.pid=p.pid WHERE p.eid=? AND p.pid=?").bind(eid, b.pid).first<{ pid: string; blocked: number | null }>();
    if (!who) return json({ error: "Not a participant of this game." }, 403);
    if (who.blocked) return json({ error: "You were removed from this game by the organizer.", code: "removed", removed: true }, 403); // the seat stays in the public list, the phone stops
    if (checkinRequired(e)) { const st = seatOfPidText(b.pid); if (!st || (await presentMsOf(env.DB, eid!, st)) === null) return json({ error: "Mark yourself present first: the check-in is on your card page.", code: "not-present" }, 403); } if (checkinRequired(e) && !(await deviceMatches(env, eid!, b.pid, b.device))) return json({ error: "This card belongs to another phone.", code: "other-phone" }, 403); // the participant id is public: only the card's own phone may act for it
    // only a person who checked in can win
    if (!tracks(e)) return json({ ok: true, stored: 0, tracked: false }); // large engagement: winners are worked out from the public numbers, nothing is stored per claim
    let stored = 0;
    const maxRound = cfgOf(e).rounds;
    for (const c of list) {
      const round = c?.round === undefined ? 1 : c.round;
      if (!PATTERNS.has(c?.pattern) || !Number.isInteger(c?.idx) || c.idx < 0 || c.idx > 74 || !Number.isInteger(round) || round < 1 || round > maxRound) continue;
      if (!(await spend(env, now))) return json({ error: "Busy day. Your claim is kept on your phone and will be sent again.", stored }, 503);
      const r = await env.DB.prepare("INSERT OR IGNORE INTO claim(eid,pid,pattern,round,idx,at_ms) VALUES(?,?,?,?,?,?)").bind(eid, b.pid, c.pattern, round, c.idx, now).run();
      stored += r.meta?.changes ?? 0; // a claim sent twice is stored once
    }
    return json({ ok: true, stored });
  }
  if (action === "results" && req.method === "GET") {
    const r = await env.DB.prepare("SELECT pattern,ordinal,round,idx,pids FROM settled WHERE eid=? ORDER BY round, pattern, ordinal").bind(eid).all<any>();
    // public: counts only, no ids. The exceptions are a lucky draw and Unlucky, whose winners are shown by their opaque card ids so each phone can tell whether it won
    return json({ results: (r.results ?? []).map((x: any) => ({ pattern: x.pattern, ordinal: x.ordinal, round: x.round, idx: x.idx, count: JSON.parse(x.pids).length, ...(JSON.parse(x.pids).length ? { winners: JSON.parse(x.pids) } : {}) })) });
  }
  if (action === "info" && req.method === "GET") return json({ ...(cancelled ? { cancelled: true, message: "This game was cancelled by the organizer.", cancelledMs: e.cancelled_ms } : {}), ...(didNotStart ? { message: DNS_MSG } : {}), ...(isDraft ? { draft: true } : {}), ...(freeGame ? { rs0: true } : {}), ...(unpaid && !isDraft ? { ...(can(a, e) ? { unpaid: true } : {}), locked } : {}),
    waitingFor: locked ? "organizer" : null, didNotStart, erasureMs: await erasureOf(env, e), ...(await creditFields(env, a, e, unpaid && !cancelled && !didNotStart, now)), startMs: roundMs(e.start_round), cap: e.cap, startRound: e.start_round, callSeconds: e.call_seconds, trackClaims: tracks(e), controlUrl: controlUrl(env, e.id), whoCanJoin: e.closed ? "list" : "anyone", ...pub(e, true) });

  // everything below is for the organizer (or their AI, where allowed)
  if (action === "announce" && req.method === "POST") { // a message to every phone and the big screen. Organizer, their AI or a co-host; never a stranger
    if (!can(a, e)) return deny(a);
    if (isDraft) return json({ error: "Publish the game first. Nobody can see a draft." }, 400);
    const b = await body(req, 2_048);
    const text = typeof b?.text === "string" ? b.text.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim() : null;
    if (text === null) return json({ error: "Write the message to send." }, 400);
    if (text.length > 160) return json({ error: `A message can be at most 160 characters. Yours has ${text.length}. Please shorten it.`, code: "too-long" }, 400); // refused, not silently cut: guests would read half a sentence
    const last = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`ann/${eid}`).first<{ v: string }>();
    if (last && now - (JSON.parse(last.v).at ?? 0) < 5_000) return json({ error: "Please wait a few seconds before sending another message." }, 429);
    if (!(await spend(env, now))) return BUSY();
    if (!text) { await env.DB.prepare("DELETE FROM kv WHERE k=?").bind(`ann/${eid}`).run(); return json({ ok: true, cleared: true }); }
    const ann = { id: randHex(4), text, at: now };
    await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`ann/${eid}`, JSON.stringify(ann)).run();
    return json({ ok: true, sent: ann, reachesPhonesWithin: "about a minute, on games with pause available" });
  }
  if (action === "summary" && req.method === "GET") { // one read-back of everything saved, so the organizer's AI can confirm it with them
    if (!can(a, e)) return deny(a);
    const n = (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 0;
    const c = cfgOf(e), origin = (env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin;
    const links = { console: `${origin}/zc.html?e=${e.id}`, ...(isDraft ? { publishHandover: `${origin}/zc.html?e=${e.id}&do=publish` } : { guest: `${origin}/z.html?e=${e.id}`, bigScreen: `${origin}/big.html?e=${e.id}` }), ...(unpaid && !isDraft ? { pay: `${origin}/pay.html?e=${e.id}` } : {}), testBrandMoment: `${origin}/preview.html`, demo: `${origin}/demo.html` };
    const nextSteps = [
      { step: "Name the prizes", who: "the organizer, or the AI if told what each prize is", done: c.rewards.some((r) => r.text.length > 0) },
      { step: "Publish (free): the organizer confirms their e-mail and mobile and taps once", who: "the organizer", done: !isDraft, ...(isDraft ? { link: `${origin}/zc.html?e=${e.id}&do=publish` } : {}) },
      { step: "Pay (the game does not begin until it is paid)", who: "the organizer, a Host or a Co-host", done: !isDraft && !unpaid, ...(unpaid && !isDraft ? { link: links.pay, startsAt: istTime(roundMs(e.start_round), tzOfRow(e)), canPayUntil: istTime(await erasureOf(env, e), tzOfRow(e)) } : {}) },
      { step: "Share the guest link and load the guest list", who: "the organizer", done: n > 0 },
    ];
    const cpv = cancelled ? await cancelPreview(env as PayEnv, e, now) : null; // what a cancelled game left in the account (credit, never a refund)
    const startPending = !!(await env.DB.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`startpending/${e.id}`).first());
    const creditNow = mayPay(a, e) && unpaid && !cancelled && !didNotStart ? await activeCreditSummary(env.DB, e.org!, now) : null;
    return json({ id: e.id, ...(cancelled ? { cancelled: true, cancelledMs: e.cancelled_ms, cancelledBy: e.cancelled_by, cancelCredit: cpv?.credit ?? null, ...(cpv && e.pack !== 0 ? { rescheduleUntilMs: cpv.rescheduleUntilMs, canReschedule: cpv.canReschedule } : {}) } : {}),
      waitingFor: locked ? "organizer" : null, didNotStart, erasureMs: await erasureOf(env, e), ...(startPending ? { startPending: true } : {}),
      credit: creditNow ? creditNow.activeTotalInr : null, creditExpiresMs: creditNow ? creditNow.nextExpiryMs : null, creditApplied: creditNow ? await creditAppliedFor(env.DB, e.id) : null,
      status: didNotStart ? "did not start (closed)" : cancelled ? "cancelled by the organizer" : isDraft ? "draft" : unpaid ? (locked ? "published, NOT PAID, held because the start time passed" : "published, payment due before the start") : "published and paid",
      startsAtIST: istTime(roundMs(e.start_round), tzOfRow(e)), tz: tzOfRow(e), startMs: roundMs(e.start_round), startRound: e.start_round, callSeconds: e.call_seconds, limit: e.cap, closed: !!e.closed, whoCanJoin: e.closed ? "list" : "anyone", coHostLimit: e.cohost_limit ?? COHOST_LIMIT_DEFAULT, guestInvites: cfgOf(e).invites, verify: c.verify ?? "mobile", employeesOnly: !!c.employeesOnly,
      tickets: c.tickets, rounds: c.rounds, rewards: c.rewards, breaks: c.breaks, opening: c.opening, closing: c.closing, invites: c.invites, brandMomentsAllowed: brandMomentsFor(c.tickets), participants: n, ...(c.name ? { name: c.name } : {}), ...(c.brand ? { brand: c.brand } : {}),
      paid: !unpaid, ...(freeGame ? { rs0: true } : {}), payment, ...(unpaid ? { pack: PACKS.find((x) => x[0] >= e.cap)?.[0] ?? null, priceInr: PACKS.find((x) => x[0] >= e.cap) ? price(PACKS.find((x) => x[0] >= e.cap)![0], "INR").total : null, priceUsd: PACKS.find((x) => x[0] >= e.cap) ? price(PACKS.find((x) => x[0] >= e.cap)![0], "USD").total : null, startsAt: istTime(roundMs(e.start_round), tzOfRow(e)), payUntil: istTime(await erasureOf(env, e), tzOfRow(e)) } : { pack: e.pack }),
      gameMinutes: Math.round((75 * e.call_seconds * c.rounds + c.breaks.reduce((t: number, b: any) => t + b.seconds, 0) + (c.rounds - 1) * 90) / 60),
      links, nextSteps, consoleUrl: `${origin}/zc.html?e=${e.id}`, ...(isDraft ? {} : { shareUrl: `${origin}/z.html?e=${e.id}` }), ...(unpaid && !isDraft ? { payUrl: `${origin}/pay.html?e=${e.id}` } : {}) });
  }
  if (action === "publish" && req.method === "POST") { // free: the organizer confirms their details, shares the link, and pays before the start (or it will not begin)
    const origin = (env as PayEnv).PUBLIC_ORIGIN ?? new URL(req.url).origin;
    const payUrl = `${origin}/pay.html?e=${eid}`, shareUrl = `${origin}/z.html?e=${eid}`;
    if (a.kind !== "ai" && can(a, e, true)) { const mt = consentRequired(await body(req.clone(), 4096), "K1"); if (mt) return mt; await recordConsent(env.DB, { subject: a.org ?? "platform", kind: "K1", ref: eid!, now }); } // K1: the Terms box and the organizer's promise, on the server; stored with the game id
    if (a.kind === "ai" && can(a, e)) return json({ ok: true, published: !isDraft, needsOrganizer: isDraft, ...(isDraft ? { consoleUrl: `${origin}/zc.html?e=${eid}` } : { payUrl, shareUrl }), message: isDraft
      ? "Everything is ready. Please give this link to the organizer: they open it, confirm their email and mobile number and press Publish. Publishing is free. After that the game does not begin until it is paid for (any time until the guest data is erased; a late payment starts the game 2 minutes after it is confirmed). The organizer does both themself: the AI never publishes or pays."
      : unpaid ? "It is published. The game does not begin until it is paid for (any time until the guest data is erased; a late payment starts it 2 minutes after confirmation). Give the organizer this link to pay: they do it themself." : "Already published and paid." });
    if (!can(a, e, true)) return deny(a);
    if (!isDraft) { // already published (for example the game was paid for first): the organizer's confirmed e-mail and mobile number are still kept if they have none on file, because the end-of-game report is sent to that e-mail
      const pb0 = await body(req); const ce = typeof pb0?.email === "string" ? pb0.email.trim() : "", cp = String(pb0?.phone ?? "").replace(/\D/g, "");
      if (pb0 && !consentMissing(pb0, "K1") && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(ce) && cp.length >= 10 && cp.length <= 15 && cleanPhone(pb0.phone).ok && !(await env.DB.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`contact/${eid}`).first())) {
        await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO NOTHING").bind(`contact/${eid}`, JSON.stringify({ email: ce, phone: cp.slice(-10) })).run();
      }
      return json({ ok: true, published: true, already: true, paid: !unpaid, startMs: roundMs(e.start_round), payUrl, shareUrl });
    }
    // the organizer confirms (and may correct) their email and mobile number
    const pb = await body(req);
    const cEmail = typeof pb?.email === "string" ? pb.email.trim() : "", cPhone = String(pb?.phone ?? "").replace(/\D/g, "");
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(cEmail)) return json({ error: "Please confirm a valid email address." }, 400);
    if (cPhone.length < 10 || cPhone.length > 15 || !cleanPhone(pb?.phone).ok) return json({ error: "Please confirm a valid mobile number. " + (cleanPhone(pb?.phone) as any).why }, 400);
    if (roundMs(e.start_round) <= now || (await env.DB.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`startpending/${eid}`).first())) return json({ error: "The start time has passed or has not been chosen. Please choose a new start time first.", code: "start-pending" }, 400);
    const rs0 = e.cap <= FREE_GAME_CAP; // the Rs 0 game: a real game for up to 10 people, published without a payment; it never uses up a bought pack
    const ent = rs0 ? null : await env.DB.prepare("SELECT id, pack FROM entitlement WHERE org=? AND eid IS NULL AND pack>=? ORDER BY pack, created_ms LIMIT 1").bind(e.org, e.cap).first<{ id: string; pack: number }>();
    const free = rs0 || (!ent && freeLaunch(env as PayEnv) && e.cap <= FREE_CAP); // optional switch: small engagements free while the gateway is off
    if (!(await spend(env, now, 4))) return BUSY();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`contact/${eid}`, JSON.stringify({ email: cEmail, phone: cPhone.slice(-10) })),
      env.DB.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)").bind(`pub/${eid}`, String(now)),
      ...(ent || free ? [env.DB.prepare("UPDATE engagement SET pack=? WHERE id=? AND pack=0").bind(ent?.pack ?? e.cap, eid)] : []),
      ...(ent ? [env.DB.prepare("UPDATE entitlement SET eid=? WHERE id=? AND eid IS NULL").bind(eid, ent.id)] : []),
    ]);
    const paid = !!(ent || free), startMs = roundMs(e.start_round);
    await recordFunnelForOrg(env as VisitEnv, e.org, "published", now);
    await sendMail(env as PayEnv, env.DB, cEmail, rs0 ? `Your game ${eid} is published (Rs 0, it starts ${istTime(startMs)})` : paid ? `Your game ${eid} is published and paid` : `Your game ${eid} is published: payment pending (it starts ${istTime(startMs)})`,
      `Your game ${eid} is live.${rs0 ? " It is for up to " + e.cap + " people at Rs 0: nothing to pay." : ""}\n\nShare this link: ${shareUrl}\n\n${paid ? "" : `Payment pending: the game does not begin until it is paid for. You can pay at any time until the guest data is erased; if you pay late, the game opens 2 minutes after the payment is confirmed (about 2 minutes to pay): ${payUrl}\n\n`}Big screen for the room: ${origin}/big.html?e=${eid}`, now);
    return json({ ok: true, published: true, paid, startMs, payUrl, shareUrl, confirmed: { email: cEmail, phone: cPhone.slice(-10) } });
  }
  if (action === "claims" && req.method === "GET") {
    if (!can(a, e)) return deny(a);
    const r = await env.DB.prepare("SELECT pid,pattern,round,idx FROM claim WHERE eid=? ORDER BY round,idx,pid").bind(eid).all();
    return json({ claims: r.results ?? [] });
  }
  if (action === "participants" && req.method === "GET") {
    if (!can(a, e)) return deny(a);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || PAGE, 1), PAGE), offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
    const r = await env.DB.prepare("SELECT p.pid AS pid, COALESCE(s.jr,0) AS jr, s.role AS role, s.inv AS inv, s.cat AS cat FROM participant p LEFT JOIN seat s ON s.eid=p.eid AND s.pid=p.pid WHERE p.eid=? ORDER BY p.joined_ms, p.pid LIMIT ? OFFSET ?").bind(eid, limit, offset).all<any>(); // ids only: names are sealed and are opened one small batch at a time (see /names)
    const total = (await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>())?.c ?? 0;
    return json({ participants: r.results ?? [], total, offset, limit, closed: !!e.closed, cap: e.cap, ...pub(e) });
  }
  if (action === "names" && req.method === "GET") { // the organizer's console asks for the names of a few people (winners); never a whole list in one request
    if (!can(a, e, true)) return deny(a);
    const ids = (url.searchParams.get("pids") ?? "").split(",").filter((x) => /^[0-9a-z]{3,40}$/.test(x)).slice(0, 60);
    const out: Record<string, string> = {};
    for (const id of ids) { const r = await env.DB.prepare("SELECT pii FROM participant WHERE eid=? AND pid=?").bind(eid, id).first<{ pii: string | null }>(); const o = await openPii(env, r?.pii); if (o?.name) out[id] = o.name; }
    return json({ names: out });
  }
  if (action === "mark" && req.method === "POST") { // the organizer says which seat is the organizer's, a host's or a co-host's: they may play, are flagged in the report, stay out of lucky draws and may invite without a limit
    if (!canAi(a, e)) return deny(a);
    const b = await body(req);
    const seatNo = Number.isInteger(b?.seat) && b.seat > 0 ? (b.seat as number) : 0;
    if (a.kind === "ai" && !seatNo) return CONSOLE_ONLY();
    const ph = seatNo ? "" : await phoneHash(b?.phone);
    const role = b?.role === "none" ? null : ["organizer", "host", "co-host"].includes(b?.role) ? b.role : undefined;
    if ((!ph && !seatNo) || role === undefined) return json({ error: "Give the seat number (or the mobile number) and a role (organizer, host, co-host or none)." }, 400);
    if (now >= roundMs(e.start_round + GRACE_ROUNDS)) return json({ error: "Flag your own team before the game begins. The list of players is fixed when the tournament starts, so it cannot change after that." }, 409);
    if (!(await spend(env, now))) return BUSY();
    const r = seatNo ? await env.DB.prepare("UPDATE seat SET role=? WHERE eid=? AND seq=?").bind(role, eid, seatNo).run() : await env.DB.prepare("UPDATE seat SET role=? WHERE eid=? AND ph=?").bind(role, eid, ph).run();
    return (r.meta?.changes ?? 0) > 0 ? json({ ok: true }) : json({ error: "That number has not joined yet. Ask them to open the game link first." }, 404);
  }
  if (action === "invites" && req.method === "GET") { // how many people this participant has invited so far (their own id is the key to ask)
    const pid = url.searchParams.get("pid") ?? "";
    const me = await env.DB.prepare("SELECT seq, role, inv, blocked FROM seat WHERE eid=? AND pid=?").bind(eid, pid).first<{ seq: number; role: string | null; inv: number | null; blocked: number | null }>();
    if (!me) return json({ error: "Not a participant of this game." }, 403);
    const c = cfgOf(e).invites;
    const used = Math.max((await env.DB.prepare("SELECT COUNT(*) AS c FROM seat WHERE eid=? AND inv=?").bind(eid, me.seq).first<{ c: number }>())?.c ?? 0, await listCount(env.DB, eid!, "s:" + me.seq)); // people on their list (joined or not) or seats under them
    return json({ on: !!c?.on, per: c?.per ?? 0, used, unlimited: !!me.role, canInvite: !me.blocked && (!!me.role || me.inv === null), seat: me.seq, cats: c?.cats ?? [], removed: !!me.blocked, whoCanJoin: e.closed ? "list" : "anyone" });
  }
  if (action === "life" && req.method === "GET") { // the organizer's view of when the game ends and when each kind of data is deleted
    if (!can(a, e)) return deny(a);
    const l = await env.DB.prepare("SELECT * FROM life WHERE eid=?").bind(eid).first<any>();
    const end = l && l.end_src === "phones" ? l.end_ms : await endBoundMs(env, e);
    return json({ endMs: end, endSrc: l?.end_src ?? "schedule", reportSent: !!l?.report_ms, reportState: l?.report_state ?? null, purged: !!l?.purged_ms, personalDeleteAtMs: personalDeleteAt(end), fullDeleteAtMs: fullDeleteAt(end), started: now >= roundMs(e.start_round + GRACE_ROUNDS) });
  }
  if (action === "won" && req.method === "POST") return acceptWon(env, e, eid!, await body(req), now, json, spend);
  if (action === "over" && req.method === "POST") return acceptOver(env, e, eid!, await body(req), now, json, spend);
  if (action === "settle" && req.method === "POST") return json({ error: "Winners are decided by the software, from the public numbers, when several phones agree. Nobody can post or change them." }, 403);
  if (action === "reportlink" && req.method === "POST") { // the organizer replaces the report link (lost it, shared it by mistake): the old link stops at once. Never an AI or a co-host.
    if (!can(a, e, true)) return deny(a);
    if (!(await spend(env, now, 2))) return BUSY();
    await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`rptsalt/${eid}`, randHex(12)).run();
    return json({ ok: true, url: await reportLink(env as any, eid!) });
  }
  if (action === "reportlink" && req.method === "GET") { // the organizer's / co-host's way to the report page (the PDF is made on their own device)
    if (!can(a, e)) return deny(a);
    const life = await env.DB.prepare("SELECT report_ms FROM life WHERE eid=?").bind(eid).first<{ report_ms: number | null }>();
    const st = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`rpt/${eid}`).first<{ v: string }>();
    const stage = st ? (JSON.parse(st.v).stage as string) : null;
    const ready = stage === "send" || stage === "done";
    if (a.kind === "ai") return json({ ready, sent: !!life?.report_ms, url: null, note: "The report holds every participant's name and number, so its address goes only to the organizer (it is e-mailed to them). Tell them to open their e-mail or their console." }); // the address is a key to personal data: it never travels through an outside AI
    return json({ ready, sent: !!life?.report_ms, url: ready ? await reportLink(env as any, eid!) : null });
  }
  if (action === "vote" && req.method === "POST") return acceptVotes(env as any, e, eid!, await body(req, 65_536), now, json, spend);
  if (action === "confirm" && req.method === "POST") return confirmPrize(env as any, eid!, await body(req), now, json, spend);
  if (action === "myprizes" && req.method === "GET") return myPrizes(env as any, eid!, url, json);
  if (action === "prizes" && req.method === "GET") { if (!can(a, e)) return deny(a); const outside = a.kind === "ai" || (a.kind === "host" && req.headers.get("x-cb-link") === "1"); return listPrizes(env as any, eid!, json, outside, !outside && (a.plat || a.kind === "master" || a.kind === "host")); } // an AI (or a co-host's AI link) sees card numbers only
  if (action === "override" && req.method === "POST") { if (!can(a, e) || !(a.plat || a.kind === "master" || a.kind === "host")) return deny(a); return overridePrize(env as any, eid!, await body(req), a.kind, now, json, spend); } // the organizer (or a Host) has the final say on who receives a prize
  if (action === "prizegiven" && req.method === "POST") { if (!can(a, e)) return deny(a); return markGiven(env, eid!, await body(req), a.kind, now, json, spend); }
  if (action === "erase" && req.method === "POST") { // right to erasure: every name, number, seat and invite of this engagement's people. The winners record and the organizer's own details stay, as the report says.
    if (!can(a, e, true)) return deny(a);
    if (now >= roundMs(e.start_round) && now < (await endBoundMs(env as any, e)) && !e.cancelled_ms) return json({ error: "The game is being played right now. You can delete the participants' data as soon as it ends.", code: "game-running" }, 409); // erasing mid-game would wipe every card and the Co-host keys under the players' feet
    const n = await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>();
    if (!(await spend(env, now, (n?.c ?? 0) + 1))) return BUSY();
    await erasePersonal(env, eid!, now, "organizer");
    return json({ ok: true, erased: n?.c ?? 0 });
  }
  if (action === "discard" && req.method === "POST") { // an unpublished draft the organizer no longer wants: gone at once, so the 10-draft limit can never trap anyone. A published, paid, cancelled or started game is never touched here.
    if (!(a.plat || (a.kind === "master" && !!a.org && e.org === a.org))) return deny(a);
    const published = await env.DB.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`pub/${eid}`).first();
    if (e.pack !== 0 || published || e.unplayed_ms != null || e.cancelled_ms != null) return json({ error: "Only a game that is not published yet can be deleted here. A published game is cancelled from step 10.", code: "not-a-draft" }, 409);
    if (!(await spend(env, now, 20))) return BUSY();
    await eraseEverything(env as any, eid!, now);
    return json({ ok: true });
  }
  if (action === "reuse" && req.method === "POST") { // copy the people of an earlier engagement into this one (while that list still exists); the sealed records are copied as they are
    if (!can(a, e)) return deny(a);
    const b = await body(req);
    if (!b || !ID.test(b.from ?? "") || b.from === eid) return json({ error: "Pick an earlier game." }, 400);
    const src = await env.DB.prepare("SELECT org FROM engagement WHERE id=?").bind(b.from).first<{ org: string | null }>();
    if (!src || !can(a, src)) return json({ error: "Pick an earlier game." }, 400); // someone else's roster is never reachable
    const old = await env.DB.prepare("SELECT phone_hash, pii FROM participant WHERE eid=? ORDER BY joined_ms, pid").bind(b.from).all<any>();
    const rows = old.results ?? [];
    if (!rows.length) return json({ error: "That game's people list has already been deleted (personal data is deleted within 24 hours of a game ending). Upload your list again.", code: "gone" }, 410);
    if (rows.length > e.cap) return json({ error: "This game is smaller than the earlier roster." }, 409);
    if (!(await spend(env, now, rows.length * 2))) return BUSY();
    let copied = 0; const jr = lateNow();
    for (const r of rows) {
      if (await env.DB.prepare("SELECT 1 AS x FROM participant WHERE eid=? AND phone_hash=?").bind(eid, r.phone_hash).first()) continue;
      await addSeat(r.phone_hash, r.pii, null, jr, { src: "reuse" });
      copied++;
    }
    return json({ ok: true, copied });
  }
  if (action === "roster" && req.method === "POST") { // an invite list: these people are on the engagement before they open the link
    if (!can(a, e)) return deny(a);
    if (a.kind === "ai") return CONSOLE_ONLY();
    const b = await body(req, 32_768);
    if (!b || !Array.isArray(b.people) || b.people.length < 1 || b.people.length > 100) return json({ error: "Send between 1 and 100 people at a time." }, 400);
    { const mt = consentRequired(b, "K6"); if (mt) return mt; } // K6: "I am allowed to use these names and numbers for this game. The people have been told."
    await recordConsent(env.DB, { subject: a.org ?? "platform", kind: "K6", ref: eid!, now });
    const have = await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>();
    let room = e.cap - (have?.c ?? 0);
    const todo: { ph: string; digits: string; name: string | null }[] = []; let invalid = 0;
    for (const x of b.people) { const ph = await phoneHash(x?.phone), digits = digitsOf(x?.phone); if (!ph || !digits) { invalid++; continue; } todo.push({ ph, digits, name: cleanName(x?.name) }); }
    if (!(await spend(env, now, todo.length * 2))) return BUSY();
    let added = 0, skipped = 0; const jr = lateNow();
    for (const t of todo) {
      if (room <= 0) { skipped++; continue; }
      if (await env.DB.prepare("SELECT 1 AS x FROM participant WHERE eid=? AND phone_hash=?").bind(eid, t.ph).first()) { skipped++; continue; }
      await addSeat(t.ph, await sealPii(env, { phone: t.digits, name: t.name }), null, jr, { src: "roster" });
      added++; room--;
    }
    return json({ ok: true, added, skipped, invalid });
  }
  if (action === "settings" && (req.method === "PATCH" || req.method === "POST")) { // only before the first number can possibly have been called
    if (!can(a, e)) return deny(a);
    if (!unpaid && roundMs(e.start_round) <= now) return json({ error: "The game has already started, so it can no longer be changed." }, 409);
    const b = await body(req, BRAND_BODY_MAX);
    if (!b) return json({ error: "Check the details." }, 400);
    if (b.whoCanJoin !== undefined && b.whoCanJoin !== "list" && b.whoCanJoin !== "anyone") return json({ error: "Who can join: choose \"list\" (only people on a list) or \"anyone\" (anyone with the link)." }, 400);
    if (b.coHostLimit !== undefined && (!Number.isInteger(b.coHostLimit) || b.coHostLimit < COHOST_LIMIT_MIN || b.coHostLimit > COHOST_LIMIT_MAX)) return json({ error: `A Co-host can list ${COHOST_LIMIT_MIN} to ${COHOST_LIMIT_MAX} people.` }, 400);
    const vc = validateCfg({ tickets: b.tickets, rewards: b.rewards, breaks: b.breaks, rounds: b.rounds, invites: b.invites !== undefined ? b.invites : b.guestInvites, opening: b.opening, closing: b.closing, name: b.name, brand: b.brand, mark: b.mark, join: b.join, tz: b.tz, verify: b.verify, employeesOnly: b.employeesOnly }, cfgOf(e)); // guestInvites is the console's name for invites
    if (!vc.ok) return json({ error: vc.error }, 400);
    const next = { start_round: b.startRound ?? e.start_round, call_seconds: b.callSeconds ?? e.call_seconds, cap: b.cap ?? e.cap, closed: vc.cfg.employeesOnly ? 1 : b.whoCanJoin !== undefined ? (b.whoCanJoin === "list" ? 1 : 0) : b.closed === undefined ? e.closed : b.closed ? 1 : 0, cohost_limit: b.coHostLimit ?? e.cohost_limit ?? null }; // whoCanJoin "list" is the same switch as the older `closed`
    if (Number.isInteger(next.call_seconds) && !GAPS.includes(next.call_seconds)) return json({ error: GAP_MSG }, 400);
    if (!Number.isInteger(next.start_round)) return json({ error: "Pick the day and time the game starts." }, 400);
    if (!Number.isInteger(next.call_seconds) || next.call_seconds % 3 || next.call_seconds < 6) return json({ error: GAP_MSG }, 400);
    if (!Number.isInteger(next.cap) || next.cap < 1 || next.cap > 100000) return json({ error: "The number of people must be a whole number from 1 up. Please check it." }, 400);
    if (roundMs(next.start_round) <= now) return json({ error: "Pick a start time in the future." }, 400);
    if (next.start_round !== e.start_round) { const last = await latestStartMs(env.DB, e, now); if (roundMs(next.start_round) > last) return json({ error: e.pack ? TOO_FAR_PAID(last) : TOO_FAR, code: "too-far", ...(e.pack ? { lastStartMs: last } : {}) }, 400); } // a draft: 30 days ahead; a paid game: any date within 365 days of the payment
    const have = await env.DB.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid=?").bind(eid).first<{ c: number }>();
    if (!a.plat && e.pack !== 0 && next.cap > (e.pack ?? e.cap)) return json({ error: (e.pack ?? e.cap) <= FREE_GAME_CAP ? `A game for up to ${FREE_GAME_CAP} people is Rs 0. For more people, create a new game like this one and choose a bigger size.` : `Your pack allows up to ${e.pack ?? e.cap} people. For more people, make a new game like this one.` }, 402);
    const listed = await env.DB.prepare("SELECT COUNT(*) AS c FROM person WHERE eid=? AND status<>'removed'").bind(eid).first<{ c: number }>().catch(() => null); // people on the lists who have not come in yet count too
    if (next.cap < Math.max(have?.c ?? 0, listed?.c ?? 0)) return json({ error: "The limit cannot be lower than the people already on the list." }, 409);
    if (!(await spend(env, now))) return BUSY();
    await env.DB.prepare("UPDATE engagement SET start_round=?, call_seconds=?, cap=?, closed=?, tickets=?, config=?, cohost_limit=? WHERE id=?").bind(next.start_round, next.call_seconds, next.cap, next.closed, vc.cfg.tickets, cfgJson(vc.cfg), next.cohost_limit, eid).run();
    if (next.start_round !== e.start_round) { // a new time: for a game nobody paid for, the erasure clock follows it (the lifecycle tick re-reads the schedule), and the date has been chosen
      await env.DB.prepare("DELETE FROM kv WHERE k=?").bind(`startpending/${eid}`).run();
      if (unpaid) await env.DB.prepare("DELETE FROM life WHERE eid=? AND report_ms IS NULL").bind(eid).run();
    }
    { // the pause profile depends on the size: if no pause has been sent yet and the size moved to another profile, forget the unused key so the console registers the right one
      const f = await readPublished(d1kv(env), eid!);
      const sf = safetyForCap(next.cap);
      if (f && f.messages.length === 0 && (!sf || sf.leadRounds !== f.leadRounds)) {
        await env.DB.prepare("DELETE FROM kv WHERE k=?").bind(`control/${eid}.json`).run();
        try { await env.CONTROL_R2?.delete(controlKey(eid!)); } catch { /* the object expires with its engagement anyway */ }
      }
    }
    return json({ ok: true, startRound: next.start_round, callSeconds: next.call_seconds, cap: next.cap, closed: !!next.closed, whoCanJoin: next.closed ? "list" : "anyone", coHostLimit: next.cohost_limit ?? COHOST_LIMIT_DEFAULT, guestInvites: vc.cfg.invites, tickets: vc.cfg.tickets, rewards: vc.cfg.rewards, breaks: vc.cfg.breaks, opening: vc.cfg.opening, closing: vc.cfg.closing, ...(vc.cfg.name ? { name: vc.cfg.name } : {}), ...(vc.cfg.brand ? { brand: vc.cfg.brand } : {}), rounds: vc.cfg.rounds, invites: vc.cfg.invites });
  }
  return json({ error: "Not found" }, 404);
}

/** Deletes engagements (and their people, claims and results) older than the 365-day retention period. */
/**
 * Housekeeping for everything that is not an engagement (see docs/RETENTION.md for the schedule). Runs with the daily purge. Never throws.
 * network-address hashes (start/, linkfail/, plim/): 2 days; sign-in codes: 1 day after they expire; partner sign-up codes (penr/): 1 day;
 * "new place" records (seen/, alert/): when their key is no longer live; e-mailed 24-hour keys: 7 days after they expire; retired keys: 90 days; daily counters: 90 days.
 */
export async function retentionSweep(env: Env, now: number): Promise<void> {
  const DAY = 86_400_000, db = env.DB;
  const safe = async (f: () => Promise<unknown>) => { try { await f(); } catch { /* one failing step must not stop the others */ } };
  const cutoff = new Date(now - 2 * DAY).toISOString().slice(0, 10);
  await safe(async () => {
    const r = await db.prepare("SELECT k FROM kv WHERE k LIKE 'start/%' OR k LIKE 'linkfail/%' OR k LIKE 'plim/%' OR k LIKE 'jlim/%' OR k LIKE 'jbm/%' LIMIT 2000").all<{ k: string }>();
    for (const x of r.results ?? []) { const d = x.k.match(/\d{4}-\d{2}-\d{2}/)?.[0]; if (d && d < cutoff) await db.prepare("DELETE FROM kv WHERE k=?").bind(x.k).run(); }
  });
  await safe(() => db.prepare("DELETE FROM login_code WHERE expires_ms < ?").bind(now - DAY).run());
  await safe(async () => {
    const r = await db.prepare("SELECT k, v FROM kv WHERE k LIKE 'penr/%' OR k LIKE 'delreq/%' LIMIT 2000").all<{ k: string; v: string }>();
    for (const x of r.results ?? []) { let t = 0; try { t = JSON.parse(x.v).t ?? 0; } catch { /* unreadable: drop it */ } if (now - t > DAY) await db.prepare("DELETE FROM kv WHERE k=?").bind(x.k).run(); }
  });
  await safe(async () => { // a demo-pass secret held for a sign-in that never finished (see holdPassForSignIn): usable for 2 hours, so nothing older may stay
    const r = await db.prepare("SELECT k, v FROM kv WHERE k LIKE 'loginpass/%' LIMIT 2000").all<{ k: string; v: string }>();
    for (const x of r.results ?? []) { let at = 0; try { at = Number(JSON.parse(x.v).at) || 0; } catch { /* unreadable: drop it */ } if (now - at > 2 * 3_600_000) await db.prepare("DELETE FROM kv WHERE k=?").bind(x.k).run(); }
  });
  await safe(() => db.prepare("DELETE FROM kv WHERE (k LIKE 'seen/%' OR k LIKE 'alert/%') AND substr(k, instr(k, '/') + 1) NOT IN (SELECT substr(hash, 1, 10) FROM organizer_key WHERE revoked=0 AND (expires_ms IS NULL OR expires_ms > ?))").bind(now).run());
  await safe(() => db.prepare("DELETE FROM organizer_key WHERE expires_ms IS NOT NULL AND expires_ms < ?").bind(now - 7 * DAY).run());
  await safe(() => db.prepare("DELETE FROM organizer_key WHERE revoked=1 AND created_ms < ?").bind(now - 90 * DAY).run());
  await safe(() => db.prepare("DELETE FROM credit_use WHERE credit_id IN (SELECT id FROM credit WHERE expires_ms < ?)").bind(now - 365 * DAY).run()); // credit records are kept a year after they lapse or are used up, like the payment records they come from
  await safe(() => db.prepare("DELETE FROM credit WHERE expires_ms < ?").bind(now - 365 * DAY).run());
  await safe(() => db.prepare("DELETE FROM usage WHERE day < ?").bind(new Date(now - 90 * DAY).toISOString().slice(0, 10)).run());
}
export async function purgeOld(env: Env, now: number): Promise<number> {
  await retentionSweep(env, now);
  // an engagement goes at 00:00 IST at the end of the 365th day after its game ended (created + 365 days if it never ran), and a draft nobody published after DRAFT_DAYS
  const loose = now - (RETENTION_DAYS - 2) * 86_400_000;
  const old = await env.DB.prepare("SELECT e.id AS id, e.created_ms AS created_ms, e.pack AS pack, e.unplayed_ms AS unplayed_ms, l.end_ms AS end_ms FROM engagement e LEFT JOIN life l ON l.eid=e.id WHERE e.created_ms < ? OR (e.pack=0 AND e.created_ms < ?) OR (e.unplayed_ms IS NOT NULL AND e.unplayed_ms < ?)").bind(loose, now - DRAFT_DAYS * 86_400_000, now - SETTINGS_KEEP_MS).all<{ id: string; created_ms: number; pack: number; unplayed_ms: number | null; end_ms: number | null }>();
  await env.DB.prepare("DELETE FROM ai_audit WHERE at_ms < ?").bind(now - RETENTION_DAYS * 86_400_000).run().catch(() => undefined);
  await sweepAudit(env.DB, now, RETENTION_DAYS); // the AI's audit trail is kept as long as the organizer's own details
  let n = 0;
  for (const x of old.results ?? []) {
    const draftDue = x.pack === 0 && x.unplayed_ms == null && x.created_ms < now - DRAFT_DAYS * 86_400_000 && !(await env.DB.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`pub/${x.id}`).first()); // a draft nobody published is forgotten after 30 days, even with a start time (and so a life row)
    let endMs: number | null = x.end_ms; // a game that never held personal data has no end clock yet: its end is the cancel time, or the scheduled end
    if (endMs == null && x.unplayed_ms == null && !draftDue) { const row = await env.DB.prepare("SELECT * FROM engagement WHERE id=?").bind(x.id).first<any>(); if (row && row.pack !== 0) endMs = Math.max(x.created_ms, row.cancelled_ms ?? (await endBoundMs(env as any, row))); }
    const due = draftDue ? true : x.unplayed_ms != null ? now >= x.unplayed_ms + SETTINGS_KEEP_MS : endMs != null ? now >= fullDeleteAt(endMs) : x.created_ms < now - RETENTION_DAYS * 86_400_000 || (x.pack === 0 && x.created_ms < now - DRAFT_DAYS * 86_400_000);
    if (!due) continue;
    await eraseEverything(env, x.id, now);
    try { await env.CONTROL_R2?.delete(controlKey(x.id)); } catch { /* the object expires with its engagement anyway */ }
    n++;
  }
  return n;
}

export default { fetch: (req: Request, env: Env) => handle(req, env), scheduled: async (_e: unknown, env: Env) => { await lifecycleTick(env as any, Date.now()); await purgeOld(env, Date.now()); await retryOutbox(env as PayEnv, Date.now()); } };
