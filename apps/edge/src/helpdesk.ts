// Help Desk (owner order 2026-10-19, docs/HELPDESK_SPEC.md): a Refer-and-earn partner (the "helper") prepares games for an Organizer, and the Organizer publishes with one tap.
//   - Nothing here adds a new power to the game. The helper works through the Organizer's own AI-key rights (create and change a game; never publish, pay, see keys, add Hosts or close the account),
//     the Organizer publishes through the game's own publish route, and after publishing the helper becomes a Host of that Organizer: a "desk" Host (organizer_key.created_by = 'd')
//     who does not use one of the Organizer's 5 Host places.
//   - Keys: the helper's AI key (kind 'ai', created_by 'd') is made when the Organizer says Allow. It is stored hashed in organizer_key and sealed in helpdesk_link, so the helper can reopen their console.
//     The one-tap publish approval is a link in an e-mail (7 days, single use). Opening it gives the page a master key for 30 minutes (kind 'master', created_by 'dp') which is revoked when the game is published or the link is stopped.
//   - Every e-mail address is kept sealed. The Organizer's address is also kept as the same one-way hash the sign-in uses, so an invitation can be accepted only by the account of that address.
//   - Every paid game the helper prepared earns the helper Refer-and-earn commission: the payment's `ref` is the helper's partner code (pay.ts), and recordCommission does the rest (same rate, same repeat rule, same self-referral block).
import type { D1, Env } from "./worker";
import { sendMail, type PayEnv } from "./pay";
import { openText, sealText } from "./pii";
import { HOST_LINK_TTL_MS, hostStateRow, maskEmail, mintDeviceKey, retireHost } from "./hostsetup";
import { helpDeskPublishedMail } from "./mails";
import { houseLabel } from "../../../packages/beacon/src/config";

export const HELPDESK_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS helpdesk_helper (partner_code TEXT PRIMARY KEY, email_sealed TEXT NOT NULL, joined_ms INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'active')`,
  `CREATE TABLE IF NOT EXISTS helpdesk_link (id TEXT PRIMARY KEY, partner_code TEXT NOT NULL, org_email_sealed TEXT NOT NULL, org_email_hash TEXT NOT NULL, org TEXT, state TEXT NOT NULL, token_hash TEXT NOT NULL, ai_key_hash TEXT, ai_key_sealed TEXT, host_hash TEXT, consent_ms INTEGER, consent_text_hash TEXT, created_ms INTEGER NOT NULL, accepted_ms INTEGER, stopped_ms INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS helpdesk_link_token ON helpdesk_link (token_hash)`,
  `CREATE INDEX IF NOT EXISTS helpdesk_link_partner ON helpdesk_link (partner_code)`,
  `CREATE INDEX IF NOT EXISTS helpdesk_link_org ON helpdesk_link (org)`,
  `CREATE TABLE IF NOT EXISTS helpdesk_game (eid TEXT PRIMARY KEY, link_id TEXT NOT NULL, partner_code TEXT NOT NULL, created_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS helpdesk_pub (token_hash TEXT PRIMARY KEY, link_id TEXT NOT NULL, eid TEXT NOT NULL, org TEXT NOT NULL, created_ms INTEGER NOT NULL, exp_ms INTEGER NOT NULL, used_ms INTEGER, tmp_key_hash TEXT)`,
];

/** An invitation can be accepted for this long. */
export const INVITE_DAYS = 14;
/** A one-tap publish approval lives this long, and the temporary key it opens lives 30 minutes. */
export const APPROVAL_DAYS = 7;
export const TMP_KEY_MS = 30 * 60_000;
/** Invitation limits (docs/HELPDESK_SPEC.md): per helper per hour, per Organizer e-mail per day across all helpers, and active clients per helper. */
export const INVITES_PER_HOUR = 5, INVITES_PER_ORG_DAY = 3, MAX_CLIENTS = 50;
/** Asking the Organizer again about the same game is allowed once per 10 minutes. */
export const RESEND_MS = 10 * 60_000;
/** The words the Organizer sees before tapping Allow (version HD1). The hash of this template is stored with the Organizer's tick. */
export const HD1_VERSION = "HD1";
export const HD1_TEMPLATE = [
  "{helper} may prepare games in your account: create a game and change its settings and prizes. This is what your own AI link can do.",
  "They cannot publish a game, pay, see your sign-in keys, change your e-mail or close your account. Only you publish, with one tap.",
  "After you publish a game they prepared, they become a Host of that game and can change it like any Host. They see what a Host sees, such as the guest list. They do not use one of your 5 Host places.",
  "When a game they prepared is paid, they earn Refer & earn commission from us. You pay nothing extra.",
  "You can stop this at any time. It ends all their access at once. Games already published stay as they are.",
];
export const hd1Lines = (helper: string): string[] => HD1_TEMPLATE.map((l) => l.replace("{helper}", helper));

/** The paragraph added to the AI manual of a helper's key (and nowhere else). */
export const HELPER_MANUAL_NOTE = [
  "YOU ARE A HELP DESK HELPER.",
  "You prepare games for the Organizer who allowed you. You create the game and set it up with your normal functions. You never publish and never pay: only the Organizer publishes, with one tap, and pays.",
  "When the game is ready, ask the Organizer to publish: call POST /api/helpdesk/request-publish with {\"eid\": \"<the game id>\"} (or tell the helper to tap Ask the Organizer to publish). The Organizer gets an e-mail with a short summary and a button. Do not give out any link yourself.",
  "After the Organizer publishes, the helper becomes a Host of that game and gets a Host link by e-mail.",
].join("\n");

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const randHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
async function body(req: Request, max = 2048): Promise<any | null> { const t = await req.text(); if (t.length > max) return null; try { const v = JSON.parse(t); return v && typeof v === "object" ? v : null; } catch { return null; } }
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const validEmail = (v: unknown): string => { const e = typeof v === "string" ? v.trim().toLowerCase() : ""; return EMAIL_RE.test(e) ? e : ""; };
const clean = (v: unknown, n: number): string => (typeof v === "string" ? v.replace(/[<>`]/g, "").trim().slice(0, n) : "");
const TOKEN = /^[0-9a-f]{48}$/;
const ID16 = /^[0-9a-f]{16}$/;
const GAME_ID = /^[A-Za-z0-9_-]{4,40}$/;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface Link { id: string; partner_code: string; org_email_sealed: string; org_email_hash: string; org: string | null; state: string; token_hash: string; ai_key_hash: string | null; ai_key_sealed: string | null; host_hash: string | null; consent_ms: number | null; created_ms: number; accepted_ms: number | null; stopped_ms: number | null }
const LINK_COLS = "id, partner_code, org_email_sealed, org_email_hash, org, state, token_hash, ai_key_hash, ai_key_sealed, host_hash, consent_ms, created_ms, accepted_ms, stopped_ms";

