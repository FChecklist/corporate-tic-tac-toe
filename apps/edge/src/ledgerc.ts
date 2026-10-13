// LEDGER C: this website's own payment ledger, connected to the central ledger B (IT Services by Rajat Agarwal) and to Razorpay (A).
// Owner order 2026-10-13: every payment, expense, revenue and commission is tracked at A, B and C with the same ids, nothing twice, nothing unclear.
//
// THE IDS (each has exactly one meaning)
//   txn_id         SITE_CODE + "-" + this website's own payment id (payment.id), e.g. TTT-pay_ab12... Made when the buyer starts paying; the same text
//                  is in Razorpay's order notes (A), in the central ledger payment row (B) and in payment.txn_id here (C).
//   rzp_order_id   Razorpay's order. One website payment has one order.
//   rzp_payment_id Razorpay's payment. One per ATTEMPT: a failed try and the paying try are two rows of payment_attempt, both under the one txn_id.
//   rzp_refund_id  Razorpay's refund, one row of payment_refund (the table `refund` of cancel.ts is this website's own refund request and is not touched).
//   commission.id  is the central payout's site_ref (central: UNIQUE(site, site_ref)), so sending a commission again updates it and never adds a second.
//
// WHAT IS KEPT PER ATTEMPT (success AND failure): amount, currency, status (authorized / captured / failed), method, bank, card network and type, the LAST
// FOUR digits of a card, a masked UPI id (ab***@bank), the bank reference (rrn), Razorpay's error code / description / reason, fee and GST on the fee, and the
// times of authorisation, capture and failure. A full card number or a full UPI id is never stored: the code below never copies them out of Razorpay's message.
//
// ZERO DUPLICATION (enforced by the database, not by hope)
//   payment_attempt.rzp_payment_id PRIMARY KEY      an attempt is one row however many events arrive (INSERT .. ON CONFLICT DO UPDATE).
//   event_seen.rzp_event_id PRIMARY KEY             Razorpay's header x-razorpay-event-id; a repeated delivery is answered and ignored.
//   payment_refund.rzp_refund_id PRIMARY KEY        a refund is one row.
//   An attempt's status only moves forward (failed -> authorized -> captured); a late "failed" message never undoes a capture. A failed attempt never
//   marks the payment paid; a later captured attempt of the same payment still does (a buyer may fail once and pay on the second try).
//
// HOW C IS COMPARED WITH B (the owner report puts them side by side; these are the known, honest differences)
//   1. Month and time. Both use the INDIAN month (IST). B places a sale at its captured time (the webhook's own time, or the moment the central verify ran).
//      C places it at paid_ms, the moment THIS website fulfilled the payment (a few seconds later). A payment captured in the last seconds of a month can
//      therefore sit in different months in B and C. Counts and amounts agree again in the next month's figures.
//   2. What counts as a sale. C counts a payment that is PAID, has a Razorpay payment id (so money really moved) and is a real payment: is_test = 0, or
//      the Rs 1 "payment_test" (which the site flags as test because it buys nothing, but which is real money in A and a paid sale in B). A payment made in
//      TEST mode (no Razorpay at all) and a game paid wholly from credit are never counted, and never sent to B.
//   3. Fee and tax. fee_minor is Razorpay's fee INCLUDING the GST on it; tax_minor is that GST. (B's pnl view shows the fee without GST as gateway_fee and the GST
//      as gateway_tax; the sum is the same.)
//   4. Refunds. B counts every refund row it holds, whatever its status; C counts refunds that are not "failed" (a refund Razorpay could not pay out moved no money).
//   5. Commission. C counts a commission at its own date (created / paid here); B dates a payout when the row reached B (usually the same minute). A commission
//      the central ledger refused with 409 (its sale is not in B yet) is counted in C and not yet in B until the retry succeeds.
//   6. Failed. C counts attempts that failed (by the failure time); an attempt that failed and then captured (same Razorpay payment id) is a sale, not a failure.
//   7. Currency. Figures are pushed per currency; INR is always sent.
import type { D1, Env } from "./worker";

export const SITE_CODE = "TTT";
export const SITE_HOST = "corporate-tic-tac-toe.pages.dev";
export const SITE_PRODUCT = "corporate_tic_tac_toe";
/** The plan name sent to B for a payment (same recipe as the order notes in pay.ts). */
export const salePlanOf = (pack: number | null | undefined, productType?: string | null): string => (productType === "payment_test" || !pack ? "payment_test" : `tictactoe_pack_${pack}`);

