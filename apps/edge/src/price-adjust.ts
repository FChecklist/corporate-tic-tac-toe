// A private price for ONE game id (owner only, kept quiet). The list price (pricing.ts, the pack price) never changes. The owner may add a signed adjustment to a single unpaid game;
// the organizer simply sees the amount payable for that game (one total) and pays it. Nothing public names this feature: no field, no link, no line on a page, no word in a response.
//   net payable = list price + adjustment, never below 1 (Rs 1 / US$ 1) and never above 2 x the list price (MAX_NET_FACTOR).
// The adjustment is only read while the game is unpaid, and only for the currency it was set in. Once the game is paid (pack <> 0) nothing is applied and nothing can be set.
// The owner's form is NOT in any public page or script: /api/owner/panel (owner key only, 404 otherwise) sends the form as data and the owner page just draws it.
// Written to port: this file imports only the D1 type and the pack prices; each game adds ADJUST_SCHEMA, the call sites (docs/PRICE_ADJUST.md) and the owner routes.
import { PACKS, price } from "../../../packages/shared/src/pricing";
import type { D1 } from "./worker";

/** The only wording the organizer can ever meet: the single line on the invoice or receipt, beside the amount actually charged. */
export const PRICE_LINE = "price as agreed";
/** The smallest amount that may be charged: Rs 1 or US$ 1 (100 paise / cents). The Rs 1 live payment test uses exactly this. */
export const MIN_NET_MINOR = 100;
/** The largest net: twice the list price. This only stops a typing slip (an extra zero) from sending an organizer a huge bill. */
export const MAX_NET_FACTOR = 2;
export const REASON_MAX = 200;
/** What travels with the Razorpay order (and so into the central ledger) in place of the owner's free-text note. */
export const ADJUST_CODE = "owner_adjust";