/** What the pages and routes below need from the Worker without importing it: the game summary exactly as the AI's summary route reads it (no phone numbers in it). */
export interface HelpdeskCtx { summary: (org: string, eid: string) => Promise<any | null> }

// ---------------------------------------------------------------------------------------------------------------- small shared helpers (used by the hooks in worker.ts, pay.ts and partners.ts)
/** Is this key (as presented) a helper's AI key? Used for the AI manual paragraph. */
export async function isHelperKey(db: D1, presented: string): Promise<boolean> {
  try { return !!(await db.prepare("SELECT 1 AS x FROM organizer_key WHERE hash=? AND created_by='d' AND kind='ai' AND revoked=0").bind(await sha("key|" + presented)).first()); } catch { return false; }
}
/** Is this the first 10 characters of the hash of a key that belongs to a helper (any desk key)? The helper uses their own devices, so the "unfamiliar use" alert skips these. */
export async function isDeskKeyId(db: D1, keyId10: string): Promise<boolean> {
  try { return !!(await db.prepare("SELECT 1 AS x FROM organizer_key WHERE substr(hash,1,10)=? AND created_by='d'").bind(keyId10).first()); } catch { return false; }
}
/** Hook for game creation: a game made with a helper's AI key is recorded as made through that link. Never throws into the creation. */
export async function noteHelperGame(db: D1, presented: string, org: string, eid: string, now: number): Promise<void> {
  try {
    const l = await db.prepare("SELECT id, partner_code FROM helpdesk_link WHERE ai_key_hash=? AND state='active' AND org=?").bind(await sha("key|" + presented), org).first<{ id: string; partner_code: string }>();
    if (l) await db.prepare("INSERT OR IGNORE INTO helpdesk_game(eid,link_id,partner_code,created_ms) VALUES(?,?,?,?)").bind(eid, l.id, l.partner_code, now).run();
  } catch { /* the game is already made */ }
}
/** Hook for checkout: the partner code a game's payment must carry, when the game was prepared by a helper (it overrides a code from the buyer's browser). null for any other game. */
export async function helperRefFor(db: D1, eid: string | null | undefined): Promise<string | null> {
  if (!eid) return null;
  try { return (await db.prepare("SELECT partner_code FROM helpdesk_game WHERE eid=?").bind(eid).first<{ partner_code: string }>())?.partner_code ?? null; } catch { return null; }
}
/** Hook for "Close my organizer account": the statements that remove every Help Desk row of that account (before the key rows go). */
export function helpdeskCloseStatements(db: D1, org: string) {
  return [
    db.prepare("DELETE FROM helpdesk_game WHERE link_id IN (SELECT id FROM helpdesk_link WHERE org=?)").bind(org),
    db.prepare("DELETE FROM helpdesk_pub WHERE org=?").bind(org),
    db.prepare("DELETE FROM helpdesk_link WHERE org=?").bind(org),
  ];
}

