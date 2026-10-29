// Credit instead of refunds (docs/ROLES_AND_CONSOLE_SPEC_6.md, product rule 2026-10-08). THERE ARE NO REFUNDS.
//   - If the Organizer or a Host cancels a PAID game before its start time, what was paid stays with us as CREDIT for that Organizer's account. It can pay for a next game for 365 days
//     counted from the date of the original payment, until the end of day 365 in India time. Unused credit lapses then (no refund, no credit note). Cancelling an UNPAID game moves no money.
//   - A cancelled PAID game can be moved to a new date within 365 days of the payment (cancel.ts reopenGame): its unused credit is then marked 'revived' (never listed, never spendable) and the game keeps its payment.
//   - A payment that arrives after a game was cancelled (or after it closed as "did not start") is kept the same way: it becomes credit, never a refund.
//   - Using credit: oldest-expiring first. Credit >= price pays the game with no Razorpay; credit < price is used up and the rest is paid through the normal checkout (same game);
//     credit > price leaves the remainder active with the same expiry. Applying is atomic and idempotent (a game can never get more credit than its price; a credit never goes negative).
//   - Credit belongs to ONE organizer account (`org`). It is never shown to an outside pay-link payer: a pay link charges the full price unless its creator applied credit to the game first.
//   - Money in this file is rupees with 2 decimals; every comparison is done in whole paise.
//   - E-mails (Organizer + Hosts only, once each per credit): on cancel/arrival, 30 days before the lapse, 3 days before, on use, on lapse.
// `expires_ms` is the instant the credit lapses: 00:00 IST at the START of day 366 (= the end of day 365 in India time). A credit is usable while now < expires_ms.
import { PACKS, price } from "../../../packages/shared/src/pricing";
import { fulfil, PAYER, sendMail, type PayEnv } from "./pay";
import { openText } from "./pii";
import { orgIsTest, testFlag } from "./mode";
import type { D1, Env } from "./worker";

/** 0018_credit_retention_clone.sql */
export const CREDIT_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS credit (id TEXT PRIMARY KEY, org TEXT NOT NULL, payment_id TEXT, eid TEXT, kind TEXT NOT NULL DEFAULT 'cancel', total_inr REAL NOT NULL, remaining_inr REAL NOT NULL, lapsed_inr REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'INR', created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', is_test INTEGER NOT NULL DEFAULT 0, mail_created_ms INTEGER, mail30_ms INTEGER, mail3_ms INTEGER, mail_lapse_ms INTEGER)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS credit_payment ON credit (payment_id)`,
  `CREATE INDEX IF NOT EXISTS credit_org ON credit (org, status, expires_ms)`,
  `CREATE TABLE IF NOT EXISTS credit_use (id INTEGER PRIMARY KEY AUTOINCREMENT, credit_id TEXT NOT NULL, eid TEXT NOT NULL, amount_inr REAL NOT NULL, at_ms INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'applied', restored_ms INTEGER)`,
  `CREATE INDEX IF NOT EXISTS credit_use_eid ON credit_use (eid, status)`,
  `CREATE INDEX IF NOT EXISTS credit_use_credit ON credit_use (credit_id)`,
  `ALTER TABLE engagement ADD COLUMN unplayed_ms INTEGER`,
];

