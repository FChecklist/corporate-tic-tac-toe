// Corporate Tic Tac Toe's side of the master console bridge: the only game-specific file. The bridge itself (console-bridge/, copied from the console repo) never reads Bingo's tables;
// everything it needs goes through this adapter. Dark by default: with no CONSOLE_PUBKEYS the bridge answers nothing (the game's ordinary 404).
import type { Env } from "./worker";
import type { Adapter, KeyAuth, RoleRow } from "./console-bridge/bridge";
import type { D1 as BridgeD1 } from "./console-bridge/d1";
import { PACKS } from "../../../packages/shared/src/pricing";
import { MAX_DRAFTS, sendMail, type PayEnv, FREE_GAME_CAP, LATE_PAY_LEAD_ROUNDS } from "./pay";
import { GRACE_ROUNDS } from "../../../packages/beacon/src/config";
import { openText, sealText } from "./pii";
import { testFlag } from "./mode";
import { hostKeyStatus } from "./hostsetup";
import { activeCreditSummary } from "./credit";
import RELEASES from "./releases.json";

/** the biggest game that is published at Rs 0 in this game (0 = this game has none yet) */
const FREE_DEMO: number = FREE_GAME_CAP;
const GENESIS_S = 1692803367; // drand quicknet: round r is published at GENESIS_S + (r-1)*3 s
const startMsOf = (round: number) => (GENESIS_S + (round - 1) * 3) * 1000;
const roundOf = (ms: number) => Math.floor((ms / 1000 - GENESIS_S) / 3) + 1;
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const randHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const nameOf = (config: string | null, eid: string): string => { try { const n = JSON.parse(config || "{}").name; return typeof n === "string" && n.trim() ? n.trim().slice(0, 80) : eid; } catch { return eid; } };
const brandOf = (config: string | null): string | null => { try { const n = JSON.parse(config || "{}").brand?.name; return typeof n === "string" && n.trim() ? n.trim().slice(0, 80) : null; } catch { return null; } };
const PREFIX = { master: "cbk_", host: "cbh_", cohost: "cbc_" } as const;
export const CONSOLE_KEY_LABEL = "console";

const GAME_ROWS = "SELECT e.id, e.org, e.start_round, e.created_ms, e.cap, e.pack, e.config, e.cancelled_ms, e.unplayed_ms, " +
  "(SELECT end_ms FROM life WHERE eid=e.id) AS end_ms, " +
  "(SELECT 1 FROM kv WHERE k='pub/'||e.id) AS pub, " +
  "(SELECT 1 FROM kv WHERE k='cpaid/'||e.id) AS cpaid, " + // paid through the console's Pay step (markPaid below): the game has no payment row of its own for it
  "(SELECT 1 FROM payment p WHERE p.status='paid' AND (p.eid=e.id OR p.id IN (SELECT payment_id FROM entitlement WHERE eid=e.id)) LIMIT 1) AS paid, " +
  "(SELECT p.amount FROM payment p WHERE p.status='paid' AND (p.eid=e.id OR p.id IN (SELECT payment_id FROM entitlement WHERE eid=e.id)) ORDER BY p.paid_ms DESC LIMIT 1) AS amount, " +
  "(SELECT p.currency FROM payment p WHERE p.status='paid' AND (p.eid=e.id OR p.id IN (SELECT payment_id FROM entitlement WHERE eid=e.id)) ORDER BY p.paid_ms DESC LIMIT 1) AS currency " +
  "FROM engagement e";

/** the seven words the console uses, derived from Bingo's own state (same rule as the owner desk's organizerLookup, in the console's vocabulary) */
export function statusOf(r: { cancelled_ms: number | null; end_ms: number | null; unplayed_ms: number | null; paid: unknown; cpaid?: unknown; pub: unknown; cap: number; start_round: number }, now: number) {
  const startMs = startMsOf(Number(r.start_round));
  const freePublished = !!r.pub && Number(r.cap) <= FREE_DEMO; // a game for up to 10 people is published at Rs 0
  const paidish = !!r.paid || !!r.cpaid || freePublished;
  const status = r.cancelled_ms ? "cancelled" : r.end_ms && Number(r.end_ms) <= now ? "finished" : r.unplayed_ms ? "not_started" : paidish ? (startMs > now ? "ready" : "playing") : r.pub ? "waiting_payment" : "draft";
  const nextAction = status === "draft" ? "publish" : status === "waiting_payment" ? "pay" : status === "ready" ? "share" : status === "playing" ? "run" : "none";
  const payment: any = status === "cancelled" ? { state: "none" } : r.paid || r.cpaid ? { state: "paid" } : freePublished ? { state: "free" } : r.pub ? { state: "waiting" } : { state: "none" };
  return { status, nextAction, payment, startMs };
}