export const txnIdOf = (paymentId: string): string => `${SITE_CODE}-${String(paymentId).slice(0, 60)}`;

export interface LedgerEnv extends Env { PAY_SERVICE_KEY?: string; PAY_SERVICE_URL?: string; PAY_SITE?: string }
/** The central service this website reports to; null when this website has no key for it (tests, local runs). */
export const centralOf = (env: LedgerEnv): { url: string; key: string; site: string } | null =>
  (env.PAY_SERVICE_KEY ? { url: (env.PAY_SERVICE_URL ?? "https://itservices-rajat-agarwal.pages.dev").replace(/\/+$/, ""), key: env.PAY_SERVICE_KEY, site: env.PAY_SITE ?? SITE_HOST } : null);

export const LEDGERC_SCHEMA: string[] = [
  `ALTER TABLE payment ADD COLUMN txn_id TEXT`,
  `ALTER TABLE payment ADD COLUMN fee_minor INTEGER`,
  `ALTER TABLE payment ADD COLUMN tax_minor INTEGER`,
  `ALTER TABLE payment ADD COLUMN method TEXT`,
  `ALTER TABLE payment ADD COLUMN bank TEXT`,
  `ALTER TABLE payment ADD COLUMN card_network TEXT`,
  `ALTER TABLE payment ADD COLUMN card_type TEXT`,
  `ALTER TABLE payment ADD COLUMN rrn TEXT`,
  `UPDATE payment SET txn_id='${SITE_CODE}-' || id WHERE txn_id IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payment_txn ON payment (txn_id) WHERE txn_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS payment_attempt (rzp_payment_id TEXT PRIMARY KEY, payment_id TEXT, rzp_order_id TEXT, txn_id TEXT, status TEXT NOT NULL, currency TEXT, amount_minor INTEGER, method TEXT, bank TEXT, card_network TEXT, card_type TEXT, card_last4 TEXT, vpa_masked TEXT, rrn TEXT, error_code TEXT, error_description TEXT, error_reason TEXT, fee_minor INTEGER, tax_minor INTEGER, authorized_ms INTEGER, captured_ms INTEGER, failed_ms INTEGER, event_ms INTEGER, created_ms INTEGER, updated_ms INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS payment_attempt_payment ON payment_attempt (payment_id)`,
  `CREATE TABLE IF NOT EXISTS event_seen (rzp_event_id TEXT PRIMARY KEY, event TEXT, seen_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS payment_refund (rzp_refund_id TEXT PRIMARY KEY, rzp_payment_id TEXT NOT NULL, payment_id TEXT, txn_id TEXT, currency TEXT, amount_minor INTEGER NOT NULL, status TEXT, created_ms INTEGER, updated_ms INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS payment_refund_payment ON payment_refund (rzp_payment_id)`,
  `ALTER TABLE commission ADD COLUMN synced_ms INTEGER`,
  `ALTER TABLE commission ADD COLUMN sync_status TEXT`,
  `ALTER TABLE commission ADD COLUMN sync_try_ms INTEGER`,
  `ALTER TABLE commission ADD COLUMN sync_error TEXT`,
  `CREATE TABLE IF NOT EXISTS ledger_state (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
];

const IST = 19_800_000;
const num = (v: unknown): number | null => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const str = (v: unknown, max = 300): string | null => (v === null || v === undefined || v === "" ? null : String(v).slice(0, max));
/** A UPI id is kept masked (ab***@bank): enough to recognise, never enough to use. */
export const maskVpa = (v: unknown): string | null => { const s = str(v, 120); if (!s) return null; const i = s.indexOf("@"); return i > 0 ? s.slice(0, Math.min(2, i)) + "***" + s.slice(i) : s.slice(0, 2) + "***"; };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// ---------------------------------------------------------------- attempts (A -> C)
export type AttemptStatus = "authorized" | "captured" | "failed";
/** Which attempt status a Razorpay event stands for; null for events that are not about a payment attempt. */
export function attemptStatusOf(event: string): AttemptStatus | null {
  if (event === "payment.captured" || event === "order.paid") return "captured";
  if (event === "payment.authorized") return "authorized";
  if (event === "payment.failed") return "failed";
  return null;
}
const RANK = (col: string) => `(CASE ${col} WHEN 'captured' THEN 3 WHEN 'authorized' THEN 2 ELSE 1 END)`;

/** One Razorpay payment attempt (pay_...), from a webhook message or from a payment Razorpay returned. Idempotent; the status only moves forward. */
export async function recordAttempt(db: D1, ent: any, status: AttemptStatus, evMs: number, now: number, paymentId: string | null): Promise<void> {
  const id = str(ent?.id, 60); if (!id) return;
  const a = ent.acquirer_data && typeof ent.acquirer_data === "object" ? ent.acquirer_data : null;
  const t = (s: AttemptStatus) => (status === s ? evMs : null);
  await db.prepare(`INSERT INTO payment_attempt(rzp_payment_id,payment_id,rzp_order_id,txn_id,status,currency,amount_minor,method,bank,card_network,card_type,card_last4,vpa_masked,rrn,error_code,error_description,error_reason,fee_minor,tax_minor,authorized_ms,captured_ms,failed_ms,event_ms,created_ms,updated_ms)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(rzp_payment_id) DO UPDATE SET
      status=CASE WHEN ${RANK("excluded.status")} >= ${RANK("payment_attempt.status")} THEN excluded.status ELSE payment_attempt.status END,
      payment_id=COALESCE(payment_attempt.payment_id,excluded.payment_id), rzp_order_id=COALESCE(payment_attempt.rzp_order_id,excluded.rzp_order_id), txn_id=COALESCE(payment_attempt.txn_id,excluded.txn_id),
      currency=COALESCE(excluded.currency,payment_attempt.currency), amount_minor=COALESCE(excluded.amount_minor,payment_attempt.amount_minor),
      method=COALESCE(excluded.method,payment_attempt.method), bank=COALESCE(excluded.bank,payment_attempt.bank), card_network=COALESCE(excluded.card_network,payment_attempt.card_network), card_type=COALESCE(excluded.card_type,payment_attempt.card_type),
      card_last4=COALESCE(excluded.card_last4,payment_attempt.card_last4), vpa_masked=COALESCE(excluded.vpa_masked,payment_attempt.vpa_masked), rrn=COALESCE(excluded.rrn,payment_attempt.rrn),
      error_code=COALESCE(payment_attempt.error_code,excluded.error_code), error_description=COALESCE(payment_attempt.error_description,excluded.error_description), error_reason=COALESCE(payment_attempt.error_reason,excluded.error_reason),
      fee_minor=COALESCE(excluded.fee_minor,payment_attempt.fee_minor), tax_minor=COALESCE(excluded.tax_minor,payment_attempt.tax_minor),
      authorized_ms=COALESCE(payment_attempt.authorized_ms,excluded.authorized_ms), captured_ms=COALESCE(payment_attempt.captured_ms,excluded.captured_ms), failed_ms=COALESCE(payment_attempt.failed_ms,excluded.failed_ms),
      event_ms=MAX(COALESCE(payment_attempt.event_ms,0),COALESCE(excluded.event_ms,0)), updated_ms=excluded.updated_ms`)
    .bind(id, paymentId, str(ent.order_id, 60), paymentId ? txnIdOf(paymentId) : null, status, str(ent.currency, 3), num(ent.amount), str(ent.method, 20), str(ent.bank, 20), str(ent.card?.network, 30), str(ent.card?.type, 20),
      ent.card?.last4 != null ? String(ent.card.last4).replace(/\D/g, "").slice(-4) || null : null, maskVpa(ent.vpa), str(a?.rrn, 60),
      status === "failed" ? str(ent.error_code, 80) : null, status === "failed" ? str(ent.error_description, 300) : null, status === "failed" ? str(ent.error_reason, 80) : null,
      num(ent.fee), num(ent.tax), t("authorized"), t("captured"), t("failed"), evMs, num(ent.created_at) ? Number(ent.created_at) * 1000 : null, now).run();
}

/** Razorpay's own message about a repeated delivery: already handled? */
export async function eventSeen(db: D1, eventId: string): Promise<boolean> {
  try { return !!(await db.prepare("SELECT 1 AS x FROM event_seen WHERE rzp_event_id=?").bind(eventId).first()); } catch { return false; }
}
export async function markEventSeen(db: D1, eventId: string, event: string | null, now: number): Promise<void> {
  try { await db.prepare("INSERT OR IGNORE INTO event_seen(rzp_event_id,event,seen_ms) VALUES(?,?,?)").bind(eventId.slice(0, 80), event ? event.slice(0, 60) : null, now).run(); } catch { /* the payment rows themselves are idempotent */ }
}

/** After a payment is fulfilled (webhook path or verify path): fee, tax, method, bank reference and txn_id go on the payment row (the first value kept stays: a second, duplicate payment of the same order never overwrites them). `central` is B's verify answer, used when Razorpay's own message lacks the fee. */
export async function storePaymentDetails(db: D1, paymentId: string, ent: any, central: any | null): Promise<void> {
  try {
    const a = ent?.acquirer_data && typeof ent.acquirer_data === "object" ? ent.acquirer_data : null;
    await db.prepare("UPDATE payment SET txn_id=COALESCE(txn_id,?), fee_minor=COALESCE(fee_minor,?), tax_minor=COALESCE(tax_minor,?), method=COALESCE(method,?), bank=COALESCE(bank,?), card_network=COALESCE(card_network,?), card_type=COALESCE(card_type,?), rrn=COALESCE(rrn,?) WHERE id=?")
      .bind(txnIdOf(paymentId), num(ent?.fee) ?? num(central?.fee_minor), num(ent?.tax) ?? num(central?.tax_minor), str(ent?.method ?? central?.method, 20), str(ent?.bank, 20), str(ent?.card?.network, 30), str(ent?.card?.type, 20), str(a?.rrn, 60), paymentId).run();
  } catch { /* a ledger detail must never undo a paid purchase */ }
}

// ---------------------------------------------------------------- refunds (A -> C)
const REFUND_RANK = (col: string) => `(CASE ${col} WHEN 'processed' THEN 2 WHEN 'failed' THEN 2 ELSE 1 END)`;
/** One Razorpay refund (rfnd_...) from refund.created / refund.processed / refund.failed. The same refund seen twice is one row. */
export async function recordRefund(db: D1, event: string, r: any, now: number): Promise<boolean> {
  const id = str(r?.id, 60), pay = str(r?.payment_id, 60); if (!id || !pay) return false;
  const status = event === "refund.processed" ? "processed" : event === "refund.failed" ? "failed" : (str(r.status, 20) ?? "pending");
  const row = await db.prepare("SELECT id FROM payment WHERE rzp_payment_id=?").bind(pay).first<{ id: string }>() ?? await db.prepare("SELECT payment_id AS id FROM payment_attempt WHERE rzp_payment_id=?").bind(pay).first<{ id: string | null }>();
  const pid = row?.id ?? null;
  await db.prepare(`INSERT INTO payment_refund(rzp_refund_id,rzp_payment_id,payment_id,txn_id,currency,amount_minor,status,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(rzp_refund_id) DO UPDATE SET status=CASE WHEN ${REFUND_RANK("excluded.status")} >= ${REFUND_RANK("payment_refund.status")} THEN excluded.status ELSE payment_refund.status END, payment_id=COALESCE(payment_refund.payment_id,excluded.payment_id), txn_id=COALESCE(payment_refund.txn_id,excluded.txn_id), updated_ms=excluded.updated_ms`)
    .bind(id, pay, pid, pid ? txnIdOf(pid) : null, str(r.currency, 3), Math.max(0, Math.round(num(r.amount) ?? 0)), status, num(r.created_at) ? Number(r.created_at) * 1000 : now, now).run();
  return true;
}

// ---------------------------------------------------------------- commission (C -> B)
/** Retry a commission the central ledger could not take (its sale not there yet, or the service down) no sooner than this. */
export const COMMISSION_RETRY_MS = 10 * 60_000;
const SYNC_BUDGET_MS = 14_000;
export interface SyncOut { posted: number; kept: number; skipped: number; failed: number }

/**
 * Posts commission rows to the central ledger: new rows, and rows whose status changed since the last post (accrued -> void / paid).
 * pending_rate and blocked rows are not posted until they become accrued. A TEST-mode row, a TEST-mode payment, or a payment that never went through Razorpay is never posted.
 * The central ledger answers 409 while the sale is not in B yet: the row then stays unsynced and is retried (not before COMMISSION_RETRY_MS).
 * A row that was never posted and is already void needs nothing in B: it is marked done without a call.
 */
export async function syncCommissions(env: LedgerEnv, now: number, opts: { limit?: number; paymentId?: string; partnerCode?: string } = {}): Promise<SyncOut> {
  const out: SyncOut = { posted: 0, kept: 0, skipped: 0, failed: 0 };
  const c = centralOf(env); if (!c) return out;
  const db = env.DB, started = Date.now();
  const rows = (await db.prepare(`SELECT c.id, c.payment_id, c.partner_code, c.currency, c.amount, c.status, c.paid_ref, c.sync_status FROM commission c JOIN payment p ON p.id=c.payment_id
    WHERE c.is_test=0 AND p.is_test=0 AND p.rzp_payment_id IS NOT NULL AND c.status IN ('accrued','void','paid') AND c.sync_status IS NOT c.status AND (c.sync_try_ms IS NULL OR c.sync_try_ms<=?)
      AND (? IS NULL OR c.payment_id=?) AND (? IS NULL OR c.partner_code=?) ORDER BY COALESCE(c.sync_try_ms,0), c.id LIMIT ?`)
    .bind(now - COMMISSION_RETRY_MS, opts.paymentId ?? null, opts.paymentId ?? null, opts.partnerCode ?? null, opts.partnerCode ?? null, Math.min(Math.max(opts.limit ?? 5, 1), 25)).all<any>()).results ?? [];
  for (const r of rows) {
    if (Date.now() - started > SYNC_BUDGET_MS) break;
    if (r.status === "void" && !r.sync_status) { // the central ledger never heard of it: nothing to void there
      await db.prepare("UPDATE commission SET sync_status='void', synced_ms=?, sync_error=NULL WHERE id=?").bind(now, r.id).run(); out.skipped++; continue;
    }
    const amountMinor = Math.round(Number(r.amount ?? 0) * 100);
    if (!(amountMinor > 0) || (r.status === "paid" && !r.paid_ref)) { await db.prepare("UPDATE commission SET sync_try_ms=?, sync_error=? WHERE id=?").bind(now, "missing amount or payout reference", r.id).run(); out.failed++; continue; }
    const body = { site: c.site, site_ref: String(r.id), payment_ref: r.payment_id, partner_code: r.partner_code, amount_minor: amountMinor, currency: r.currency === "USD" ? "USD" : "INR", status: r.status === "paid" ? "paid" : r.status === "void" ? "void" : "accrued", ...(r.status === "paid" ? { paid_ref: String(r.paid_ref).slice(0, 80) } : {}) };
    let res: Response;
    try { res = await fetch(`${c.url}/api/pay/commission`, { method: "POST", headers: { "content-type": "application/json", "x-site-key": c.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) }); }
    catch { await db.prepare("UPDATE commission SET sync_try_ms=?, sync_error=? WHERE id=?").bind(now, "central ledger unreachable", r.id).run(); out.failed++; break; } // the service is down: stop, try again later
    if (res.ok) { await db.prepare("UPDATE commission SET sync_status=?, synced_ms=?, sync_try_ms=NULL, sync_error=NULL WHERE id=?").bind(body.status, now, r.id).run(); out.posted++; continue; }
    const why = ((await res.json().catch(() => ({}))) as any)?.error;
    await db.prepare("UPDATE commission SET sync_try_ms=?, sync_error=? WHERE id=?").bind(now, `${res.status}: ${String(why ?? "refused").slice(0, 150)}`, r.id).run();
    if (res.status === 409) out.kept++; else out.failed++;
  }
  return out;
}

// ---------------------------------------------------------------- monthly summary (C -> B)
export interface Summary { site: string; period_key: string; currency: string; paid_count: number; failed_count: number; revenue_minor: number; fee_minor: number; tax_minor: number; refunded_minor: number; commission_accrued_minor: number; commission_paid_minor: number }
export const monthKeyOf = (ms: number): string => { const d = new Date(ms + IST); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
export const prevMonthKey = (key: string): string => { const [y, m] = key.split("-").map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
/** [from, to) in UTC ms of one INDIAN month. */
export const monthRange = (key: string): { from: number; to: number } => { const [y, m] = key.split("-").map(Number) as [number, number]; return { from: Date.UTC(y, m - 1, 1) - IST, to: Date.UTC(y, m, 1) - IST }; };
const NOT_TEST = `(p.is_test=0 OR p.product_type='payment_test')`;
const REAL = `p.rzp_payment_id IS NOT NULL AND ${NOT_TEST}`;

/** The figures of one month, one object per currency (INR is always present). Only real payments count (see the header, point 2). */
export async function monthSummaries(db: D1, site: string, key: string): Promise<Summary[]> {
  const { from, to } = monthRange(key);
  const by = new Map<string, Summary>();
  const get = (cur: string): Summary => { let s = by.get(cur); if (!s) { s = { site, period_key: key, currency: cur, paid_count: 0, failed_count: 0, revenue_minor: 0, fee_minor: 0, tax_minor: 0, refunded_minor: 0, commission_accrued_minor: 0, commission_paid_minor: 0 }; by.set(cur, s); } return s; };
  get("INR");
  for (const r of (await db.prepare(`SELECT p.currency AS cur, COUNT(*) AS n, COALESCE(SUM(CAST(ROUND(p.amount*100) AS INTEGER)),0) AS rev, COALESCE(SUM(p.fee_minor),0) AS fee, COALESCE(SUM(p.tax_minor),0) AS tax FROM payment p WHERE p.status='paid' AND p.paid_ms>=? AND p.paid_ms<? AND ${REAL} GROUP BY p.currency`).bind(from, to).all<any>()).results ?? []) { const s = get(r.cur); s.paid_count = r.n; s.revenue_minor = r.rev; s.fee_minor = r.fee; s.tax_minor = r.tax; }
  for (const r of (await db.prepare(`SELECT COALESCE(a.currency,p.currency) AS cur, COUNT(*) AS n FROM payment_attempt a JOIN payment p ON p.id=a.payment_id WHERE a.status='failed' AND a.failed_ms>=? AND a.failed_ms<? AND ${NOT_TEST} GROUP BY 1`).bind(from, to).all<any>()).results ?? []) get(r.cur).failed_count = r.n;
  for (const r of (await db.prepare(`SELECT r.currency AS cur, COALESCE(SUM(r.amount_minor),0) AS amt FROM payment_refund r JOIN payment p ON p.id=r.payment_id WHERE r.status IS NOT 'failed' AND r.created_ms>=? AND r.created_ms<? AND ${REAL} GROUP BY r.currency`).bind(from, to).all<any>()).results ?? []) get(r.cur ?? "INR").refunded_minor = r.amt;
  for (const r of (await db.prepare(`SELECT c.currency AS cur, c.status AS st, COALESCE(SUM(CAST(ROUND(c.amount*100) AS INTEGER)),0) AS amt FROM commission c JOIN payment p ON p.id=c.payment_id WHERE c.is_test=0 AND p.is_test=0 AND ((c.status='accrued' AND c.created_ms>=? AND c.created_ms<?) OR (c.status='paid' AND c.paid_ms>=? AND c.paid_ms<?)) GROUP BY c.currency, c.status`).bind(from, to, from, to).all<any>()).results ?? []) { const s = get(r.cur); if (r.st === "paid") s.commission_paid_minor = r.amt; else s.commission_accrued_minor = r.amt; }
  return [...by.values()];
}

const STATE_PUSH = "last_push_ms", STATE_TRY = "last_try_ms";
export const SUMMARY_EVERY_MS = 30 * 60_000, SUMMARY_RETRY_MS = 5 * 60_000;
async function stateGet(db: D1, k: string): Promise<number> { try { return Number((await db.prepare("SELECT v FROM ledger_state WHERE k=?").bind(k).first<{ v: string }>())?.v ?? 0) || 0; } catch { return 0; } }
async function stateSet(db: D1, k: string, v: number): Promise<void> { await db.prepare("INSERT INTO ledger_state(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(v)).run(); }

/** Sends the current and the previous Indian month to B, at most once every 30 minutes (kept in ledger_state.last_push_ms). A failed try is repeated after 5 minutes. */
export async function pushSummaries(env: LedgerEnv, now: number, force = false): Promise<{ pushed: number; skipped?: string }> {
  const c = centralOf(env); if (!c) return { pushed: 0, skipped: "no central key" };
  const db = env.DB;
  if (!force) {
    if (now - (await stateGet(db, STATE_PUSH)) < SUMMARY_EVERY_MS) return { pushed: 0, skipped: "pushed less than 30 minutes ago" };
    if (now - (await stateGet(db, STATE_TRY)) < SUMMARY_RETRY_MS) return { pushed: 0, skipped: "a try failed less than 5 minutes ago" };
  }
  await stateSet(db, STATE_TRY, now);
  const cur = monthKeyOf(now); let sent = 0, bad = 0;
  for (const key of [cur, prevMonthKey(cur)]) {
    for (const s of await monthSummaries(db, c.site, key)) {
      try {
        const res = await fetch(`${c.url}/api/pay/site-summary`, { method: "POST", headers: { "content-type": "application/json", "x-site-key": c.key }, body: JSON.stringify(s), signal: AbortSignal.timeout(4000) });
        if (res.ok) sent++; else bad++;
      } catch { bad++; }
    }
  }
  if (bad === 0) await stateSet(db, STATE_PUSH, now);
  return { pushed: sent };
}

/** Called by the lifecycle tick every minute: a few commission rows, and the summary when it is due. Never throws. */
export async function ledgerCTick(env: LedgerEnv, now: number): Promise<{ commission?: SyncOut; summary?: { pushed: number; skipped?: string }; error?: string }> {
  const out: { commission?: SyncOut; summary?: { pushed: number; skipped?: string }; error?: string } = {};
  try { out.commission = await syncCommissions(env, now, { limit: 5 }); } catch (e) { out.error = String(e).slice(0, 120); }
  try { out.summary = await pushSummaries(env, now); } catch (e) { out.error = String(e).slice(0, 120); }
  return out;
}

// ---------------------------------------------------------------- the owner's view of C
const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);
const ist = (ms: number | null | undefined) => (ms ? new Date(ms + IST).toISOString().replace("T", " ").slice(0, 19) + " IST" : null);
const csvCell = (v: unknown): string => { let s = v === null || v === undefined ? "" : String(v); if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** GET /api/owner/ledger?month=YYYY-MM[&format=csv]. The caller has already proved it is the owner. No payer e-mail, name or phone is returned: the organisation's name only. */
export async function ownerLedger(env: LedgerEnv, url: URL, now: number): Promise<Response> {
  const db = env.DB, month = url.searchParams.get("month") ?? monthKeyOf(now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return json({ error: "month must be YYYY-MM" }, 400);
  const { from, to } = monthRange(month), site = centralOf(env)?.site ?? env.PAY_SITE ?? SITE_HOST;
  const inMonth = `((created_ms>=? AND created_ms<?) OR (paid_ms>=? AND paid_ms<?))`;
  const bindMonth = [from, to, from, to];
  const pays = (await db.prepare(`SELECT id, txn_id, rzp_order_id, rzp_payment_id, amount, currency, status, method, bank, card_network, card_type, rrn, fee_minor, tax_minor, created_ms, paid_ms, is_test, product, product_type, product_ref, pack, json_extract(meta,'$.org') AS org_name FROM payment WHERE ${inMonth} ORDER BY COALESCE(paid_ms,created_ms), id LIMIT 5000`).bind(...bindMonth).all<any>()).results ?? [];
  const atts = (await db.prepare(`SELECT * FROM payment_attempt WHERE payment_id IN (SELECT id FROM payment WHERE ${inMonth}) ORDER BY COALESCE(event_ms,created_ms), rzp_payment_id`).bind(...bindMonth).all<any>()).results ?? [];
  const byPay = new Map<string, any[]>();
  for (const a of atts) { const o = { rzp_payment_id: a.rzp_payment_id, status: a.status, amount_minor: a.amount_minor, currency: a.currency, method: a.method, bank: a.bank, card_network: a.card_network, card_type: a.card_type, card_last4: a.card_last4, vpa_masked: a.vpa_masked, rrn: a.rrn, error_code: a.error_code, error_description: a.error_description, error_reason: a.error_reason, fee_minor: a.fee_minor, tax_minor: a.tax_minor, authorized_utc: iso(a.authorized_ms), captured_utc: iso(a.captured_ms), failed_utc: iso(a.failed_ms), event_utc: iso(a.event_ms), created_utc: iso(a.created_ms) }; (byPay.get(a.payment_id) ?? byPay.set(a.payment_id, []).get(a.payment_id)!).push(o); }
  const payments = pays.map((p: any) => {
    const amountMinor = Math.round(Number(p.amount) * 100), attempts = byPay.get(p.id) ?? [];
    return { txn_id: p.txn_id ?? txnIdOf(p.id), payment_id: p.id, rzp_order_id: p.rzp_order_id, rzp_payment_id: p.rzp_payment_id, amount: p.amount, amount_minor: amountMinor, currency: p.currency, status: p.status, method: p.method, bank: p.bank, card_network: p.card_network, card_type: p.card_type, rrn: p.rrn,
      fee_minor: p.fee_minor, tax_minor: p.tax_minor, net_minor: p.fee_minor == null ? null : amountMinor - p.fee_minor, paid_utc: iso(p.paid_ms), paid_ist: ist(p.paid_ms), created_utc: iso(p.created_ms), org: p.org_name ?? null, product: p.product, plan: salePlanOf(p.pack, p.product_type), is_test: p.is_test ? 1 : 0,
      captured_attempts: attempts.filter((a) => a.status === "captured").length, attempts };
  });
  const refunds = (await db.prepare(`SELECT rzp_refund_id, rzp_payment_id, payment_id, txn_id, currency, amount_minor, status, created_ms, updated_ms FROM payment_refund WHERE created_ms>=? AND created_ms<? ORDER BY created_ms, rzp_refund_id LIMIT 5000`).bind(from, to).all<any>()).results ?? [];
  const comm = (await db.prepare(`SELECT c.id, c.payment_id, c.partner_code, c.base, c.currency, c.rate, c.amount, c.status, c.reason, c.is_test, c.created_ms, c.paid_ref, c.paid_ms, c.synced_ms, c.sync_status, c.sync_error FROM commission c WHERE (c.created_ms>=? AND c.created_ms<?) OR (c.paid_ms>=? AND c.paid_ms<?) ORDER BY c.id LIMIT 5000`).bind(...bindMonth).all<any>()).results ?? [];
  const summaries = await monthSummaries(db, site, month);
  const body = {
    site, month, summary: summaries.find((s) => s.currency === "INR")!, summaries, payments,
    refunds: refunds.map((r: any) => ({ ...r, created_utc: iso(r.created_ms), updated_utc: iso(r.updated_ms) })),
    commission: comm.map((c: any) => ({ id: c.id, site_ref: String(c.id), txn_id: txnIdOf(c.payment_id), payment_id: c.payment_id, partner_code: c.partner_code, base: c.base, currency: c.currency, rate: c.rate, amount: c.amount, status: c.status, reason: c.reason, is_test: c.is_test ? 1 : 0, created_utc: iso(c.created_ms), paid_ref: c.paid_ref, paid_utc: iso(c.paid_ms), synced_utc: iso(c.synced_ms), sync_status: c.sync_status, sync_error: c.sync_error })),
  };
  if (url.searchParams.get("format") === "csv") {
    const head = ["txn_id", "payment_id", "rzp_order_id", "rzp_payment_id", "amount", "currency", "status", "method", "bank", "card_network", "card_type", "rrn", "fee_minor", "tax_minor", "net_minor", "paid_utc", "paid_ist", "org", "product", "plan", "is_test", "attempts", "captured_attempts", "last_error_code", "last_error_reason"];
    const lines = [head.join(",")];
    for (const p of payments) { const bad = [...p.attempts].reverse().find((a) => a.error_code || a.error_reason); lines.push([p.txn_id, p.payment_id, p.rzp_order_id, p.rzp_payment_id, p.amount, p.currency, p.status, p.method, p.bank, p.card_network, p.card_type, p.rrn, p.fee_minor, p.tax_minor, p.net_minor, p.paid_utc, p.paid_ist, p.org, p.product, p.plan, p.is_test, p.attempts.length, p.captured_attempts, bad?.error_code ?? "", bad?.error_reason ?? ""].map(csvCell).join(",")); }
    return new Response(lines.join("\r\n") + "\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="ledger-c-${SITE_CODE}-${month}.csv"`, "cache-control": "no-store" } });
  }
  return json(body);
}