export const ADJUST_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS price_adjust (eid TEXT PRIMARY KEY, currency TEXT NOT NULL, adjust_minor INTEGER NOT NULL, reason TEXT NOT NULL, set_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS price_adjust_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, eid TEXT NOT NULL, at_ms INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, currency TEXT NOT NULL, list_minor INTEGER NOT NULL, old_adjust_minor INTEGER, new_adjust_minor INTEGER, net_minor INTEGER, reason TEXT)`,
  `CREATE INDEX IF NOT EXISTS price_adjust_audit_eid ON price_adjust_audit (eid)`,
];

export type Cur = "INR" | "USD";
export const listMinor = (pack: number, cur: Cur): number => Math.round(price(pack, cur).total * 100);
export const maxNetMinor = (list: number): number => list * MAX_NET_FACTOR;
/** Net for a list price and an adjustment, or the plain reason it is not allowed. */
export function netOf(list: number, adjust: number): { ok: true; net: number } | { ok: false; error: string } {
  if (!Number.isInteger(adjust) || adjust === 0) return { ok: false, error: "Enter an amount to reduce or to add. It cannot be zero." };
  const net = list + adjust;
  if (net < MIN_NET_MINOR) return { ok: false, error: `The game would cost less than the lowest price of ${MIN_NET_MINOR / 100}. Reduce by less.` };
  if (net > maxNetMinor(list)) return { ok: false, error: "The game would cost more than twice its list price. Add less." };
  return { ok: true, net };
}

export interface AppliedAdjust { listMinor: number; adjustMinor: number; netMinor: number; currency: Cur }
/** The price that applies to this game NOW, in this currency; null when there is none, it was set in the other currency, or it no longer fits the list price. Never throws (a missing table means no adjustment). */
export async function adjustFor(db: D1, eid: string | null | undefined, pack: number, cur: Cur): Promise<AppliedAdjust | null> {
  if (!eid || !(pack > 0)) return null;
  try {
    const r = await db.prepare("SELECT currency, adjust_minor FROM price_adjust WHERE eid=?").bind(eid).first<{ currency: string; adjust_minor: number }>();
    if (!r || r.currency !== cur) return null;
    const list = listMinor(pack, cur), n = netOf(list, r.adjust_minor);
    return n.ok ? { listMinor: list, adjustMinor: r.adjust_minor, netMinor: n.net, currency: cur } : null;
  } catch { return null; }
}
/** The same, in whichever currency it was set, for the page that shows the organizer what is payable (the page compares the currency itself). */
export async function adjustAnyCur(db: D1, eid: string, pack: number | null): Promise<AppliedAdjust | null> {
  if (!pack) return null;
  return (await adjustFor(db, eid, pack, "INR")) ?? (await adjustFor(db, eid, pack, "USD"));
}
const major = (m: number) => Math.round(m) / 100;
/** The ONLY thing a payer's page learns: the amount payable for this game, in a currency. No list price, no adjustment, no reason. */
export const payablePublic = (c: AppliedAdjust | null) => (c ? { currency: c.currency, amount: major(c.netMinor) } : null);
/** Order notes for Razorpay / the central ledger: list, adjustment and net in minor units plus a fixed code (never the owner's free text). Put FIRST in the notes: the central service keeps only the first few. */
export const adjustNotes = (c: AppliedAdjust | null): Record<string, string> => (c ? { list_minor: String(c.listMinor), adjust_minor: String(c.adjustMinor), net_minor: String(c.netMinor), adjust_code: ADJUST_CODE } : {});
/** What is stored with the payment (meta) so the invoice, the owner mail and the owner reports can show it later. */
export const adjustMeta = (c: AppliedAdjust | null) => (c ? { priceAdjust: { listMinor: c.listMinor, adjustMinor: c.adjustMinor, netMinor: c.netMinor, code: ADJUST_CODE } } : {});

export interface GameRow { id: string; cap: number; pack: number | null; org: string | null; config: string | null; cancelled_ms: number | null; unplayed_ms: number | null }
/** The pack a game of this limit is sold as (the same rule as checkout). */
export const packOf = (cap: number): number | null => PACKS.find((x) => x[0] >= cap)?.[0] ?? null;

/** What the owner sees for one game id. */
export async function lookupGame(db: D1, eid: string, now: number) {
  const g = await db.prepare("SELECT id, cap, pack, org, config, cancelled_ms, unplayed_ms FROM engagement WHERE id=?").bind(eid).first<GameRow>();
  if (!g) return null;
  const published = g.pack !== 0 || !!(await db.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`pub/${eid}`).first());
  const status = g.pack !== 0 ? "paid" : g.cancelled_ms ? "cancelled" : g.unplayed_ms ? "closed" : published ? "published, not paid" : "draft, not paid";
  const confirming = g.pack === 0 && !!(await db.prepare("SELECT 1 AS x FROM payment WHERE eid=? AND status<>'paid' AND confirming_ms IS NOT NULL AND confirming_ms>?").bind(eid, now - 30 * 60_000).first().catch(() => null));
  const pack = g.pack !== 0 ? g.pack : packOf(g.cap);
  let name = ""; try { const c = g.config ? JSON.parse(g.config) : {}; if (typeof c.name === "string") name = c.name.slice(0, 120); } catch { /* the id is the name */ }
  const editable = g.pack === 0 && !g.cancelled_ms && !g.unplayed_ms && !confirming && !!pack;
  const row = await db.prepare("SELECT currency, adjust_minor, reason, set_ms FROM price_adjust WHERE eid=?").bind(eid).first<{ currency: Cur; adjust_minor: number; reason: string; set_ms: number }>().catch(() => null);
  const audit = ((await db.prepare("SELECT at_ms, actor, action, currency, list_minor, old_adjust_minor, new_adjust_minor, net_minor, reason FROM price_adjust_audit WHERE eid=? ORDER BY id DESC LIMIT 10").bind(eid).all<any>().catch(() => ({ results: [] as any[] }))).results ?? []);
  return { g, pack, status, name, editable, confirming, row, audit };
}

const money = (n: number, c: Cur) => (c === "USD" ? "US$ " : "Rs ") + n.toLocaleString(c === "USD" ? "en-US" : "en-IN", { maximumFractionDigits: 2 });
const when = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";

/**
 * Owner-only routes (the caller proves the owner key and that it is not an AI work link; for everybody else the route simply does not exist):
 *   GET  /api/owner/panel            the owner page draws this: a box to find a game id
 *   GET  /api/owner/panel?q=<id>     the game's facts, and the form / buttons / history as plain data (strings live here, never in a public script)
 *   POST /api/owner/price {eid, currency, direction: "down"|"up", amount (positive) | amount (signed), reason}   or   {eid, remove: true}
 *   GET  /api/owner/price?eid=<id>   the same facts as data, for reports
 */
export async function adjustRoute(req: Request, db: D1, now: number, owner: boolean, deny: (what: string) => Promise<void>): Promise<Response | null> {
  const url = new URL(req.url), path = url.pathname;
  if (path !== "/api/owner/price" && path !== "/api/owner/panel") return null;
  const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const ok = req.method === "GET" || (req.method === "POST" && path === "/api/owner/price");
  if (!owner || !ok) { await deny("denied:price"); return null; } // not the owner: carry on as if this address did not exist (the very same answer as any unknown address)

  const facts = async (eid: string) => {
    const x = await lookupGame(db, eid, now); if (!x) return null;
    const c = x.pack && x.row ? await adjustFor(db, eid, x.pack, x.row.currency) : null;
    const list = x.pack && x.pack !== 10 ? { INR: listMinor(x.pack, "INR") / 100, USD: listMinor(x.pack, "USD") / 100 } : null;
    return { x, c, list, data: { eid, name: x.name, status: x.status, pack: x.pack, editable: x.editable, confirming: x.confirming, list,
      adjustment: x.row ? { currency: x.row.currency, amount: major(x.row.adjust_minor), net: c ? major(c.netMinor) : null, reason: x.row.reason, setMs: x.row.set_ms, applies: !!c && x.editable } : null,
      limits: { min: MIN_NET_MINOR / 100, maxTimesList: MAX_NET_FACTOR },
      audit: x.audit.map((a: any) => ({ atMs: a.at_ms, by: a.actor, action: a.action, currency: a.currency, from: a.old_adjust_minor == null ? null : major(a.old_adjust_minor), to: a.new_adjust_minor == null ? null : major(a.new_adjust_minor), net: a.net_minor == null ? null : major(a.net_minor), reason: a.reason })) } };
  };

  if (path === "/api/owner/panel") {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    const find = { method: "GET", path: "/api/owner/panel", fields: [{ id: "q", label: "Game ID", type: "text", value: q, maxLength: 60 }], submit: "Find game" };
    if (!q) return J({ title: "Price of one game", text: ["Find a game by its ID. You change the price of that one game only. The list price never changes."], form: find });
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(q)) return J({ title: "Price of one game", text: ["Enter a game ID."], form: find }, 400);
    const f = await facts(q); if (!f) return J({ error: "No game with that ID." }, 404);
    const { x, c, list, data } = f, cur: Cur = x.row?.currency ?? "INR";
    const rows: [string, string][] = [["Game ID", q], ["Name", x.name || "(none)"], ["Players", x.pack ? `Up to ${x.pack}` : "-"], ["List price", list ? `${money(list.INR, "INR")} / ${money(list.USD, "USD")}` : "-"], ["Status", x.status]];
    if (x.row) rows.push(["Price set", `${x.row.adjust_minor < 0 ? "Reduce by" : "Add"} ${money(Math.abs(major(x.row.adjust_minor)), x.row.currency)} (${x.row.reason})`], ["Organizer pays", c ? money(major(c.netMinor), x.row.currency) : "-"]);
    const view: any = { title: `Game ${q}`, facts: rows, text: [] as string[], back: find };
    if (x.g.pack !== 0) view.text.push("This game is paid. Its price is locked.");
    else if (!x.editable) view.text.push(x.confirming ? "A payment is being confirmed. Try again in a few minutes." : `The price cannot be changed for this game (${x.status}).`);
    else if (list) {
      view.text.push(`The organizer pays the list price plus or minus your amount. The lowest is ${money(1, cur)}; the most is twice the list price.`);
      const sel = (id: string, label: string, opts: [string, string][], value: string) => ({ id, label, type: "select", options: opts.map(([v, t]) => ({ value: v, label: t })), value });
      view.form = { method: "POST", path: "/api/owner/price", fixed: { eid: q }, submit: x.row ? "Change price" : "Save price", done: "Saved. Tell the organizer by phone.",
        fields: [sel("currency", "Currency", [["INR", "Rupees (INR)"], ["USD", "Dollars (USD)"]], cur), sel("direction", "Change", [["down", "Reduce"], ["up", "Add"]], x.row && x.row.adjust_minor > 0 ? "up" : "down"),
          { id: "amount", label: "Amount", type: "number", min: 0, step: 0.01, value: x.row ? String(Math.abs(major(x.row.adjust_minor))) : "" }, { id: "reason", label: "Note", type: "text", maxLength: REASON_MAX, placeholder: "e.g. agreed on phone 2 Nov", value: x.row?.reason ?? "" }],
        fills: [{ label: "Make it Rs 1 (payment test)", set: { currency: "INR", direction: "down", amount: String(list.INR - 1), reason: x.row?.reason || "payment test" } }, { label: "Make it US$ 1 (payment test)", set: { currency: "USD", direction: "down", amount: String(list.USD - 1), reason: x.row?.reason || "payment test" } }] };
      if (x.row) view.buttons = [{ label: "Remove", method: "POST", path: "/api/owner/price", body: { eid: q, remove: true }, confirm: "Remove the price change? The organizer will pay the list price.", done: "Removed." }];
    }
    if (data.audit.length) view.table = { title: "History", head: ["When", "What", "From", "To", "Organizer pays", "Note"], rows: data.audit.map((a: any) => [when(a.atMs), a.action, a.from == null ? "" : money(a.from, a.currency), a.to == null ? "" : money(a.to, a.currency), a.net == null ? "" : money(a.net, a.currency), a.reason || ""]) };
    return J(view);
  }

  if (req.method === "GET") {
    const eid = (url.searchParams.get("eid") ?? "").trim().slice(0, 60);
    if (!/^[A-Za-z0-9_-]{2,60}$/.test(eid)) return J({ error: "Enter a game ID." }, 400);
    const f = await facts(eid); return f ? J(f.data) : J({ error: "No game with that ID." }, 404);
  }
  let b: any = null;
  { const t = await req.text(); if (t.length > 2048) return J({ error: "Too long." }, 400); try { b = JSON.parse(t); } catch { b = null; } if (!b || typeof b !== "object") return J({ error: "Bad request." }, 400); }
  const eid = String(b.eid ?? "").trim().slice(0, 60);
  if (!/^[A-Za-z0-9_-]{2,60}$/.test(eid)) return J({ error: "Enter a game ID." }, 400);
  const x = await lookupGame(db, eid, now);
  if (!x) return J({ error: "No game with that ID." }, 404);
  if (x.g.pack !== 0) return J({ error: "This game is already paid. Its price cannot be changed now.", code: "paid" }, 409);
  if (x.g.cancelled_ms || x.g.unplayed_ms) return J({ error: "This game is cancelled or closed. Its price cannot be changed.", code: "closed" }, 409);
  if (x.confirming) return J({ error: "A payment for this game is being confirmed. Try again in a few minutes.", code: "confirming" }, 409);
  if (!x.pack) return J({ error: "This size is arranged directly. No price change here." }, 400);
  const next = `/api/owner/panel?q=${encodeURIComponent(eid)}`;
  if (b.remove === true) {
    if (!x.row) return J({ error: "This game has no price change." }, 404);
    const cur = x.row.currency;
    await db.batch([
      db.prepare("DELETE FROM price_adjust WHERE eid=?").bind(eid),
      db.prepare("INSERT INTO price_adjust_audit(eid,at_ms,actor,action,currency,list_minor,old_adjust_minor,new_adjust_minor,net_minor,reason) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(eid, now, "owner", "remove", cur, listMinor(x.pack, cur), x.row.adjust_minor, null, null, x.row.reason),
    ]);
    return J({ ok: true, removed: true, next });
  }
  const cur: Cur = b.currency === "USD" ? "USD" : "INR";
  const raw = typeof b.amount === "number" ? b.amount : typeof b.amount === "string" && b.amount.trim() !== "" ? Number(b.amount.trim()) : NaN;
  if (!Number.isFinite(raw) || Math.abs(raw) > 1e7) return J({ error: "Enter an amount." }, 400);
  const signed = b.direction === "down" ? -Math.abs(raw) : b.direction === "up" ? Math.abs(raw) : raw; // with no direction the amount carries its own sign
  const adjust = Math.round(signed * 100);
  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, REASON_MAX) : "";
  if (reason.length < 3) return J({ error: "Write a short note about why (for example: agreed on phone)." }, 400);
  const list = listMinor(x.pack, cur), n = netOf(list, adjust);
  if (!n.ok) return J({ error: n.error }, 400);
  await db.batch([
    db.prepare("INSERT INTO price_adjust(eid,currency,adjust_minor,reason,set_ms) VALUES(?,?,?,?,?) ON CONFLICT(eid) DO UPDATE SET currency=excluded.currency, adjust_minor=excluded.adjust_minor, reason=excluded.reason, set_ms=excluded.set_ms").bind(eid, cur, adjust, reason, now),
    db.prepare("INSERT INTO price_adjust_audit(eid,at_ms,actor,action,currency,list_minor,old_adjust_minor,new_adjust_minor,net_minor,reason) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(eid, now, "owner", x.row ? "change" : "set", cur, list, x.row ? x.row.adjust_minor : null, adjust, n.net, reason),
  ]);
  return J({ ok: true, net: major(n.net), currency: cur, next });
}