/** a refusal that changed nothing: the bridge answers it as "definite" */
const refuse = (m: string) => Object.assign(new Error(m), { definite: true });
/** the game and whether `sub` (an e-mail hash) is its ORGANIZER: an organizer account of the game's own org. A Host or Co-host (game_role) never counts, and neither does the platform key. */
async function payGameOf(env: Env, eid: string, sub: string) {
  const g = await env.DB.prepare("SELECT id, org, cap, pack, start_round, cancelled_ms, unplayed_ms, (SELECT end_ms FROM life WHERE eid=engagement.id) AS end_ms FROM engagement WHERE id=?").bind(eid).first<any>();
  const who = g ? await env.DB.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(sub).first<{ org: string }>() : null;
  return { g, owner: !!g && !!who && who.org === g.org };
}

export function consoleAdapter(clock: number = Date.now()): Adapter<Env> {
  const db = (env: Env) => env.DB as unknown as BridgeD1;
  const ad: Adapter<Env> = {
    game: "tictactoe", gameName: "Corporate Tic Tac Toe", gameVersion: String((RELEASES as Array<{ version: string }>)[0]?.version ?? "0.0.0"),
    nowMs: () => clock,
    origin: (env) => ((env as PayEnv).PUBLIC_ORIGIN ?? "").replace(/\/$/, ""),
    pubkeys: (env) => (env as any).CONSOLE_PUBKEYS,
    db,

    organizerOf: async (env, eh) => { const r = await env.DB.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(eh).first<{ org: string }>(); return r ? { org: r.org } : null; },
    createOrganizer: async (env, email, eh) => {
      const org = randHex(8), aiKey = "cba_" + randHex(24), test = await testFlag(env), now = clock;
      await env.DB.prepare("INSERT INTO organizer_email(email_hash,org,is_test) VALUES(?,?,?)").bind(eh, org, test).run();
      await env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test) VALUES(?,?,?,0,?,?)").bind(await sha("key|" + aiKey), org, "ai", now, test).run();
      await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`orgmail/${org}`, await sealText(env as any, email)).run();
      await env.DB.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(`aikey/${org}`, await sealText(env as any, aiKey)).run();
      return { org };
    },
    mintKey: async (env, k) => {
      const key = PREFIX[k.kind] + randHex(24), test = await testFlag(env);
      await env.DB.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test,expires_ms,label,eid,created_by) VALUES(?,?,?,0,?,?,?,?,?,?)").bind(await sha("key|" + key), k.org, k.kind, clock, test, k.expiresMs, CONSOLE_KEY_LABEL, k.eid, k.createdBy).run();
      return key;
    },
    revokeKeys: async (env, createdBy) => { await env.DB.prepare("UPDATE organizer_key SET revoked=1 WHERE created_by=? AND label=?").bind(createdBy, CONSOLE_KEY_LABEL).run(); },
    authOfKey: async (env, key, now): Promise<KeyAuth | null> => {
      if (!key) return null;
      if (env.ORGANIZER_SECRET && key === env.ORGANIZER_SECRET) return { org: null, kind: "platform", eid: null };
      const kh = await sha("key|" + key);
      const r = await env.DB.prepare("SELECT org, kind, eid, host_id, label, created_by FROM organizer_key WHERE hash=? AND revoked=0 AND (expires_ms IS NULL OR expires_ms>?)").bind(kh, now).first<any>();
      if (!r) return null;
      if (r.label === CONSOLE_KEY_LABEL) { if (r.eid && (await keyGameEnded(env, r.eid, now))) return null; return { org: r.org, kind: r.kind, eid: r.eid ?? null, createdBy: r.created_by }; }
      if (r.kind === "host") { const hs = await hostKeyStatus(env.DB, kh, r.host_id, now); if (!hs.usable || !hs.ready) return null; }
      return { org: r.org, kind: r.kind, eid: r.eid ?? null, createdBy: r.created_by };
    },
    engagement: async (env, eid) => {
      const r = await env.DB.prepare("SELECT org, config, cancelled_ms, (SELECT end_ms FROM life WHERE eid=engagement.id) AS end_ms FROM engagement WHERE id=?").bind(eid).first<any>();
      return r ? { org: r.org, name: nameOf(r.config, eid), ended: !!r.cancelled_ms || (!!r.end_ms && Number(r.end_ms) <= clock) } : null;
    },

    // The console's Pay step (docs/GAME_PAY_CONTRACT.md in the console repo). In this game "paid" means engagement.pack <> 0: while pack = 0 a published game is held when its start time comes (worker.ts locked), so
    // setting pack is the ONLY thing that unlocks the start, and only markPaid does it for a console payment.
    payInfo: async (env, o) => { // read-only: the organizer's own game only (a Host, a Co-host or a stranger is not the owner)
      const { g, owner } = await payGameOf(env, o.eid, o.sub);
      return { owner, item: owner && g ? String(g.cap) : null, paid: owner && !!g && Number(g.pack) !== 0 };
    },
    markPaid: async (env, o) => {
      const { g, owner } = await payGameOf(env, o.eid, o.sub);
      if (!g || !owner) throw refuse("This game does not belong to the person who paid.");
      if (String(g.cap) !== o.item) throw refuse("The size paid for is not the size of this game.");
      if (Number(g.pack) !== 0) return; // already paid (by this order or any other): success again, nothing changes, nothing is extended or reset
      if (g.cancelled_ms || g.unplayed_ms || (g.end_ms && Number(g.end_ms) <= o.nowMs)) throw refuse("This game is closed, so it cannot be paid.");
      const pack = Number(g.cap) > FREE_DEMO ? PACKS.find((p) => p[0] >= Number(g.cap))?.[0] : undefined; // the size bought: the smallest listed one that holds the game (the same rule as the old checkout)
      if (!pack) throw refuse("There is no size to pay for this game.");
      // a game that was held because it was unpaid at its start time begins 2 minutes after the payment (the same rule as fulfil() in pay.ts)
      const restart = startMsOf(Number(g.start_round)) <= o.nowMs ? Math.floor((o.nowMs / 1000 - GENESIS_S) / 3) + 2 + LATE_PAY_LEAD_ROUNDS - GRACE_ROUNDS : null;
      const kvIf = (k: string, v: string) => env.DB.prepare("INSERT OR IGNORE INTO kv(k,v) SELECT ?,? WHERE EXISTS (SELECT 1 FROM engagement WHERE id=? AND pack<>0)").bind(k, v, o.eid);
      // ONE batch (one transaction on D1): the unlock and the records about it land together or not at all, so a call that dies halfway leaves nothing half-done and a rerun starts clean
      const res = await env.DB.batch([
        env.DB.prepare("UPDATE engagement SET pack=?, cap=MIN(cap,?), start_round=COALESCE(?, start_round) WHERE id=? AND org=? AND pack=0 AND start_round=? AND cancelled_ms IS NULL AND unplayed_ms IS NULL").bind(pack, pack, restart, o.eid, g.org, g.start_round),
        kvIf(`pub/${o.eid}`, String(o.nowMs)), // paying also publishes a draft (as in fulfil())
        kvIf(`cpaid/${o.eid}`, JSON.stringify({ orderRef: o.orderRef, pack, item: o.item, ms: o.nowMs })), // the order reference stays with the game record
        kvIf(`paidby/${o.eid}`, JSON.stringify({ by: "organizer", ms: o.nowMs, via: "console" })),
      ]);
      if (((res[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0) === 1) return;
      // nothing changed: somebody else paid it in the meantime (fine), or the start time moved under us (try again; the console repeats the same order)
      const now2 = await payGameOf(env, o.eid, o.sub);
      if (now2.g && Number(now2.g.pack) !== 0) return;
      throw new Error("The game changed while it was being saved. It will be tried again.");
    },

    listGames: async (env, a) => {
      const now = clock, rows: any[] = [];
      const toRow = (r: any, role: string, state?: RoleRow["state"], invitedBy?: string | null) => {
        const s = statusOf(r, now);
        const payment = { ...s.payment };
        if (s.payment.state === "paid" && r.amount != null && (role === "organizer" || role === "host")) { payment.amountMinor = Math.round(Number(r.amount) * 100); payment.currency = r.currency === "USD" ? "USD" : "INR"; }
        return { game: "tictactoe", eid: r.id, role, status: s.status, startMs: s.startMs, cap: Number(r.cap), pack: Number(r.pack ?? 0), name: nameOf(r.config, r.id), payment, invitedBy: role === "organizer" ? null : (brandOf(r.config) ?? invitedBy ?? null), liveNow: s.status === "playing", nextAction: state === "invited" ? "accept" : s.nextAction, createdMs: Number(r.created_ms) };
      };
      if (a.org) for (const r of (await env.DB.prepare(GAME_ROWS + " WHERE e.org=? ORDER BY e.created_ms DESC LIMIT 500").bind(a.org).all<any>()).results ?? []) rows.push(toRow(r, "organizer"));
      for (const ro of a.roles) {
        if (ro.state === "ended") continue;
        const r = await env.DB.prepare(GAME_ROWS + " WHERE e.id=?").bind(ro.eid).first<any>();
        if (r) rows.push(toRow(r, ro.role, ro.state));
      }
      rows.sort((x, y) => y.createdMs - x.createdMs || x.eid.localeCompare(y.eid));
      const off = Number(a.cursor || 0) || 0;
      return { games: rows.slice(off, off + a.limit), next: off + a.limit < rows.length ? String(off + a.limit) : null };
    },

    billing: async (env, a) => {
      if (!a.org) return { rows: [], credit: null, next: null };
      const now = clock, out: any[] = [];
      const paid = (await env.DB.prepare("SELECT p.id, p.currency, p.amount, p.paid_ms, p.created_ms, p.eid AS peid, (SELECT eid FROM entitlement WHERE payment_id=p.id LIMIT 1) AS eeid, (SELECT token FROM invoice WHERE payment_id=p.id) AS inv FROM payment p WHERE p.org=? AND p.status='paid' ORDER BY p.paid_ms DESC LIMIT 500").bind(a.org).all<any>()).results ?? [];
      for (const p of paid) {
        const eid: string | null = p.peid ?? p.eeid ?? null;
        const g = eid ? await env.DB.prepare("SELECT config FROM engagement WHERE id=?").bind(eid).first<{ config: string | null }>() : null;
        const by = eid ? (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind("paidby/" + eid).first<{ v: string }>())?.v : null;
        let who = "organizer"; try { const j = JSON.parse(by || "{}").by; who = j === "host" ? "host" : j === "co-host" ? "cohost" : j === "link" ? "link" : "organizer"; } catch { /* organizer */ }
        out.push({ tsMs: Number(p.paid_ms ?? p.created_ms), game: "tictactoe", eid: eid ?? "UNKNOWN", gameName: g ? nameOf(g.config, eid!) : "Game", what: "pack", amountMinor: Math.round(Number(p.amount) * 100), currency: p.currency === "USD" ? "USD" : "INR", status: "paid", paidBy: who, invoice: p.inv ? "/api/invoice/" + p.inv : null });
      }
      const waiting = (await env.DB.prepare(GAME_ROWS + " WHERE e.org=? AND e.cancelled_ms IS NULL ORDER BY e.created_ms DESC LIMIT 200").bind(a.org).all<any>()).results ?? [];
      for (const r of waiting) {
        const s = statusOf(r, now);
        if (s.status !== "waiting_payment") continue;
        const pack = PACKS.find((p) => p[0] >= Number(r.cap)); if (!pack) continue;
        out.push({ tsMs: Number(r.created_ms), game: "tictactoe", eid: r.id, gameName: nameOf(r.config, r.id), what: "pack", amountMinor: pack[1] * 100, currency: "INR", status: "waiting", paidBy: "organizer", invoice: null });
      }
      out.sort((x, y) => y.tsMs - x.tsMs);
      const rows = out.filter((x) => (!a.fromMs || x.tsMs >= a.fromMs) && (!a.toMs || x.tsMs <= a.toMs));
      const off = Number(a.cursor || 0) || 0;
      const c = await activeCreditSummary(env.DB, a.org, now);
      return { rows: rows.slice(off, off + 50), credit: c.activeTotalInr > 0 && c.nextExpiryMs ? { balanceMinor: Math.round(c.activeTotalInr * 100), currency: "INR", expiresMs: c.nextExpiryMs } : null, next: off + 50 < rows.length ? String(off + 50) : null };
    },

    invitedCards: async () => [], // participant e-mail invitations arrive with the parity package (W17)
    purgePerson: async () => 0,
    live: async (env) => {
      const now = clock, lo = roundOf(now - 3 * 3600_000), hi = roundOf(now + 3600_000);
      const rows = (await env.DB.prepare(GAME_ROWS + " WHERE e.start_round BETWEEN ? AND ? AND e.cancelled_ms IS NULL").bind(lo, hi).all<any>()).results ?? [];
      let playing = 0, soon = 0;
      for (const r of rows) { const s = statusOf(r, now); if (s.status === "playing") playing++; else if (s.status === "ready" && s.startMs - now <= 3600_000) soon++; }
      // a tournament that is starting or running counts too: the deploy guard must not touch the game while one is on (tournament.ts: ttt_t.state)
      const t = await env.DB.prepare("SELECT COUNT(*) AS c FROM ttt_t WHERE state IN ('starting','running')").first<{ c: number }>();
      return { playing, startingWithin60: soon, tournamentsRunning: Number(t?.c ?? 0) };
    },
    capabilities: async () => ({
      sizes: [...(FREE_DEMO > 0 ? [{ pack: FREE_DEMO, inrMinor: 0, usdMinor: 0, free: true }] : []), ...PACKS.map(([n, inr, usd]) => ({ pack: n, inrMinor: Math.round(inr * 100), usdMinor: Math.round(usd * 100), free: false }))],
      freeDemoCap: FREE_DEMO, currencies: ["INR", "USD"],
      features: { roles: true, log: false, upgrade: false, preview: false, trail: false, invited: false },
      limits: { drafts: MAX_DRAFTS }, options: {},
    }),

    sendRoleInvite: async (env, m) => {
      const console_ = ((env as any).CONSOLE_ORIGIN as string | undefined) || "https://console.corporatetambola.com";
      const role = m.role === "host" ? "Host" : "Co-host";
      const text = `You have been invited to be a ${role} of the Corporate Tic Tac Toe game "${m.gameName}".\n\nTo accept: open ${console_} , sign in with THIS e-mail address (a code is sent to it), and press Accept under "Needs your attention".\n\nIf this was not meant for you, ignore this e-mail: nothing happens until you accept.`;
      await sendMail(env as PayEnv, env.DB, m.to, `You are invited as ${role}: ${m.gameName}`, text, clock);
    },
    seal: async (env, t) => sealText(env as any, t),
    unseal: async (env, s) => (await openText(env as any, s)) ?? "",
  };
  return ad;
}