/** Daily clean-up: a publish approval that was used or expired more than 30 days ago, and an invitation nobody answered in 30 days, are deleted (the invited address goes with it). */
export async function helpdeskSweep(db: D1, now: number): Promise<void> {
  try {
    const old = now - 30 * 86_400_000;
    await db.prepare("DELETE FROM helpdesk_pub WHERE COALESCE(used_ms, exp_ms) < ?").bind(old).run();
    await db.prepare("DELETE FROM helpdesk_link WHERE state='invited' AND created_ms < ?").bind(old).run();
  } catch { /* tried again tomorrow */ }
}

async function helperMail(env: PayEnv, code: string, subject: string, text: string, now: number, opts: { html?: string; secret?: boolean } = {}): Promise<boolean> {
  try {
    const r = await env.DB.prepare("SELECT email_sealed FROM helpdesk_helper WHERE partner_code=?").bind(code).first<{ email_sealed: string }>();
    const to = await openText(env as any, r?.email_sealed);
    return to ? await sendMail(env, env.DB, to, subject, text, now, opts) : false;
  } catch { return false; }
}
const helperName = async (db: D1, code: string): Promise<string> => (await db.prepare("SELECT name FROM partner WHERE code=?").bind(code).first<{ name: string | null }>().catch(() => null))?.name || "A Help Desk person";

/** Ends a link at once: the helper's AI key, the desk Host (every device key), any publish approval still open and its temporary key. Games already published stay. Safe to call twice. */
export async function stopLink(env: PayEnv, l: Link, now: number, notify = true): Promise<void> {
  const db = env.DB;
  const open = (await db.prepare("SELECT tmp_key_hash FROM helpdesk_pub WHERE link_id=? AND used_ms IS NULL AND tmp_key_hash IS NOT NULL").bind(l.id).all<{ tmp_key_hash: string }>()).results ?? [];
  for (const o of open) await db.prepare("UPDATE organizer_key SET revoked=1 WHERE hash=?").bind(o.tmp_key_hash).run();
  await db.prepare("UPDATE helpdesk_pub SET used_ms=? WHERE link_id=? AND used_ms IS NULL").bind(now, l.id).run();
  if (l.ai_key_hash) await db.prepare("UPDATE organizer_key SET revoked=1 WHERE hash=?").bind(l.ai_key_hash).run();
  if (l.host_hash) await retireHost(db, l.host_hash);
  const was = l.state;
  await db.prepare("UPDATE helpdesk_link SET state='stopped', stopped_ms=?, ai_key_sealed=NULL WHERE id=?").bind(now, l.id).run();
  if (notify && was !== "stopped") {
    const to = maskEmail((await openText(env as any, l.org_email_sealed)) ?? "x@x");
    await helperMail(env, l.partner_code, was === "invited" ? "The Organizer did not allow Help Desk" : "Help Desk stopped", `The Organizer (${to}) ${was === "invited" ? "did not allow" : "stopped"} Help Desk. ${was === "invited" ? "Nothing was set up." : "Your access to their account has ended. Games already published stay as they are."}`, now);
  }
}

/** The partner closed their Refer & earn account: every link ends and the Help Desk rows go (the e-mails with them). Payment and commission records stay with the payments. */
export async function helperClosed(env: PayEnv, code: string, now: number): Promise<void> {
  try {
    const links = (await env.DB.prepare(`SELECT ${LINK_COLS} FROM helpdesk_link WHERE partner_code=?`).bind(code).all<Link>()).results ?? [];
    for (const l of links) await stopLink(env, l, now, false);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM helpdesk_pub WHERE link_id IN (SELECT id FROM helpdesk_link WHERE partner_code=?)").bind(code),
      env.DB.prepare("DELETE FROM helpdesk_link WHERE partner_code=?").bind(code),
      env.DB.prepare("DELETE FROM helpdesk_helper WHERE partner_code=?").bind(code),
    ]);
  } catch { /* the partner row is gone either way */ }
}

