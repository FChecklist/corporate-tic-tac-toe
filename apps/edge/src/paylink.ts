// A pay link anyone can open (Phase 3, docs/ROLES_AND_CONSOLE_SPEC_2.md item 13).
// The Organizer, a Host or a Co-host of a game makes ONE open link per game (a new one cancels the old). Whoever holds it - the company's finance person, say - opens
// /paylink.html?t=<token>, sees the game's name, start time and price (nothing else about the game) and pays like anyone else. The payment is bound to that game exactly
// like a payment from the console (pay.ts, checkout) and is recorded as paid by 'link'. The token is random (192 bits) and only its hash is stored.
// A link ends at payment, after 7 days, when it is replaced, or when the game is cancelled. An AI key can never make one.
import { PACKS, price } from "../../../packages/shared/src/pricing";
import type { D1 } from "./worker";

export const PAYLINK_TTL_MS = 7 * 86_400_000;
export const PAYLINK_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS paylink (hash TEXT PRIMARY KEY, eid TEXT NOT NULL, org TEXT NOT NULL, created_ms INTEGER NOT NULL, exp_ms INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS paylink_eid ON paylink (eid)`,
];

const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const randHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
export const PAYLINK_TOKEN = /^[0-9a-f]{48}$/;
export const payLinkHash = (token: string) => sha("paylink|" + token);
/** The smallest pack that holds the game's limit, or null when the game needs a custom arrangement. */
export const packFor = (cap: number): number | null => PACKS.find((x) => x[0] >= cap)?.[0] ?? null;

/** Makes the game's one open link (any earlier one stops at once). The caller has already checked who may do this and that the game can still be paid for. */
export async function createPayLink(db: D1, eid: string, org: string, by: string, now: number): Promise<{ token: string; expiresMs: number }> {
  const token = randHex(24), expiresMs = now + PAYLINK_TTL_MS;
  await db.batch([
    db.prepare("UPDATE paylink SET revoked=1 WHERE eid=? AND revoked=0").bind(eid),
    db.prepare("INSERT INTO paylink(hash,eid,org,created_ms,exp_ms,revoked,created_by) VALUES(?,?,?,?,?,0,?)").bind(await payLinkHash(token), eid, org, now, expiresMs, by),
  ]);
  return { token, expiresMs };
}

export type PayLinkStatus = "open" | "paid" | "expired" | "cancelled" | "confirming" | "closed";
export interface PayLinkView { link: { eid: string; org: string }; e: { id: string; org: string | null; cap: number; pack: number | null; start_round: number; config: string | null; cancelled_ms: number | null; unplayed_ms?: number | null; tickets?: number }; status: PayLinkStatus }

/** Looks a token up and works out where the payment stands. null = no such link (the same answer for a wrong, old or mistyped token). */
export async function lookupPayLink(db: D1, token: string, now: number): Promise<PayLinkView | null> {
  if (!PAYLINK_TOKEN.test(token)) return null;
  const link = await db.prepare("SELECT eid, org, exp_ms, revoked FROM paylink WHERE hash=?").bind(await payLinkHash(token)).first<{ eid: string; org: string; exp_ms: number; revoked: number }>();
  if (!link) return null;
  const e = await db.prepare("SELECT id, org, cap, pack, start_round, config, cancelled_ms, unplayed_ms, tickets FROM engagement WHERE id=?").bind(link.eid).first<PayLinkView["e"]>();
  if (!e || e.org !== link.org) return null;
  let status: PayLinkStatus;
  if (e.cancelled_ms) status = "cancelled";
  else if (e.unplayed_ms) status = "closed"; // the game did not start and its guest data was erased: nobody can pay for it any more
  else if (e.pack !== 0) status = "paid";
  else if (link.revoked || now > link.exp_ms) status = "expired";
  else {
    let confirming = false;
    try { confirming = !!(await db.prepare("SELECT 1 AS x FROM payment WHERE eid=? AND status<>'paid' AND confirming_ms IS NOT NULL AND confirming_ms>?").bind(e.id, now - 30 * 60_000).first()); } catch { /* no payment record */ }
    status = confirming ? "confirming" : "open";
  }
  return { link: { eid: link.eid, org: link.org }, e, status };
}

/** The only things a person holding the link may learn: the game's name and start time, and what it costs. */
export function payLinkPublic(v: PayLinkView, name: string, startMs: number, currency: "INR" | "USD" = "INR") {
  const pack = packFor(v.e.cap);
  const pr = pack ? price(pack, currency) : null;
  return { game: { name, startMs, participants: pack ?? undefined }, price: pr ? { base: pr.base, gst: pr.tax, total: pr.total, currency } : null, status: v.status };
}
