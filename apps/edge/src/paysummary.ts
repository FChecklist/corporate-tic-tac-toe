// The game block of the payment pages: game name, game ID, number of participants (the pack), start date and time, and the organizer (name when known, e-mail MASKED like j***@company.com).
// Shown on the payment-link page to whoever holds the link (the public payment test shows NO game: a typed game ID is never looked up there, so nothing leaks about which games exist). Nothing here is a participant’s detail: only the
// organizer's own name and e-mail, which the invoice and the payment e-mails already carry. The e-mail is always masked here; the full address never leaves the Worker on these routes.
import { openText, type PiiEnv } from "./pii";
import { packFor } from "./paylink";
import type { D1 } from "./worker";

const GENESIS_S = 1692803367; // the public beacon's first round: round r is published at GENESIS_S + (r - 1) * 3 seconds
export const startMsOfRound = (r: number) => (GENESIS_S + (r - 1) * 3) * 1000;

/** j***@company.com: the first letter, three stars and the domain. Anything that is not an address gives "". */
export function maskEmail(e: unknown): string {
  const s = typeof e === "string" ? e.trim() : "";
  const at = s.lastIndexOf("@");
  if (at < 1 || at === s.length - 1) return "";
  return Array.from(s)[0] + "***" + s.slice(at);
}

export interface GameSummary { id: string; name: string; startMs: number; participants: number | null; organizer: { name?: string; email?: string } }
type SummaryEnv = PiiEnv & { DB: D1 };

/** What the payment pages may show about one game. null = no such game. */
export async function gameSummary(env: SummaryEnv, eid: string): Promise<GameSummary | null> {
  const db = env.DB;
  const e = await db.prepare("SELECT id, org, cap, start_round, config FROM engagement WHERE id=?").bind(eid).first<{ id: string; org: string | null; cap: number; start_round: number; config: string | null }>();
  if (!e) return null;
  let name = e.id; try { const c = e.config ? JSON.parse(e.config) : {}; if (typeof c.name === "string" && c.name.trim()) name = c.name.trim().slice(0, 120); } catch { /* the id is the name */ }
  let email = "", orgName = "";
  try {
    if (e.org) email = (await openText(env, (await db.prepare("SELECT v FROM kv WHERE k=?").bind(`orgmail/${e.org}`).first<{ v: string }>())?.v)) ?? "";
    const c = await db.prepare("SELECT v FROM kv WHERE k=?").bind(`contact/${e.id}`).first<{ v: string }>();
    if (c) { const j = JSON.parse(c.v); if (!email && typeof j.email === "string") email = j.email; if (typeof j.name === "string") orgName = j.name.trim(); }
    if (!orgName && e.org) { // the name the organizer gave on their last real payment, when there is one
      const pm = await db.prepare("SELECT meta FROM payment WHERE org=? AND is_test=0 AND status='paid' ORDER BY created_ms DESC LIMIT 1").bind(e.org).first<{ meta: string }>();
      if (pm) { const m = JSON.parse(pm.meta); if (typeof m.name === "string") orgName = m.name.trim(); }
    }
  } catch { /* the organizer line is simply left out */ }
  const masked = maskEmail(email);
  return { id: e.id, name, startMs: startMsOfRound(e.start_round), participants: packFor(e.cap), organizer: { ...(orgName ? { name: orgName.slice(0, 80) } : {}), ...(masked ? { email: masked } : {}) } };
}

/** The pay-link answer plus the game ID and the organizer (read by paylink.js). The price and status stay exactly as the caller made them. */
export async function payLinkGame<T extends { game: Record<string, unknown> }>(env: SummaryEnv, eid: string, pub: T): Promise<T> {
  const s = await gameSummary(env, eid);
  return { ...pub, game: { ...pub.game, id: eid, ...(s && (s.organizer.name || s.organizer.email) ? { organizer: s.organizer } : {}) } };
}