export const CREDIT_DAYS = 365;
const DAY = 86_400_000, IST = 19_800_000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const paise = (x: number) => Math.round(x * 100);
const randHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** The instant a credit made by a payment at `paidMs` lapses: the start of the day after day 365 (counting the payment's own India-time date as day 0). */
export const creditExpiryMs = (paidMs: number): number => (Math.floor((paidMs + IST) / DAY) + CREDIT_DAYS + 1) * DAY - IST;
/** The India-time date a person is told ("14 Jun 2027"): the LAST day the credit can be used. */
export const creditLastDay = (expiresMs: number): string => new Date(expiresMs - 1).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });
export const rs = (n: number, cur = "INR"): string => (cur === "USD" ? "US$" : "Rs ") + (Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n).toLocaleString(cur === "USD" ? "en-US" : "en-IN") : n.toLocaleString(cur === "USD" ? "en-US" : "en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const istStamp = (ms: number) => new Date(ms).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) + " IST";
const gameName = (e: { id: string; config?: string | null }) => { try { return JSON.parse(e.config ?? "{}").name || e.id; } catch { return e.id; } };

export interface CreditRow { id: string; org: string; payment_id: string | null; eid: string | null; kind: string; total_inr: number; remaining_inr: number; lapsed_inr: number; currency: string; created_ms: number; expires_ms: number; status: string; is_test: number; mail_created_ms: number | null; mail30_ms: number | null; mail3_ms: number | null; mail_lapse_ms: number | null }

/** Every address that should hear about a game or a credit: the Organizer, then each Host who has an e-mail (nobody else ever has one). */
export async function teamEmails(env: PayEnv, org: string | null, eid: string | null): Promise<{ organizer: string | null; hosts: string[] }> {
  let organizer: string | null = null;
  try {
    if (org) organizer = await openText(env as any, (await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`orgmail/${org}`).first<{ v: string }>())?.v);
    if (!organizer && eid) { const c = await env.DB.prepare("SELECT v FROM kv WHERE k=?").bind(`contact/${eid}`).first<{ v: string }>(); organizer = c ? (JSON.parse(c.v).email as string) : null; }
    if (!organizer && org) { const c = await env.DB.prepare("SELECT v FROM kv WHERE k LIKE 'contact/%' AND substr(k,9) IN (SELECT id FROM engagement WHERE org=?) LIMIT 1").bind(org).first<{ v: string }>(); organizer = c ? (JSON.parse(c.v).email as string) : null; }
  } catch { /* no organizer address known */ }
  const hosts: string[] = [];
  if (org) for (const r of (await env.DB.prepare("SELECT email_sealed FROM organizer_key WHERE org=? AND kind='host' AND revoked=0 AND expires_ms IS NULL AND (host_id IS NULL OR host_id=hash) AND email_sealed IS NOT NULL").bind(org).all<{ email_sealed: string }>()).results ?? []) { const x = await openText(env as any, r.email_sealed); if (x) hosts.push(x); }
  return { organizer, hosts };
}
/** Sends one mail to the Organizer and each Host (each address once). */
export async function mailTeam(env: PayEnv, org: string | null, eid: string | null, subject: string, text: string, now: number): Promise<void> {
  try {
    const tos = await teamEmails(env, org, eid), seen = new Set<string>();
    for (const to of [tos.organizer, ...tos.hosts]) { const t = (to ?? "").trim().toLowerCase(); if (!t || seen.has(t)) continue; seen.add(t); await sendMail(env, env.DB, t, subject, text, now); }
  } catch { /* a mail is a courtesy; the money records are already written */ }
}

/** The rule in one sentence, for e-mails and pages. */
export const NO_REFUND_LINE = "We do not give refunds. If you cancel a paid game before it starts, your payment stays as credit for your next game for 365 days. Unused credit lapses at the end of day 365.";

// ------------------------------------------------------------------------------------------------ making credit
/**
 * Turns money paid into credit (once per payment: the unique index on payment_id makes a second call return the first credit). Returns null when there is nothing to keep.
 * Valid for 365 days from the date of the ORIGINAL payment.
 */
