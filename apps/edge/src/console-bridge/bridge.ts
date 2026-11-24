// THE BRIDGE: the one piece of code every game shares to talk to the master console. Written once here, copied byte for byte into each game (tools/vendor-bridge.mjs).
// It never reads a game's tables itself: everything game-specific goes through the Adapter that each game writes (a thin file next to its worker).
// Rules that cannot be bent:
//  * DARK: with no CONSOLE_PUBKEYS every /api/console/* request is handed back (null) to the game, which answers its normal 404.
//  * The console only proves WHO the person is. The game decides the role from its own tables (organizer account, game_role). The 'hint' in an assertion is ignored.
//  * Every assertion is for this game's address, for the right purpose, short-lived, and used once.
import type { D1 } from "./d1";
import { normEmail } from "./email";
import { parseKeyList, verifyAssertion, type Act, type Payload } from "./assertion";
import { ensureBridgeSchema } from "./schema";

export const BRIDGE_VERSION = 1; // the contract number (contract/VERSION)
export const BRIDGE_SCHEMA_NUMBER = 2; // the build of the bridge itself; the Versions page warns when a game is behind
export const KEY_LIFE_MS = 2 * 3600_000;
export const HANDOFF_KEY_MS = 16 * 3600_000;
export const HANDOFF_LINK_MS = 60_000;
/** the address word a hand-off carries when it is for "Start a new game": no game exists yet, and the key made for it belongs to no single game */
export const NEW_EID = "_new_";

export type GameId = "tambola" | "bingo" | "tictactoe" | "snakesladders" | "luckbychance" | "luckydraw";
export type KeyKind = "master" | "host" | "cohost";
export interface KeyAuth { org: string | null; kind: string; eid: string | null; createdBy?: string | null }
export interface RoleRow { roleId: string; eid: string; role: "host" | "cohost"; state: "invited" | "accepted" | "ended"; invitedBy: string | null }

/** how long a "being saved" mark blocks another try (milliseconds) */
export const MARK_LEASE_MS = 30_000;
export interface Adapter<Env = any> {
  game: GameId;
  gameName: string;
  gameVersion: string;
  nowMs(): number;
  origin(env: Env): string; // this game's own address: what 'aud' must be
  pubkeys(env: Env): string | undefined; // CONSOLE_PUBKEYS
  db(env: Env): D1;
  // identity, from the game's own tables
  organizerOf(env: Env, emailHash: string): Promise<{ org: string } | null>;
  createOrganizer(env: Env, email: string, emailHash: string): Promise<{ org: string }>;
  mintKey(env: Env, o: { kind: KeyKind; org: string; eid: string | null; expiresMs: number; createdBy: string }): Promise<string>; // always label 'console'
  revokeKeys(env: Env, createdBy: string): Promise<void>;
  authOfKey(env: Env, key: string, nowMs: number): Promise<KeyAuth | null>; // the game's existing key check
  engagement(env: Env, eid: string): Promise<{ org: string; name: string; ended: boolean } | null>;
  // lists
  listGames(env: Env, a: { org: string | null; roles: RoleRow[]; cursor: string | null; limit: number }): Promise<{ games: any[]; next: string | null }>;
  billing(env: Env, a: { org: string | null; roles: RoleRow[]; cursor: string | null; fromMs: number | null; toMs: number | null }): Promise<{ rows: any[]; credit: any | null; next: string | null }>;
  invitedCards(env: Env, emailHash: string): Promise<any[]>;
  purgePerson(env: Env, emailHash: string): Promise<number>;
  live(env: Env): Promise<{ playing: number; startingWithin60: number; tournamentsRunning?: number; story?: string; counts?: { joined?: number; waiting?: number; done?: number; total?: number } }>;
  capabilities(env: Env): Promise<{ sizes: any[]; freeDemoCap: number; currencies: string[]; features: Record<string, boolean>; limits: { drafts: number }; options?: Record<string, unknown> }>;
  // mail and sealing
  sendRoleInvite(env: Env, o: { to: string; eid: string; role: "host" | "cohost"; gameName: string }): Promise<void>;
  seal(env: Env, text: string): Promise<string>;
  unseal(env: Env, sealed: string): Promise<string>;
  /** The console says a Moneypenny order for this game is paid (act 'paid'). The game checks, from its own tables, that the game exists, belongs to the organizer `sub`, is unpaid (or already paid by this order) and that `item` is its size; it then marks the game PAID and answers. To refuse it throws an Error with `definite = true` (nothing was changed). Without this method the route answers 404. */
  /** Read-only: is this game the organizer's own (the account of `sub`, as ORGANIZER, not a host), what size is it, is it already paid. The console asks this before any pay step. */
  payInfo?(env: Env, o: { eid: string; sub: string }): Promise<{ owner: boolean; item: string | null; paid: boolean }>;
  markPaid?(env: Env, o: { eid: string; sub: string; item: string; orderRef: string; nowMs: number }): Promise<void>;
  previewUrl?(env: Env, o: { eid: string; nowMs: number }): Promise<{ url: string; expiresMs: number } | null>;
}