/** true when the game a console key is tied to is over or cancelled: such a key stops at its very next request */
export async function keyGameEnded(env: Env, eid: string, now: number): Promise<boolean> {
  const r = await env.DB.prepare("SELECT cancelled_ms, (SELECT end_ms FROM life WHERE eid=engagement.id) AS end_ms FROM engagement WHERE id=?").bind(eid).first<{ cancelled_ms: number | null; end_ms: number | null }>();
  return !r || !!r.cancelled_ms || (!!r.end_ms && Number(r.end_ms) <= now);
}

/** What a console key that is tied to ONE game may call: that game's own addresses, who-am-I, notices, invoices and payment. Everything account-wide (history, team, keys, credit list, new games, owner tools) is refused. */
export function scopedKeyMayCall(eid: string, method: string, path: string): boolean {
  if (path === "/api/whoami" || path === "/api/notices") return true;
  if (path.startsWith("/api/invoice/") || path.startsWith("/api/paylink/")) return true;
  if (path === "/api/checkout" || path === "/api/payments/status" || path.startsWith("/api/payments/")) return true; // the payer is checked again against the game inside pay.ts
  const m = /^\/api\/z\/([^/]+)(\/.*)?$/.exec(path);
  if (m) { try { return decodeURIComponent(m[1] as string) === eid; } catch { return false; } } // a broken %-escape is simply "not this game" (it used to throw out of the Worker)
  return false;
}