// ---------------------------------------------------------------------------------------------------------------- the routes
export async function helpdeskRoute(req: Request, env: PayEnv, now: number, spend: (n: number) => Promise<boolean>, ctx: HelpdeskCtx, auth: { kind: string | null; org: string | null }): Promise<Response | null> {
  const url = new URL(req.url), p = url.pathname, db: D1 = env.DB;
  if (!p.startsWith("/api/helpdesk/")) return null;
  const origin = env.PUBLIC_ORIGIN ?? url.origin;
  const busy = () => json({ error: "It is very busy right now. Please try again in a few minutes." }, 503);
  const notAllowed = () => json({ error: "Not allowed." }, 403);
  const gone = (state: string) => json({ error: state === "stopped" ? "This has been stopped." : "This link has been used or has expired.", state }, 410);
  const presentedKey = req.headers.get("x-organizer") || (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");

  const partner = async () => {
    const k = req.headers.get("x-partner") ?? "";
    return k ? db.prepare("SELECT code, name, email_hash, state FROM partner WHERE key_hash=?").bind(await sha("partner|" + k)).first<{ code: string; name: string | null; email_hash: string | null; state: string }>() : null;
  };
  /** The helper: a partner who turned Help Desk on. */
  const helper = async () => {
    const m = await partner();
    if (!m || m.state !== "active") return null;
    const h = await db.prepare("SELECT email_sealed FROM helpdesk_helper WHERE partner_code=? AND state='active'").bind(m.code).first<{ email_sealed: string }>();
    return h ? { ...m, email_sealed: h.email_sealed } : null;
  };
  const linkByToken = async (t: unknown) => (typeof t === "string" && TOKEN.test(t) ? db.prepare(`SELECT ${LINK_COLS} FROM helpdesk_link WHERE token_hash=?`).bind(await sha("hdlink|" + t)).first<Link>() : null);
  const linkById = async (id: unknown) => (typeof id === "string" && ID16.test(id) ? db.prepare(`SELECT ${LINK_COLS} FROM helpdesk_link WHERE id=?`).bind(id).first<Link>() : null);
  const counter = {
    get: async (k: string) => Number((await db.prepare("SELECT v FROM kv WHERE k=?").bind(k).first<{ v: string }>())?.v ?? 0),
    inc: async (k: string, n: number) => { await db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?").bind(k, String(n + 1), String(n + 1)).run(); },
  };
  const isDraft = async (eid: string) => {
    const e = await db.prepare("SELECT pack FROM engagement WHERE id=?").bind(eid).first<{ pack: number | null }>();
    if (!e) return null;
    const pub = await db.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`pub/${eid}`).first();
    return e.pack === 0 && !pub;
  };

  // ---- helper: turn Help Desk on (the e-mail must be the one the partner enrolled with) ----
  if (req.method === "POST" && p === "/api/helpdesk/join") {
    const m = await partner(); if (!m || m.state !== "active") return notAllowed();
    const b = await body(req); const email = validEmail(b?.email);
    if (!email) return json({ error: "Enter the e-mail address you joined Refer & earn with." }, 400);
    if (!m.email_hash || (await sha("pemail|" + email)) !== m.email_hash) return json({ error: "That is not the e-mail address you joined Refer & earn with." }, 403);
    if (!(await spend(2))) return busy();
    await db.prepare("INSERT OR IGNORE INTO helpdesk_helper(partner_code,email_sealed,joined_ms,state) VALUES(?,?,?, 'active')").bind(m.code, await sealText(env as any, email), now).run();
    return json({ ok: true, joined: true });
  }

  // ---- helper: my clients ----
  if (req.method === "GET" && p === "/api/helpdesk/me") {
    const m = await partner(); if (!m || m.state !== "active") return notAllowed();
    const h = await helper();
    if (!h) return json({ joined: false });
    const links = (await db.prepare(`SELECT ${LINK_COLS} FROM helpdesk_link WHERE partner_code=? ORDER BY created_ms DESC LIMIT 100`).bind(h.code).all<Link>()).results ?? [];
    const clients = [];
    for (const l of links) {
      const active = l.state === "active";
      const aiKey = active ? await openText(env as any, l.ai_key_sealed) : null;
      const games = [];
      if (l.state !== "invited") {
        const rows = (await db.prepare("SELECT g.eid AS eid, e.pack AS pack, e.config AS config, (SELECT 1 FROM kv WHERE k='pub/'||g.eid) AS pub FROM helpdesk_game g JOIN engagement e ON e.id=g.eid WHERE g.link_id=? ORDER BY g.created_ms DESC LIMIT 50").bind(l.id).all<{ eid: string; pack: number | null; config: string | null; pub: number | null }>()).results ?? [];
        for (const r of rows) {
          let title = ""; try { title = String(JSON.parse(r.config ?? "{}").name ?? ""); } catch { /* no title */ }
          const published = r.pack !== 0 || !!r.pub;
          games.push({ eid: r.eid, ...(title ? { title } : {}), published, ...(active && aiKey ? { consoleUrl: `${origin}/zc.html?k=${aiKey}&e=${encodeURIComponent(r.eid)}` } : {}) });
        }
      }
      const hs = l.host_hash && active ? await hostStateRow(db, l.host_hash) : null;
      clients.push({
        id: l.id, orgEmailMasked: maskEmail((await openText(env as any, l.org_email_sealed)) ?? "x@x"), state: l.state, createdMs: l.created_ms, ...(l.accepted_ms ? { acceptedMs: l.accepted_ms } : {}), games,
        ...(active && aiKey ? { consoleUrl: `${origin}/zc.html?k=${aiKey}`, aiLink: `${origin}/ai/${aiKey}` } : {}),
        hostLink: !l.host_hash ? "none" : !active ? "ended" : hs?.verified_ms && hs?.mobile_ok ? "ready" : "waiting-for-setup",
      });
    }
    return json({ joined: true, code: h.code, clients, maxClients: MAX_CLIENTS });
  }

  // ---- helper: invite an Organizer by e-mail ----
  if (req.method === "POST" && p === "/api/helpdesk/invite") {
    const h = await helper(); if (!h) return notAllowed();
    const b = await body(req); const email = validEmail(b?.email);
    if (!email) return json({ error: "Enter the Organizer's e-mail address." }, 400);
    const mine = await openText(env as any, h.email_sealed);
    if (email === mine) return json({ error: "Enter the Organizer's e-mail address, not your own." }, 400);
    const eh = await sha("email|" + email);
    const counts = (await db.prepare("SELECT COUNT(*) AS c FROM helpdesk_link WHERE partner_code=? AND state IN ('invited','active')").bind(h.code).first<{ c: number }>())?.c ?? 0;
    if (counts >= MAX_CLIENTS) return json({ error: `You can have up to ${MAX_CLIENTS} clients at a time.` }, 409);
    if (await db.prepare("SELECT 1 AS x FROM helpdesk_link WHERE partner_code=? AND org_email_hash=? AND state IN ('invited','active')").bind(h.code, eh).first()) return json({ error: "You already have this client." }, 409);
    const hk = `hdinv/h/${h.code}/${Math.floor(now / 3_600_000)}`, ok = `hdinv/o/${eh}/${day(now)}`;
    const nh = await counter.get(hk), no = await counter.get(ok);
    if (nh >= INVITES_PER_HOUR) return json({ error: "That is enough invitations for this hour. Please try again later." }, 429);
    if (no >= INVITES_PER_ORG_DAY) return json({ error: "That address has had enough invitations today. Please try again tomorrow." }, 429);
    if (!(await spend(4))) return busy();
    await counter.inc(hk, nh); await counter.inc(ok, no);
    const id = randHex(8), token = randHex(24);
    await db.prepare("INSERT INTO helpdesk_link(id,partner_code,org_email_sealed,org_email_hash,org,state,token_hash,created_ms) VALUES(?,?,?,?,NULL,'invited',?,?)").bind(id, h.code, await sealText(env as any, email), eh, await sha("hdlink|" + token), now).run();
    const hn = h.name || "A Help Desk person", greet = clean(b?.name, 60);
    await sendMail(env, db, email, `${hn} asks to prepare Corporate Tic Tac Toe games for you`,
      `${greet ? `Hello ${greet},\n\n` : ""}${hn} asks to prepare games for you in Corporate Tic Tac Toe.\n\nNothing is published or paid without your OK.\n\nRead the short promise and choose here: ${origin}/helpdesk-accept.html?t=${token}\n\nThe link works for ${INVITE_DAYS} days. If you do not know this person, ignore this e-mail and nothing happens.`, now, { secret: true });
    return json({ ok: true, id }); // the same answer whether or not the address already has an account
  }

  // ---- helper (or the helper's AI key): ask the Organizer to publish a game ----
  if (req.method === "POST" && p === "/api/helpdesk/request-publish") {
    const b = await body(req);
    const eid = typeof b?.eid === "string" && GAME_ID.test(b.eid) ? b.eid : "";
    let link: Link | null = null;
    const h = await helper();
    if (h) link = await linkById(b?.linkId);
    if (link && link.partner_code !== h!.code) link = null;
    if (!h && presentedKey && auth.kind === "ai") link = await db.prepare(`SELECT ${LINK_COLS} FROM helpdesk_link WHERE ai_key_hash=?`).bind(await sha("key|" + presentedKey)).first<Link>(); // the helper's AI key knows its own link
    if (!h && !(link && auth.kind === "ai")) return notAllowed();
    if (!link || link.state !== "active" || !link.org) return json({ error: "That client is not active." }, 404);
    if (!eid) return json({ error: "Say which game." }, 400);
    const own = await db.prepare("SELECT 1 AS x FROM helpdesk_game g JOIN engagement e ON e.id=g.eid WHERE g.eid=? AND g.link_id=? AND e.org=?").bind(eid, link.id, link.org).first();
    if (!own) return json({ error: "That game was not prepared through this client." }, 404);
    const draft = await isDraft(eid);
    if (!draft) return json({ error: "That game is already published.", code: "already-published" }, 409);
    const last = await db.prepare("SELECT created_ms, tmp_key_hash FROM helpdesk_pub WHERE link_id=? AND eid=? ORDER BY created_ms DESC LIMIT 1").bind(link.id, eid).first<{ created_ms: number; tmp_key_hash: string | null }>();
    if (last && now - last.created_ms < RESEND_MS) return json({ error: "The Organizer was asked a moment ago. Please wait a few minutes before asking again.", code: "wait" }, 429);
    if (!(await spend(4))) return busy();
    for (const o of (await db.prepare("SELECT tmp_key_hash FROM helpdesk_pub WHERE link_id=? AND eid=?").bind(link.id, eid).all<{ tmp_key_hash: string | null }>()).results ?? []) if (o.tmp_key_hash) await db.prepare("UPDATE organizer_key SET revoked=1 WHERE hash=?").bind(o.tmp_key_hash).run();
    await db.prepare("DELETE FROM helpdesk_pub WHERE link_id=? AND eid=?").bind(link.id, eid).run(); // one outstanding approval per game: a new one replaces the old
    const token = randHex(24);
    await db.prepare("INSERT INTO helpdesk_pub(token_hash,link_id,eid,org,created_ms,exp_ms) VALUES(?,?,?,?,?,?)").bind(await sha("hdpub|" + token), link.id, eid, link.org, now, now + APPROVAL_DAYS * 86_400_000).run();
    const sum = await ctx.summary(link.org, eid);
    const hn = await helperName(db, link.partner_code), to = await openText(env as any, link.org_email_sealed);
    const what = sum ? [`Game: ${sum.name || eid}`, sum.startsAtIST ? `Starts: ${sum.startsAtIST}` : "", sum.limit ? `Up to ${sum.limit} people` : "", Array.isArray(sum.rewards) && sum.rewards.length ? `Prizes: ${sum.rewards.length}` : ""].filter(Boolean).join("\n") : `Game: ${eid}`;
    if (to) await sendMail(env, db, to, `${hn} asks you to publish a game`, `${hn} has prepared a game for you and asks you to publish it.\n\n${what}\n\nLook at it and publish with one tap: ${origin}/helpdesk-approve.html?t=${token}\n\nPublishing is free. Nothing is published or paid until you tap. The link works once, for ${APPROVAL_DAYS} days.`, now, { secret: true });
    return json({ ok: true, sent: true });
  }

  // ---- Organizer: the invitation page ----
  if (req.method === "GET" && p === "/api/helpdesk/accept/info") {
    const l = await linkByToken(url.searchParams.get("t")); if (!l) return json({ error: "Not found" }, 404);
    const hn = await helperName(db, l.partner_code), expired = l.state === "invited" && now - l.created_ms > INVITE_DAYS * 86_400_000;
    return json({ helperName: hn, state: expired ? "expired" : l.state, forEmailMasked: maskEmail((await openText(env as any, l.org_email_sealed)) ?? "x@x"), version: HD1_VERSION, promise: hd1Lines(hn) });
  }
  if (req.method === "POST" && p === "/api/helpdesk/accept") {
    if (auth.kind !== "master" || !auth.org) return json({ error: "Please sign in first.", code: "sign-in" }, 403);
    const b = await body(req); const l = await linkByToken(b?.t); if (!l) return json({ error: "Not found" }, 404);
    if (l.state !== "invited" || now - l.created_ms > INVITE_DAYS * 86_400_000) return gone(l.state);
    if (b?.consent !== true) return json({ error: "Please tap Allow to agree.", code: "consent-required" }, 400);
    const mine = await db.prepare("SELECT 1 AS x FROM organizer_email WHERE email_hash=? AND org=?").bind(l.org_email_hash, auth.org).first();
    if (!mine) return json({ error: "This invitation was sent to a different e-mail address. Sign in with the address it was sent to.", code: "wrong-account" }, 403);
    if (!(await spend(6))) return busy();
    const claimed = await db.prepare("UPDATE helpdesk_link SET state='active', org=?, accepted_ms=?, consent_ms=?, consent_text_hash=? WHERE id=? AND state='invited'").bind(auth.org, now, now, await sha(HD1_VERSION + "|" + HD1_TEMPLATE.join("\n")), l.id).run();
    if ((claimed.meta?.changes ?? 0) !== 1) return gone("active");
    const key = "cba_" + randHex(24), kh = await sha("key|" + key);
    await db.batch([
      db.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test,label,created_by) VALUES(?,?,?,0,?,COALESCE((SELECT MAX(k2.is_test) FROM organizer_key k2 WHERE k2.org=?),0),?,'d')").bind(kh, auth.org, "ai", now, auth.org, "Help desk"),
      db.prepare("UPDATE helpdesk_link SET ai_key_hash=?, ai_key_sealed=? WHERE id=?").bind(kh, await sealText(env as any, key), l.id),
    ]);
    const hn = await helperName(db, l.partner_code), masked = maskEmail((await openText(env as any, l.org_email_sealed)) ?? "x@x");
    await helperMail(env, l.partner_code, "An Organizer allowed you to prepare games", `The Organizer (${masked}) allowed you to prepare games for them.\n\nOpen Help Desk to start: ${origin}/helpdesk.html\n\nYou cannot publish or pay: the Organizer publishes with one tap when you ask.`, now);
    return json({ ok: true, state: "active", helperName: hn });
  }
  if (req.method === "POST" && p === "/api/helpdesk/stop") {
    const b = await body(req);
    let l: Link | null = null, byHelper = false;
    if (typeof b?.t === "string") l = await linkByToken(b.t);
    else if (auth.kind === "master" && auth.org) { l = await linkById(b?.linkId); if (l && l.org !== auth.org) l = null; }
    else { const h = await helper(); if (h) { l = await linkById(b?.linkId); if (l && l.partner_code !== h.code) l = null; byHelper = true; } else return notAllowed(); }
    if (!l) return json({ error: "Not found" }, 404);
    if (!(await spend(4))) return busy();
    await stopLink(env, l, now, !byHelper);
    return json({ ok: true, state: "stopped" });
  }
  if (req.method === "GET" && p === "/api/helpdesk/mine") {
    if (auth.kind !== "master" || !auth.org) return notAllowed();
    const rows = (await db.prepare(`SELECT ${LINK_COLS} FROM helpdesk_link WHERE org=? ORDER BY created_ms DESC LIMIT 100`).bind(auth.org).all<Link>()).results ?? [];
    const helpers = [];
    for (const l of rows) helpers.push({ id: l.id, helperName: await helperName(db, l.partner_code), state: l.state, acceptedMs: l.accepted_ms, stoppedMs: l.stopped_ms, games: (await db.prepare("SELECT COUNT(*) AS c FROM helpdesk_game WHERE link_id=?").bind(l.id).first<{ c: number }>())?.c ?? 0 });
    return json({ helpers });
  }

  // ---- Organizer: the one-tap publish approval (the token in the e-mailed link is the proof; same trust as the sign-in link) ----
  const approval = async (t: unknown) => {
    if (typeof t !== "string" || !TOKEN.test(t)) return null;
    const pub = await db.prepare("SELECT token_hash, link_id, eid, org, exp_ms, used_ms, tmp_key_hash FROM helpdesk_pub WHERE token_hash=?").bind(await sha("hdpub|" + t)).first<{ token_hash: string; link_id: string; eid: string; org: string; exp_ms: number; used_ms: number | null; tmp_key_hash: string | null }>();
    if (!pub) return null;
    const link = await linkById(pub.link_id);
    return { pub, link, state: pub.used_ms ? "used" : pub.exp_ms < now ? "expired" : !link || link.state !== "active" ? "stopped" : "open" };
  };
  if (req.method === "GET" && p === "/api/helpdesk/approve/info") {
    const a = await approval(url.searchParams.get("t")); if (!a) return json({ error: "Not found" }, 404);
    if (a.state !== "open") return gone(a.state);
    const sum = await ctx.summary(a.pub.org, a.pub.eid);
    const published = (await isDraft(a.pub.eid)) === false;
    return json({ eid: a.pub.eid, helperName: await helperName(db, a.link!.partner_code), state: published ? "published" : "waiting",
      summary: sum ? { id: sum.id, name: sum.name ?? null, startsAtIST: sum.startsAtIST, limit: sum.limit, tickets: sum.tickets, rounds: sum.rounds, gameMinutes: sum.gameMinutes, rewards: Array.isArray(sum.rewards) ? sum.rewards.map((r: any) => ({ label: houseLabel(String(r?.pattern ?? "")), pattern: r?.pattern ?? null, ordinal: r?.ordinal ?? 1, text: typeof r?.text === "string" ? r.text : "" })) : [], breaks: Array.isArray(sum.breaks) ? sum.breaks.length : 0, whoCanJoin: sum.whoCanJoin, status: sum.status, priceInr: sum.priceInr ?? null } : null });
  }
  if (req.method === "POST" && p === "/api/helpdesk/approve/start") {
    const b = await body(req); const a = await approval(b?.t); if (!a) return json({ error: "Not found" }, 404);
    if (a.state !== "open") return gone(a.state);
    if ((await isDraft(a.pub.eid)) === null) return json({ error: "That game no longer exists." }, 404);
    if (!(await spend(3))) return busy();
    if (a.pub.tmp_key_hash) await db.prepare("UPDATE organizer_key SET revoked=1 WHERE hash=?").bind(a.pub.tmp_key_hash).run(); // a second start replaces the first key
    const key = "cbk_" + randHex(24), kh = await sha("key|" + key), exp = now + TMP_KEY_MS;
    await db.batch([
      db.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,expires_ms,is_test,label,created_by) VALUES(?,?,?,0,?,?,COALESCE((SELECT MAX(k2.is_test) FROM organizer_key k2 WHERE k2.org=?),0),?,'dp')").bind(kh, a.pub.org, "master", now, exp, a.pub.org, "Publish approval"),
      db.prepare("UPDATE helpdesk_pub SET tmp_key_hash=? WHERE token_hash=?").bind(kh, a.pub.token_hash),
    ]);
    return json({ ok: true, key, expiresMs: exp, eid: a.pub.eid });
  }
  if (req.method === "POST" && p === "/api/helpdesk/approve/done") {
    const b = await body(req); const a = await approval(b?.t); if (!a) return json({ error: "Not found" }, 404);
    if (a.state !== "open") return gone(a.state);
    const link = a.link!;
    if ((await isDraft(a.pub.eid)) !== false) return json({ error: "The game is not published yet.", code: "not-published" }, 409);
    if (!(await spend(8))) return busy();
    const used = await db.prepare("UPDATE helpdesk_pub SET used_ms=? WHERE token_hash=? AND used_ms IS NULL").bind(now, a.pub.token_hash).run();
    if ((used.meta?.changes ?? 0) !== 1) return gone("used");
    if (a.pub.tmp_key_hash) await db.prepare("UPDATE organizer_key SET revoked=1 WHERE hash=?").bind(a.pub.tmp_key_hash).run();
    const hn = await helperName(db, link.partner_code), label = `Help desk: ${hn}`.slice(0, 40);
    let deskKey = "";
    const have = link.host_hash ? await db.prepare("SELECT 1 AS x FROM organizer_key WHERE hash=? AND kind='host' AND revoked=0").bind(link.host_hash).first() : null;
    let hid = link.host_hash;
    if (!have) { // the helper becomes the desk Host: not counted among the Organizer's 5 Hosts, named "Help desk: <name>" in the team list
      deskKey = "cbh_" + randHex(24); hid = await sha("key|" + deskKey);
      const h = await db.prepare("SELECT email_sealed FROM helpdesk_helper WHERE partner_code=?").bind(link.partner_code).first<{ email_sealed: string }>();
      await db.batch([
        db.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test,label,email_sealed,pii,created_by,host_id) VALUES(?,?,?,0,?,COALESCE((SELECT MAX(k2.is_test) FROM organizer_key k2 WHERE k2.org=?),0),?,?,NULL,'d',?)").bind(hid, a.pub.org, "host", now, a.pub.org, label, h?.email_sealed ?? null, hid),
        db.prepare("INSERT INTO host_state(host_id,org,link_exp_ms,mobile_ok) VALUES(?,?,?,0)").bind(hid, a.pub.org, now + HOST_LINK_TTL_MS),
        db.prepare("UPDATE helpdesk_link SET host_hash=? WHERE id=?").bind(hid, link.id),
      ]);
    }
    // a 24-hour Host AI link for this game (a device key of the same Host: it stops with the Host)
    const aiHostKey = "cbh_" + randHex(24);
    await mintDeviceKey(env as unknown as Env, hid!, aiHostKey, now);
    await db.prepare("UPDATE organizer_key SET expires_ms=? WHERE hash=?").bind(now + 24 * 3_600_000, await sha("key|" + aiHostKey)).run();
    const pm = helpDeskPublishedMail(origin, { eid: a.pub.eid, ...(deskKey ? { hostKey: deskKey } : {}), aiHostKey, expiresMs: now + 24 * 3_600_000 });
    await helperMail(env, link.partner_code, pm.subject, pm.text, now, { html: pm.html, secret: true });
    return json({ ok: true, published: true });
  }

  return json({ error: "Not found" }, 404);
}