const CORS: Record<string, string> = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, x-organizer, x-console-step", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-max-age": "86400" };
const H = { "content-type": "application/json", "cache-control": "no-store", ...CORS };
const ok = (body: Record<string, unknown>) => new Response(JSON.stringify({ ok: true, ...body }), { status: 200, headers: H });
const err = (status: number, error: string, message: string, extra: Record<string, string> = {}) => new Response(JSON.stringify({ ok: false, error, message, ...extra }), { status, headers: H });
const ASSERT_MSG: Record<string, [number, string, string]> = {
  bad_assertion: [401, "bad_assertion", "This sign-in could not be checked. Please sign in again."],
  expired: [401, "expired", "This sign-in has run out. Please try again."],
  wrong_audience: [401, "wrong_audience", "This sign-in was made for another game."],
  unknown_kid: [401, "unknown_kid", "This sign-in was made with a key this game does not know."],
  wrong_act: [401, "wrong_act", "This sign-in is for something else."],
};
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const randHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256hex = async (s: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/;
const EID_RE = /^[A-Za-z0-9_-]{4,40}$/;
const emailHashOf = (email: string) => sha256hex("email|" + normEmail(email));

/** 'a***@acme.com' - enough for the organizer to recognise the person, not the address */
export const emailHint = (email: string) => { const [u, d] = email.split("@"); return (u?.[0] ?? "?") + "***@" + (d ?? ""); };

/** the rule every game applies in can()/mayPay()/history: a key tied to one game is good for that game only */
export const keyFitsGame = (a: { eid?: string | null }, eid: string | null | undefined) => a.eid == null || (eid != null && a.eid === eid);
/** account-wide routes (history, team, keys, credit list ...) are not for a key that is tied to one game */
export const keyIsAccountWide = (a: { eid?: string | null }) => a.eid == null;

/** returns the answer, or null when the request is none of the bridge's business (including when the bridge is dark) */
export async function handleConsole<Env>(ad: Adapter<Env>, req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.startsWith("/api/console/")) return null;
  const keys = parseKeyList(ad.pubkeys(env));
  if (!keys.length) return null; // DARK
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const db = ad.db(env), nowMs = ad.nowMs(), nowS = Math.floor(nowMs / 1000), aud = ad.origin(env);
  await ensureBridgeSchema(db);
  const body = req.method === "POST" ? await req.json().catch(() => null) : null;

  /** verify an assertion, check its purpose and use it up */
  const assertion = async (token: unknown, act: Act, eid?: string): Promise<{ pl: Payload } | { res: Response }> => {
    const v = await verifyAssertion(token, { keys, aud, nowS, act });
    if (!v.ok) { const m = ASSERT_MSG[v.error] as [number, string, string]; return { res: err(m[0], m[1], m[2]) }; }
    if (eid !== undefined && v.payload.eid !== eid) return { res: err(401, "wrong_act", "This sign-in is for another game.") };
    const used = await db.prepare("INSERT OR IGNORE INTO console_jti(jti, exp_s) VALUES(?,?)").bind(v.payload.jti, v.payload.exp).run();
    if (used.meta.changes !== 1) return { res: err(401, "replayed", "This sign-in was already used. Please try again.") };
    await db.prepare("DELETE FROM console_jti WHERE exp_s<?").bind(nowS - 3600).run(); // keep the table small
    return { pl: v.payload };
  };
  const keyOf = async () => { const k = req.headers.get("x-organizer"); return k ? ad.authOfKey(env, k, nowMs) : null; };
  const rolesOf = async (sub: string): Promise<RoleRow[]> => (await db.prepare("SELECT role_id, eid, role, state, invited_by FROM game_role WHERE email_hash=? ORDER BY invited_ms").bind(sub).all<any>()).results.map((r) => ({ roleId: r.role_id, eid: r.eid, role: r.role, state: r.state, invitedBy: r.invited_by }));
  /** may this key act on this game? Organizer of the owning account, or a key tied to exactly this game */
  const mayUse = async (a: KeyAuth | null, eid: string) => {
    if (!a || !a.org || !["master", "host", "cohost"].includes(a.kind)) return null; // never the owner's platform key, never an AI key
    const e = await ad.engagement(env, eid);
    if (!e || e.org !== a.org) return null;
    return keyFitsGame(a, eid) ? e : null;
  };
  const step = async (sa: string, eid: string): Promise<{ pl: Payload } | { res: Response }> => {
    const h = req.headers.get("x-console-step");
    if (!h) return { res: err(403, "step_up_required", "Please confirm with your sign-in once more.") };
    const r = await assertion(h, "stepup", eid);
    if ("res" in r) return r;
    if (r.pl.sa !== sa) return { res: err(403, "step_up_required", "That confirmation is for a different action.") };
    return r;
  };

  if (req.method === "GET" && path === "/api/console/capabilities") {
    const c = await ad.capabilities(env);
    return ok({ bridge: BRIDGE_VERSION, schema: BRIDGE_SCHEMA_NUMBER, game: ad.game, gameName: ad.gameName, gameVersion: ad.gameVersion, origin: aud, kids: keys.map((k) => k.kid), ...c });
  }
  if (req.method === "GET" && path === "/api/console/live") return ok({ game: ad.game, ...(await ad.live(env)) });

  if (req.method === "POST" && path === "/api/console/session") {
    if (!body || typeof body.assertion !== "string") return err(400, "invalid", "The request is not complete.");
    const r = await assertion(body.assertion, "session"); if ("res" in r) return r.res;
    const sub = r.pl.sub;
    let acct = await ad.organizerOf(env, sub), created = false;
    if (!acct && body.create === true && r.pl.em && (await emailHashOf(r.pl.em)) === sub && EMAIL_RE.test(r.pl.em)) { acct = await ad.createOrganizer(env, r.pl.em, sub); created = true; } // the mailbox was proven by the console just now
    const organizer = acct ? { key: await ad.mintKey(env, { kind: "master", org: acct.org, eid: null, expiresMs: nowMs + KEY_LIFE_MS, createdBy: "c:" + sub }), expiresMs: nowMs + KEY_LIFE_MS, label: "console" as const } : null;
    const scoped = [];
    for (const rr of await rolesOf(sub)) {
      if (rr.state !== "accepted") continue;
      const e = await ad.engagement(env, rr.eid);
      if (!e || e.ended) continue;
      scoped.push({ eid: rr.eid, role: rr.role, key: await ad.mintKey(env, { kind: rr.role, org: e.org, eid: rr.eid, expiresMs: nowMs + KEY_LIFE_MS, createdBy: "r:" + rr.roleId }), expiresMs: nowMs + KEY_LIFE_MS });
    }
    return ok({ created, organizer, scoped });
  }

  if (req.method === "POST" && (path === "/api/console/games" || path === "/api/console/billing")) {
    const act: Act = path.endsWith("games") ? "games" : "billing";
    if (!body || typeof body.assertion !== "string") return err(400, "invalid", "The request is not complete.");
    const r = await assertion(body.assertion, act); if ("res" in r) return r.res;
    const acct = await ad.organizerOf(env, r.pl.sub), roles = await rolesOf(r.pl.sub);
    const cursor = typeof body.cursor === "string" ? body.cursor : null;
    if (act === "games") { const out = await ad.listGames(env, { org: acct?.org ?? null, roles, cursor, limit: Math.min(Math.max(Number(body.limit) || 50, 1), 100) }); return ok({ games: out.games, next: out.next }); }
    const out = await ad.billing(env, { org: acct?.org ?? null, roles, cursor, fromMs: Number.isFinite(body.fromMs) ? body.fromMs : null, toMs: Number.isFinite(body.toMs) ? body.toMs : null });
    return ok({ rows: out.rows, credit: out.credit, next: out.next });
  }

  if (req.method === "POST" && path === "/api/console/invited") {
    if (!body || typeof body.assertion !== "string") return err(400, "invalid", "The request is not complete.");
    const r = await assertion(body.assertion, "invited"); if ("res" in r) return r.res;
    return ok({ cards: await ad.invitedCards(env, r.pl.sub) });
  }

  if (req.method === "POST" && path === "/api/console/purge-email") {
    if (!body || typeof body.assertion !== "string") return err(400, "invalid", "The request is not complete.");
    const r = await assertion(body.assertion, "purge"); if ("res" in r) return r.res;
    let n = await ad.purgePerson(env, r.pl.sub);
    for (const rr of await rolesOf(r.pl.sub)) await revoke(ad, env, "r:" + rr.roleId);
    await revoke(ad, env, "c:" + r.pl.sub); // and every key the console made for this person
    const rolesErased = (await db.prepare("DELETE FROM game_role WHERE email_hash=?").bind(r.pl.sub).run()).meta.changes;
    return ok({ removed: n + rolesErased, rolesErased });
  }

  if (req.method === "POST" && path === "/api/console/role") {
    if (!body || typeof body.op !== "string" || typeof body.eid !== "string" || !EID_RE.test(body.eid)) return err(400, "invalid", "The request is not complete.");
    const eid: string = body.eid;
    if (body.op === "accept" || body.op === "decline") {
      const r = await assertion(body.assertion, "role", eid); if ("res" in r) return r.res;
      const row = await db.prepare("SELECT role_id, role, email_hash, state FROM game_role WHERE role_id=? AND eid=?").bind(String(body.roleId), eid).first<any>();
      if (!row) return err(404, "not_found", "That invitation does not exist any more.");
      if (row.email_hash !== r.pl.sub) return err(403, "not_yours", "This invitation was sent to a different e-mail address.");
      const e = await ad.engagement(env, eid);
      if (!e || e.ended) return err(409, "too_late", "That game is over.");
      if (body.op === "decline") { await db.prepare("DELETE FROM game_role WHERE role_id=?").bind(row.role_id).run(); return ok({}); }
      await db.prepare("UPDATE game_role SET state='accepted', accepted_ms=? WHERE role_id=? AND state='invited'").bind(nowMs, row.role_id).run();
      const key = await ad.mintKey(env, { kind: row.role, org: e.org, eid, expiresMs: nowMs + KEY_LIFE_MS, createdBy: "r:" + row.role_id });
      return ok({ scoped: { eid, role: row.role, key, expiresMs: nowMs + KEY_LIFE_MS } });
    }
    const a = await keyOf(); const e = await mayUse(a, eid);
    if (!e || !a || a.kind !== "master") return err(403, "forbidden", "Only the Organizer can change who helps with this game.");
    if (body.op === "list") {
      const rows = (await db.prepare("SELECT role_id, role, state, email_sealed FROM game_role WHERE eid=? AND state IN ('invited','accepted') ORDER BY invited_ms").bind(eid).all<any>()).results;
      return ok({ roles: await Promise.all(rows.map(async (x) => ({ roleId: x.role_id, role: x.role, state: x.state, emailHint: x.email_sealed ? emailHint(await ad.unseal(env, x.email_sealed)) : "***" }))) });
    }
    if (body.op === "invite") {
      const s = await step("role-add", eid); if ("res" in s) return s.res;
      const who = await ad.organizerOf(env, s.pl.sub);
      if (!who || who.org !== a.org) return err(403, "forbidden", "That confirmation belongs to someone else.");
      if (!["host", "cohost"].includes(body.role) || typeof body.email !== "string" || !EMAIL_RE.test(normEmail(body.email))) return err(400, "invalid", "Please give a role and a valid e-mail address.");
      if (e.ended) return err(409, "too_late", "That game is over.");
      const email = normEmail(body.email), eh = await emailHashOf(email);
      if (await db.prepare("SELECT 1 x FROM game_role WHERE eid=? AND email_hash=? AND state IN ('invited','accepted')").bind(eid, eh).first()) return err(409, "conflict", "That person is already on this game.");
      const roleId = randHex(5);
      await db.prepare("INSERT INTO game_role(role_id,eid,role,email_hash,email_sealed,state,invited_ms,invited_by) VALUES(?,?,?,?,?,'invited',?,?)").bind(roleId, eid, body.role, eh, await ad.seal(env, email), nowMs, a.org).run();
      await ad.sendRoleInvite(env, { to: email, eid, role: body.role, gameName: e.name }); // goes ONLY to the typed address
      return ok({ roleId });
    }
    if (body.op === "remove") {
      const s = await step("role-remove", eid); if ("res" in s) return s.res;
      const who = await ad.organizerOf(env, s.pl.sub);
      if (!who || who.org !== a.org) return err(403, "forbidden", "That confirmation belongs to someone else.");
      const gone = await db.prepare("DELETE FROM game_role WHERE role_id=? AND eid=?").bind(String(body.roleId), eid).run();
      if (gone.meta.changes !== 1) return err(404, "not_found", "That person is not on this game.");
      await revoke(ad, env, "r:" + String(body.roleId)); // their key stops working at the very next request
      return ok({});
    }
    return err(400, "invalid", "That action is not known.");
  }

  if (req.method === "POST" && path === "/api/console/handoff") {
    const isNew = !!body && body.target === "new"; // "Start a new game": no game exists yet, so no eid; only the Organizer may ask
    if (!body || !(isNew ? body.eid === undefined : typeof body.eid === "string" && EID_RE.test(body.eid) && body.eid !== NEW_EID) || !["organizer", "host", "big", "tournament", "pay", "publish", "new"].includes(body.target) || (body.free !== undefined && !(isNew && body.free === true))) return err(400, "invalid", "The request is not complete.");
    const a = await keyOf();
    let org: string | undefined;
    if (isNew) { if (a && a.kind === "master" && a.org && !a.eid) org = a.org; }
    else org = (await mayUse(a, body.eid))?.org;
    if (!org || !a) return err(403, "forbidden", isNew ? "Only the organizer can start a new game." : "You do not have a role in this game.");
    const eid = isNew ? NEW_EID : body.eid;
    const kind: KeyKind = a.kind === "master" ? "master" : a.kind === "host" ? "host" : "cohost";
    const t = randHex(24);
    await db.prepare("INSERT INTO console_handoff(token_hash,eid,kind,org,created_by,expires_ms) VALUES(?,?,?,?,?,?)").bind(await sha256hex("handoff|" + t), eid, kind, org, a.createdBy || "c:" + org, nowMs + HANDOFF_LINK_MS).run();
    await db.prepare("DELETE FROM console_handoff WHERE expires_ms<?").bind(nowMs - 3600_000).run(); // keep the table small
    return ok({ url: `${aud}/signin.html?t=${t}&go=console&e=${eid}${isNew ? (body.free === true ? "&free=1" : "") : "&to=" + body.target}`, expiresMs: nowMs + HANDOFF_LINK_MS }); // the page asked for travels in the address, so the game opens that page and not always the organizer screen
  }
  if (req.method === "POST" && path === "/api/console/handoff/redeem") {
    if (!body || typeof body.t !== "string" || !/^[0-9a-f]{48}$/.test(body.t)) return err(401, "expired", "This link has run out. Please open the game again from your console.");
    const th = await sha256hex("handoff|" + body.t);
    const row = await db.prepare("SELECT eid, kind, org, created_by, expires_ms FROM console_handoff WHERE token_hash=?").bind(th).first<any>();
    const used = row ? await db.prepare("DELETE FROM console_handoff WHERE token_hash=?").bind(th).run() : null; // single use
    if (!row || !used || used.meta.changes !== 1 || row.expires_ms < nowMs) return err(401, "expired", "This link has run out. Please open the game again from your console.");
    const life = row.eid === NEW_EID ? KEY_LIFE_MS : HANDOFF_KEY_MS; // a key for "start a new game" belongs to no single game yet, so it lives only as long as an ordinary console key
    const key = await ad.mintKey(env, { kind: row.kind, org: row.org, eid: row.eid === NEW_EID ? null : row.eid, expiresMs: nowMs + life, createdBy: row.created_by });
    return ok({ key, kind: row.kind, eid: row.eid, expiresMs: nowMs + life });
  }

  if (req.method === "POST" && path === "/api/console/signout") { // 'Sign out': every console key made for this person in this game stops at once (the console calls it for each key it holds)
    const a = await keyOf();
    if (!a || !a.createdBy || !/^[cr]:/.test(a.createdBy)) return err(403, "forbidden", "Only a key made by the console can be ended here.");
    await revoke(ad, env, a.createdBy);
    return ok({});
  }

  if (req.method === "POST" && path === "/api/console/payable") { // read-only: does this person own this game as its organizer, and what size is it
    if (!ad.payInfo) return err(404, "not_found", "This game does not take a paid notice yet.");
    if (!body || typeof body.assertion !== "string" || typeof body.eid !== "string" || !EID_RE.test(body.eid)) return err(400, "invalid", "The request is not complete.");
    const r = await assertion(body.assertion, "payable", body.eid); if ("res" in r) return r.res;
    const i = await ad.payInfo(env, { eid: body.eid, sub: r.pl.sub });
    return ok({ owner: i.owner === true, item: i.owner ? i.item : null, paid: i.owner === true && i.paid === true });
  }

  if (req.method === "POST" && path === "/api/console/paid") { // the console tells the game: this game is paid. Once per order id; the game then unlocks its start.
    if (!ad.markPaid) return err(404, "not_found", "This game does not take a paid notice yet.");
    if (!body || typeof body.assertion !== "string" || typeof body.item !== "string" || !/^[A-Za-z0-9_.-]{1,40}$/.test(body.item) || typeof body.orderRef !== "string" || !/^[A-Za-z0-9_-]{4,100}$/.test(body.orderRef) || typeof body.eid !== "string" || !EID_RE.test(body.eid)) return err(400, "invalid", "The request is not complete.");
    const r = await assertion(body.assertion, "paid", body.eid); if ("res" in r) return r.res;
    const row = await db.prepare("SELECT eid, state FROM console_paid WHERE order_ref=?").bind(body.orderRef).first<any>();
    if (row) {
      if (row.eid !== body.eid) return err(409, "conflict", "That payment belongs to another game.");
      if (row.state === "paid") return ok({ repeat: true, eid: body.eid });
      // 'marking' is a short lease: while it is fresh another try is told to wait; once it is older than MARK_LEASE_MS the next try takes it over (one winner) and marks again. The game's markPaid is idempotent, so a game that did mark before failing is simply told 'paid' again. Only 'paid' is final.
      const took = await db.prepare("UPDATE console_paid SET at_ms=? WHERE order_ref=? AND state='marking' AND at_ms<=?").bind(nowMs, body.orderRef, nowMs - MARK_LEASE_MS).run();
      if (took.meta.changes !== 1) return err(409, "in_progress", "This payment is being saved. Please try again in a moment.");
    } else {
      const ins = await db.prepare("INSERT OR IGNORE INTO console_paid(order_ref,eid,state,at_ms) VALUES(?,?,'marking',?)").bind(body.orderRef, body.eid, nowMs).run();
      if (ins.meta.changes !== 1) return err(409, "in_progress", "This payment is being saved. Please try again in a moment.");
    }
    try { await ad.markPaid(env, { eid: body.eid, sub: r.pl.sub, item: body.item, orderRef: body.orderRef, nowMs }); }
    catch (e: any) {
      if (e && e.definite === true) { await db.prepare("DELETE FROM console_paid WHERE order_ref=? AND state='marking'").bind(body.orderRef).run(); return err(409, "game_refused", String(e.message || "This game cannot take that payment."), { definite: "true" }); }
      return err(503, "unclear", "The game could not save the payment yet. It will be tried again."); // row stays 'marking'; the console repeats the same order id
    }
    await db.prepare("UPDATE console_paid SET state='paid', at_ms=? WHERE order_ref=?").bind(nowMs, body.orderRef).run();
    return ok({ repeat: false, eid: body.eid });
  }

  if (req.method === "POST" && path === "/api/console/preview") {
    if (!ad.previewUrl) return err(404, "not_found", "This game does not offer the player's screen view yet.");
    if (!body || typeof body.eid !== "string" || !EID_RE.test(body.eid)) return err(400, "invalid", "The request is not complete.");
    const a = await keyOf();
    if (!(await mayUse(a, body.eid))) return err(403, "forbidden", "You do not have a role in this game.");
    const p = await ad.previewUrl(env, { eid: body.eid, nowMs });
    return p ? ok(p) : err(404, "not_found", "This game does not offer the player's screen view yet.");
  }

  return err(404, "not_found", "There is nothing at this address.");
}