export async function creditFromPayment(db: D1, p: { id: string; org?: string | null; amount: number; currency: string; paid_ms?: number | null; is_test?: number | null }, org: string, eid: string | null, now: number, kind: "cancel" | "late"): Promise<CreditRow | null> {
  const have = await db.prepare("SELECT * FROM credit WHERE payment_id=?").bind(p.id).first<CreditRow>();
  if (have) return have;
  if (!(p.amount > 0.004)) return null;
  const paidMs = p.paid_ms ?? now, exp = creditExpiryMs(paidMs), dead = exp <= now;
  const id = "cr_" + randHex(10);
  await db.prepare("INSERT OR IGNORE INTO credit(id,org,payment_id,eid,kind,total_inr,remaining_inr,lapsed_inr,currency,created_ms,expires_ms,status,is_test) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, org, p.id, eid, kind, r2(p.amount), dead ? 0 : r2(p.amount), dead ? r2(p.amount) : 0, p.currency, paidMs, exp, dead ? "expired" : "active", p.is_test ? 1 : 0).run();
  return (await db.prepare("SELECT * FROM credit WHERE payment_id=?").bind(p.id).first<CreditRow>()) ?? null;
}

/** Credit applied to one game so far (rupees). */
export async function creditAppliedFor(db: D1, eid: string): Promise<number> {
  return r2((await db.prepare("SELECT COALESCE(SUM(amount_inr),0) AS s FROM credit_use WHERE eid=? AND status='applied'").bind(eid).first<{ s: number }>())?.s ?? 0);
}
/** The uses of credit for one game with the source invoice numbers (for the invoice note). */
export async function creditUsesFor(db: D1, eid: string): Promise<{ credit_id: string; amount: number; invoice: string | null }[]> {
  const rows = (await db.prepare("SELECT cu.credit_id AS credit_id, SUM(cu.amount_inr) AS amount, (SELECT i.number FROM credit c JOIN invoice i ON i.payment_id=c.payment_id WHERE c.id=cu.credit_id) AS invoice FROM credit_use cu WHERE cu.eid=? AND cu.status='applied' GROUP BY cu.credit_id ORDER BY MIN(cu.id)").bind(eid).all<any>()).results ?? [];
  return rows.map((r: any) => ({ credit_id: r.credit_id, amount: r2(r.amount), invoice: r.invoice ?? null }));
}
/**
 * Puts credit used for a game back (the game was cancelled, or the extra part of a payment in progress). `keepInr` = how much of the use stays (default 0 = all comes back).
 * The credit returns to the SAME credit with the SAME expiry: cancelling can never stretch the 365 days. If that credit has lapsed meanwhile, it comes back as lapsed.
 * Returns what was put back, per credit.
 */
export async function restoreCreditUses(db: D1, eid: string, now: number, keepInr = 0): Promise<{ credit_id: string; amount: number }[]> {
  const out: { credit_id: string; amount: number }[] = [];
  let excess = paise(await creditAppliedFor(db, eid)) - paise(keepInr);
  if (excess <= 0) return out;
  const uses = (await db.prepare("SELECT id, credit_id, amount_inr FROM credit_use WHERE eid=? AND status='applied' ORDER BY id DESC").bind(eid).all<{ id: number; credit_id: string; amount_inr: number }>()).results ?? [];
  for (const u of uses) {
    if (excess <= 0) break;
    const amt = paise(u.amount_inr);
    if (amt > excess) { // the use is bigger than the excess: shrink it and give only the excess back (a game made smaller after credit was applied)
      const part = excess / 100;
      const shr = await db.prepare("UPDATE credit_use SET amount_inr=ROUND(amount_inr-?,2) WHERE id=? AND status='applied' AND CAST(ROUND(amount_inr*100) AS INTEGER)=?").bind(part, u.id, amt).run();
      if ((shr.meta?.changes ?? 0) === 0) continue;
      await db.prepare("UPDATE credit SET remaining_inr=CASE WHEN expires_ms>? THEN ROUND(remaining_inr+?,2) ELSE remaining_inr END, lapsed_inr=CASE WHEN expires_ms>? THEN lapsed_inr ELSE ROUND(lapsed_inr+?,2) END, status=CASE WHEN expires_ms>? THEN 'active' ELSE 'expired' END WHERE id=?")
        .bind(now, part, now, part, now, u.credit_id).run();
      out.push({ credit_id: u.credit_id, amount: r2(part) }); excess = 0; break;
    }
    const flip = await db.prepare("UPDATE credit_use SET status='restored', restored_ms=? WHERE id=? AND status='applied'").bind(now, u.id).run();
    if ((flip.meta?.changes ?? 0) === 0) continue;
    await db.prepare("UPDATE credit SET remaining_inr=CASE WHEN expires_ms>? THEN ROUND(remaining_inr+?,2) ELSE remaining_inr END, lapsed_inr=CASE WHEN expires_ms>? THEN lapsed_inr ELSE ROUND(lapsed_inr+?,2) END, status=CASE WHEN expires_ms>? THEN 'active' ELSE 'expired' END WHERE id=?")
      .bind(now, u.amount_inr, now, u.amount_inr, now, u.credit_id).run();
    out.push({ credit_id: u.credit_id, amount: r2(u.amount_inr) }); excess -= amt;
  }
  return out;
}

/** The account's usable credit right now, oldest-expiring first. */
export async function activeCredits(db: D1, org: string, cur: string, now: number): Promise<CreditRow[]> {
  return (await db.prepare("SELECT * FROM credit WHERE org=? AND currency=? AND status='active' AND expires_ms>? AND CAST(ROUND(remaining_inr*100) AS INTEGER)>0 ORDER BY expires_ms, created_ms, id").bind(org, cur, now).all<CreditRow>()).results ?? [];
}
export async function activeCreditSummary(db: D1, org: string, now: number): Promise<{ activeTotalInr: number; nextExpiryMs: number | null }> {
  const rows = await activeCredits(db, org, "INR", now);
  return { activeTotalInr: r2(rows.reduce((t, c) => t + c.remaining_inr, 0)), nextExpiryMs: rows.length ? rows[0]!.expires_ms : null };
}

/**
 * Applies the account's credit to a game, oldest-expiring first, up to the price. Atomic per credit (a guarded insert, then a guarded update that may not take the credit below zero;
 * if the update loses a race the use row is removed again) and idempotent per game (the total applied to a game can never pass its price, so a double tap or two people at once
 * cannot use credit twice). Returns the total now applied to the game.
 */
export async function applyCreditToGame(db: D1, org: string, eid: string, priceTotal: number, cur: string, now: number): Promise<{ appliedInr: number; usedNow: { credit_id: string; amount: number }[] }> {
  const usedNow: { credit_id: string; amount: number }[] = [];
  let need = paise(priceTotal) - paise(await creditAppliedFor(db, eid));
  if (need > 0) for (const c of await activeCredits(db, org, cur, now)) {
    if (need <= 0) break;
    const take = Math.min(need, paise(c.remaining_inr)), amt = take / 100;
    if (take <= 0) continue;
    const ins = await db.prepare("INSERT INTO credit_use(credit_id,eid,amount_inr,at_ms,status) SELECT ?,?,?,?,'applied' WHERE EXISTS (SELECT 1 FROM credit WHERE id=? AND org=? AND currency=? AND status='active' AND expires_ms>? AND CAST(ROUND(remaining_inr*100) AS INTEGER)>=?) AND EXISTS (SELECT 1 FROM engagement WHERE id=? AND org=? AND pack=0 AND cancelled_ms IS NULL AND unplayed_ms IS NULL) AND (SELECT COALESCE(SUM(amount_inr),0) FROM credit_use WHERE eid=? AND status='applied') + ? <= ? + 0.005")
      .bind(c.id, eid, amt, now, c.id, org, cur, now, take, eid, org, eid, amt, priceTotal).run();
    if ((ins.meta?.changes ?? 0) === 0) continue; // the game already has all it may take, or the credit changed under us
    const rowId = (await db.prepare("SELECT MAX(id) AS m FROM credit_use WHERE credit_id=? AND eid=? AND status='applied'").bind(c.id, eid).first<{ m: number }>())?.m;
    const upd = await db.prepare("UPDATE credit SET remaining_inr=ROUND(remaining_inr-?,2), status=CASE WHEN CAST(ROUND((remaining_inr-?)*100) AS INTEGER)<=0 THEN 'used' ELSE 'active' END WHERE id=? AND status='active' AND expires_ms>? AND CAST(ROUND(remaining_inr*100) AS INTEGER)>=?").bind(amt, amt, c.id, now, take).run();
    if ((upd.meta?.changes ?? 0) === 0) { if (rowId) await db.prepare("DELETE FROM credit_use WHERE id=?").bind(rowId).run(); continue; } // lost a race: take nothing from this credit
    usedNow.push({ credit_id: c.id, amount: amt }); need -= take;
  }
  return { appliedInr: await creditAppliedFor(db, eid), usedNow };
}

// ------------------------------------------------------------------------------------------------ e-mails
const lapseDate = (c: { expires_ms: number }) => creditLastDay(c.expires_ms);
export async function mailCreditCreated(env: PayEnv, c: CreditRow, e: { id: string; org: string | null; config?: string | null }, why: "cancel" | "late", now: number): Promise<void> {
  const claim = await env.DB.prepare("UPDATE credit SET mail_created_ms=? WHERE id=? AND mail_created_ms IS NULL").bind(now, c.id).run();
  if ((claim.meta?.changes ?? 0) === 0) return; // one of each per credit
  const lines = why === "cancel"
    ? [c.expires_ms <= now ? `Your game "${gameName(e)}" (${e.id}) is cancelled. The credit from your payment of ${rs(c.total_inr, c.currency)} lapsed on ${lapseDate(c)}, 365 days after the payment, so there is nothing left to use.` : `Your game "${gameName(e)}" (${e.id}) is cancelled. Your payment of ${rs(c.total_inr, c.currency)} stays as credit until ${lapseDate(c)}. Use it for your next game.`]
    : [`A payment of ${rs(c.total_inr, c.currency)} arrived for the game "${gameName(e)}" (${e.id}) after it was cancelled or closed. It stays as credit until ${lapseDate(c)}. Use it for your next game.`];
  await mailTeam(env, c.org, c.eid ?? e.id, why === "cancel" ? `Your credit of ${rs(c.total_inr, c.currency)}: ${gameName(e)}` : `A payment became credit: ${gameName(e)}`, [...lines, NO_REFUND_LINE, `Open your console and choose "Use my credit" on the Pay step of your next game.`].join("\n\n"), now);
}
async function mailCreditUsed(env: PayEnv, c: CreditRow, amount: number, e: { id: string; org: string | null; config?: string | null }, left: number, now: number): Promise<void> {
  await mailTeam(env, c.org, e.id, `${rs(amount, c.currency)} of credit used for ${gameName(e)}`, [`${rs(amount, c.currency)} of credit was used for the game "${gameName(e)}" (${e.id}).`, left > 0.004 ? `That credit still has ${rs(left, c.currency)} left, valid until ${lapseDate(c)}.` : "That credit is now fully used."].join("\n\n"), now);
}

// ------------------------------------------------------------------------------------------------ the scheduled part
/** Lapses credit whose time is up and sends the 30-day, 3-day and lapse mails, each once per credit. Bounded and safe to repeat. No money moves, and no credit note is raised. */
export async function creditTick(env: PayEnv, now: number): Promise<{ lapsed: number; mailed: number }> {
  const db = env.DB, out = { lapsed: 0, mailed: 0 };
  const due = (await db.prepare("SELECT * FROM credit WHERE status='active' AND expires_ms<=? LIMIT 50").bind(now).all<CreditRow>()).results ?? [];
  for (const c of due) {
    const r = await db.prepare("UPDATE credit SET status='expired', lapsed_inr=ROUND(lapsed_inr+remaining_inr,2), remaining_inr=0 WHERE id=? AND status='active' AND expires_ms<=?").bind(c.id, now).run();
    if ((r.meta?.changes ?? 0) > 0) out.lapsed++;
  }
  const gone = (await db.prepare("SELECT * FROM credit WHERE status='expired' AND mail_lapse_ms IS NULL AND lapsed_inr>0 AND expires_ms<=? LIMIT 50").bind(now).all<CreditRow>()).results ?? [];
  for (const c of gone) {
    const claim = await db.prepare("UPDATE credit SET mail_lapse_ms=? WHERE id=? AND mail_lapse_ms IS NULL").bind(now, c.id).run();
    if ((claim.meta?.changes ?? 0) === 0) continue;
    await mailTeam(env, c.org, c.eid, `Your credit of ${rs(c.lapsed_inr, c.currency)} lapsed`, `Your credit of ${rs(c.lapsed_inr, c.currency)} lapsed on ${lapseDate(c)}, 365 days after the payment. Unused credit lapses at the end of day 365. You can see it under "Credit that lapsed" in Your account.`, now); out.mailed++;
  }
  const soon = (await db.prepare("SELECT * FROM credit WHERE status='active' AND expires_ms>? AND expires_ms<=? AND mail3_ms IS NULL AND CAST(ROUND(remaining_inr*100) AS INTEGER)>0 LIMIT 50").bind(now, now + 30 * DAY).all<CreditRow>()).results ?? [];
  for (const c of soon) {
    const three = c.expires_ms - now <= 3 * DAY;
    const col = three ? "mail3_ms" : "mail30_ms";
    if (!three && c.mail30_ms !== null) continue;
    const claim = await db.prepare(`UPDATE credit SET ${col}=? WHERE id=? AND ${col} IS NULL`).bind(now, c.id).run();
    if ((claim.meta?.changes ?? 0) === 0) continue;
    if (three && c.mail30_ms === null) await db.prepare("UPDATE credit SET mail30_ms=? WHERE id=? AND mail30_ms IS NULL").bind(now, c.id).run(); // the 3-day mail replaces the 30-day one when we are already that close
    await mailTeam(env, c.org, c.eid, `Your credit of ${rs(c.remaining_inr, c.currency)} lapses on ${lapseDate(c)}`, `Your credit of ${rs(c.remaining_inr, c.currency)} lapses on ${lapseDate(c)} (${three ? "in 3 days" : "in 30 days"}). Use it for your next game before then. After that it is gone: we do not give refunds.`, now); out.mailed++;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the routes
/** The part of the Worker's Auth that matters here. */
export interface CreditAuth { plat: boolean; org: string | null; kind: string | null; eid?: string | null; viaLink?: boolean }

/** The credit of an account as the API shows it. A credit past its time shows as expired even before the scheduled job has marked it. */
export async function listCredits(db: D1, org: string, now: number) {
  const rows = (await db.prepare("SELECT * FROM credit WHERE org=? AND status<>'revived' ORDER BY created_ms DESC, id LIMIT 200").bind(org).all<CreditRow>()).results ?? [];
  const uses = rows.length ? ((await db.prepare(`SELECT credit_id, eid, amount_inr, at_ms FROM credit_use WHERE status='applied' AND credit_id IN (${rows.map(() => "?").join(",")}) ORDER BY at_ms, id`).bind(...rows.map((r) => r.id)).all<any>()).results ?? []) : [];
  const credits = rows.map((c) => {
    const lapsedNow = c.status === "active" && c.expires_ms <= now;
    const status: "active" | "used" | "expired" = lapsedNow ? "expired" : (c.status as any);
    return { id: c.id, amountInr: c.total_inr, remainingInr: lapsedNow ? 0 : c.remaining_inr, createdMs: c.created_ms, expiresMs: c.expires_ms, status, sourceGame: c.eid, uses: uses.filter((u: any) => u.credit_id === c.id).map((u: any) => ({ game: u.eid, amountInr: u.amount_inr, atMs: u.at_ms })), currency: c.currency, lastDay: creditLastDay(c.expires_ms), ...(status === "expired" ? { lapsedInr: lapsedNow ? c.remaining_inr : c.lapsed_inr } : {}), ...(c.is_test ? { test: true } : {}) };
  });
  const act = credits.filter((c) => c.status === "active" && c.currency === "INR" && c.remainingInr > 0);
  return { credits, activeTotalInr: r2(act.reduce((t, c) => t + c.remainingInr, 0)), nextExpiryMs: act.length ? Math.min(...act.map((c) => c.expiresMs)) : null };
}

const PAYER_KINDS = new Set(["master", "host", "cohost"]);
/**
 * GET /api/org/credit            -> {credits:[...], activeTotalInr, nextExpiryMs|null}   (Organizer, Host)
 * POST /api/z/{id}/pay-with-credit {} -> {ok, paid, usedInr, toPayInr}                   (Organizer, Host, Co-host of that game; never an AI key or a work link)
 */
export async function creditRoute(req: Request, env: PayEnv, now: number, spend: (n: number) => Promise<boolean>, a: CreditAuth): Promise<Response | null> {
  const url = new URL(req.url), p = url.pathname, db = env.DB;
  if (req.method === "GET" && p === "/api/org/credit") {
    if (!a.org || a.viaLink || (a.kind !== "master" && a.kind !== "host")) return json({ error: a.kind === "cohost" ? "Credit is shown to the Organizer and Hosts." : "Not allowed." }, 403);
    return json(await listCredits(db, a.org, now));
  }
  const m = p.match(/^\/api\/z\/([A-Za-z0-9_-]{4,40})\/pay-with-credit$/);
  if (!m || req.method !== "POST") return null;
  if (a.kind === "ai") return json({ error: "Paying is for people to do themselves. Ask the owner to use their credit in the console." }, 403);
  if (!a.org || a.viaLink || !a.kind || !PAYER_KINDS.has(a.kind)) return json({ error: "Not allowed." }, 403);
  const e = await db.prepare("SELECT * FROM engagement WHERE id=?").bind(m[1]!).first<any>();
  if (!e || e.org !== a.org) return json({ error: "No such game." }, 404);
  if (a.kind === "cohost" && a.eid && a.eid !== e.id) return json({ error: "Your Co-host link is for a different game." }, 403);
  if (e.cancelled_ms) return json({ error: "This game was cancelled. It cannot be paid for.", code: "cancelled" }, 409);
  if (e.unplayed_ms) return json({ error: "This game did not start and is closed. It cannot be paid for.", code: "did-not-start" }, 409);
  const pack = PACKS.find((x) => x[0] >= e.cap)?.[0] ?? null;
  if (!pack) return json({ error: "That many participants needs a custom arrangement. Please write to us." }, 400);
  const bodyText = await req.text(); let b: any = {}; try { b = bodyText ? JSON.parse(bodyText) : {}; } catch { b = {}; }
  const cur = b?.currency === "USD" ? "USD" : "INR";
  const total = price(pack, cur).total;
  if (e.pack !== 0) { // already paid (by credit or by money): nothing more is taken, the same answer every time
    const used = await creditAppliedFor(db, e.id);
    return json({ ok: true, paid: true, usedInr: used, toPayInr: 0, already: true });
  }
  if (await db.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`startpending/${e.id}`).first()) return json({ error: "Pick the date and time of this game first.", code: "start-pending" }, 400);
  if (await db.prepare("SELECT 1 AS x FROM payment WHERE eid=? AND status<>'paid' AND confirming_ms IS NOT NULL AND confirming_ms>?").bind(e.id, now - 30 * 60_000).first()) return json({ error: "A payment for this game is being confirmed. Please wait a few minutes.", code: "confirming" }, 409);
  if (!(await spend(4))) return json({ error: "It is very busy right now. Please try again in a few minutes." }, 503);
  if (paise(await creditAppliedFor(db, e.id)) > paise(total)) await restoreCreditUses(db, e.id, now, total); // the game got smaller since credit was applied: the excess goes back
  const before = await creditAppliedFor(db, e.id);
  const got = await applyCreditToGame(db, a.org, e.id, total, cur, now);
  const due = r2(total - got.appliedInr);
  if (got.usedNow.length) { // one mail per credit that was used, once
    for (const u of got.usedNow) { const c = await db.prepare("SELECT * FROM credit WHERE id=?").bind(u.credit_id).first<CreditRow>(); if (c) await mailCreditUsed(env, c, u.amount, e, c.remaining_inr, now); }
  }
  if (due > 0.004) return json({ ok: true, paid: false, usedInr: got.appliedInr, toPayInr: due, ...(before > 0 && !got.usedNow.length ? { already: true } : {}) });
  // the credit covers the whole price: the game is paid, exactly like a payment (invoice, publish, who paid, late-start rule), with no Razorpay
  const done = await payGameFromCredit(env, e, a, pack, cur, got.appliedInr, now, spend);
  if (!done.ok) return json({ error: done.error, usedInr: got.appliedInr, toPayInr: 0 }, done.status);
  return json({ ok: true, paid: true, usedInr: got.appliedInr, toPayInr: 0, ...(done.restartedAtMs ? { restartedAtMs: done.restartedAtMs } : {}) });
}

/** Records the payment row of a game that credit paid for, then finishes it like any payment (pay.ts `fulfil`). One row per game, so a second call finds the first. */
async function payGameFromCredit(env: PayEnv, e: any, a: CreditAuth, pack: number, cur: string, usedInr: number, now: number, spend: (n: number) => Promise<boolean>): Promise<{ ok: true; restartedAtMs: number | null } | { ok: false; error: string; status: number }> {
  const db = env.DB, id = "paycr_" + e.id;
  const first = await db.prepare("SELECT c.payment_id AS pid FROM credit_use cu JOIN credit c ON c.id=cu.credit_id WHERE cu.eid=? AND cu.status='applied' ORDER BY cu.id LIMIT 1").bind(e.id).first<{ pid: string | null }>();
  const src = first?.pid ? await db.prepare("SELECT meta, email FROM payment WHERE id=?").bind(first.pid).first<{ meta: string; email: string }>() : null;
  let sm: any = {}; try { sm = src ? JSON.parse(src.meta) : {}; } catch { sm = {}; }
  const tos = await teamEmails(env, e.org, e.id);
  const email = (tos.organizer ?? src?.email ?? "").toLowerCase();
  const test = (await testFlag(env)) === 1 || (await orgIsTest(env, e.org)) ? 1 : 0;
  const meta = { org: sm.org ?? "", name: sm.name || sm.org || "Organizer", country: sm.country ?? "IN", taxId: sm.taxId ?? "", origin: env.PUBLIC_ORIGIN ?? "", orgId: e.org, eid: e.id, paidBy: PAYER[a.kind ?? ""] ?? "organizer", creditInr: usedInr, viaCredit: true, by: a.kind };
  await db.prepare("INSERT OR IGNORE INTO payment(id,org,email,pack,currency,amount,tax,rzp_order_id,status,created_ms,meta,ref,buyer_phone_hash,is_test,eid) VALUES(?,?,?,?,?,0,0,NULL,'created',?,?,NULL,NULL,?,?)").bind(id, null, email || "credit@invalid.local", pack, cur, now, JSON.stringify(meta), test, e.id).run();
  const f = await fulfil(env, id, now, spend);
  if (!("result" in f)) return { ok: false, error: f.error ?? "Could not finish.", status: f.status ?? 500 };
  return { ok: true, restartedAtMs: (f.result as any).restartedAtMs ?? null };
}

export type { Env };