/** end every key of a group AND any hand-off link that group has made but nobody has opened yet (an unopened link must not outlive the key that made it) */
async function revoke<Env>(ad: Adapter<Env>, env: Env, group: string): Promise<void> {
  await ad.revokeKeys(env, group);
  await ad.db(env).prepare("DELETE FROM console_handoff WHERE created_by=?").bind(group).run();
}

/** call when a game ends (and when it is erased): every Host / Co-host key of that game stops, the role rows stay as history until the person's e-mail is purged */
export async function endRoles<Env>(ad: Adapter<Env>, env: Env, eid: string): Promise<number> {
  const db = ad.db(env);
  const rows = (await db.prepare("SELECT role_id FROM game_role WHERE eid=? AND state<>'ended'").bind(eid).all<any>()).results;
  for (const r of rows) await revoke(ad, env, "r:" + r.role_id);
  await db.prepare("UPDATE game_role SET state='ended' WHERE eid=? AND state<>'ended'").bind(eid).run();
  return rows.length;
}

/** Go-live D3: the one payment screen is the console's. With the flag PAY_VIA_CONSOLE = "1" a game's own payment screen and its own pay / credit routes answer 302 to the console (nothing is deleted: the data stays, the old code stays behind the flag).
 *  A game passes `extra` for any route of its own that starts a payment. Razorpay's own notice to the game is NOT in the list (money already paid must still be recorded). Returns null when the request is none of this business. */
export const LEGACY_PAY_ROUTES: RegExp[] = [/^\/(pay|paylink|paytest)\.html$/, /^\/api\/z\/[^/]+\/(paylink|order|verify|pay|credit|apply-credit)(\/|$)/, /^\/api\/(order|verify|credit)(\/|$)/];
export function legacyPayRedirect(req: Request, o: { flag: string | undefined; consoleOrigin: string; extra?: RegExp[] }): Response | null {
  if (o.flag !== "1") return null;
  const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  if (![...LEGACY_PAY_ROUTES, ...(o.extra ?? [])].some((r) => r.test(path))) return null;
  return new Response(null, { status: 302, headers: { location: o.consoleOrigin.replace(/\/$/, "") + "/", "cache-control": "no-store" } });
}
