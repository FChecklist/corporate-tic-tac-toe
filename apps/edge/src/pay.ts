// Payments on the Worker (Razorpay), mirroring the original server's flow so nothing needs a server per organizer:
//   checkout  -> our payment row + a Razorpay Order (server side, amount in paise); the browser opens Razorpay Checkout
//   verify    -> checks Razorpay's signature AND asks Razorpay what really happened, then fulfils
//   webhook   -> same fulfilment when the buyer closed the tab (signature checked)
//   fulfil    -> idempotent: organizer (new or existing by e-mail) gets one ENTITLEMENT for the pack, an invoice is issued, mail is sent
// An entitlement is what lets an organizer create one engagement of up to `pack` participants; without one, creating is refused.
// Needs the `nodejs_compat` flag (billing uses node:crypto HMAC). Test mode (env.TEST_MODE = "1", never in production) fulfils without Razorpay.
import { consentRequired, recordConsent } from "./consent";
import { recordFunnelForOrg } from "./visits";
import { plainToHtml, withFooter } from "./brand";
import {
  BRANDS, DEFAULT_COMPANY, companyGaps, createOrder, fetchPayment, capturePayment, paymentInfo, financialYear, formatInvoiceNumber, renderInvoiceHtml, renderInvoiceText, splitGst, toMinor,
  verifyPaymentSignature, verifyWebhookSignature, type Company, type CreatedOrder, type InvoiceData, type RazorpayConfig,
} from "../../../packages/billing/src";
import { PACKS, price } from "../../../packages/shared/src/pricing";
import { GRACE_ROUNDS } from "../../../packages/beacon/src/config";
import type { D1, Env } from "./worker";
import { keepLegalParty } from "./legal";
import { PdfDoc, NAVY } from "./pdf";
import { ledgerFields, logWebhook, siteOf, type HookRecord } from "./ledger";
import { partnerCode, phoneHashFor, recordCommission, refCode } from "./partners";
import { getMode, mailGate, testFlag, type ModeEnv } from "./mode";
import { lookupPayLink, packFor, payLinkPublic } from "./paylink";
import { creditAppliedFor, creditFromPayment, creditUsesFor, mailCreditCreated, restoreCreditUses, rs } from "./credit";

export interface PayEnv extends Env, Pick<ModeEnv, "OWNER_EMAIL" | "TEST_MAIL_ALLOW"> {
  RAZORPAY_KEY_ID?: string; RAZORPAY_KEY_SECRET?: string; RAZORPAY_WEBHOOK_SECRET?: string; RAZORPAY_BASE_URL?: string; RAZORPAY_INTERNATIONAL?: string;
  PARTNER_COMMISSION_RATE?: string; TEST_MODE?: string; COMPANY_JSON?: string; RESEND_API_KEY?: string; FREE_LAUNCH?: string; MAIL_FROM?: string; MAIL_REPLY_TO?: string; PUBLIC_ORIGIN?: string; PAY_HOP_URL?: string; PAY_SERVICE_KEY?: string; PAY_SERVICE_URL?: string; PAY_SITE?: string;
}

export const PAY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS payment (id TEXT PRIMARY KEY, org TEXT, email TEXT NOT NULL, pack INTEGER NOT NULL, currency TEXT NOT NULL, amount REAL NOT NULL, tax REAL NOT NULL, rzp_order_id TEXT UNIQUE, rzp_payment_id TEXT, status TEXT NOT NULL, created_ms INTEGER NOT NULL, paid_ms INTEGER, meta TEXT NOT NULL, result TEXT, ref TEXT, buyer_phone_hash TEXT)`,
  `CREATE TABLE IF NOT EXISTS invoice (token TEXT PRIMARY KEY, payment_id TEXT UNIQUE NOT NULL, brand TEXT NOT NULL, fy TEXT NOT NULL, seq INTEGER NOT NULL, number TEXT NOT NULL, issued_ms INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE (brand, fy, seq))`,
  `CREATE TABLE IF NOT EXISTS entitlement (id TEXT PRIMARY KEY, org TEXT NOT NULL, pack INTEGER NOT NULL, payment_id TEXT NOT NULL, eid TEXT, created_ms INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS organizer_email (email_hash TEXT PRIMARY KEY, org TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, at_ms INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0)`,
];

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const randHex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const brand = BRANDS.corporate_tic_tac_toe;
/** Payment attempts one network address may start through pay links in a day. */
const PAYLINK_PER_IP_DAY = 30;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export const company = (env: PayEnv): Company => { try { return { ...DEFAULT_COMPANY, ...(env.COMPANY_JSON ? JSON.parse(env.COMPANY_JSON) : {}) }; } catch { return DEFAULT_COMPANY; } };
/** Indian payers see UPI first (on a phone this opens their UPI app); cards and net banking stay one tap away. USD payers get Razorpay's normal international card screen. */
const UPI_FIRST = { display: { blocks: { upi: { name: "Pay with UPI", instruments: [{ method: "upi" }] }, other: { name: "Cards, net banking, wallets", instruments: [{ method: "card" }, { method: "netbanking" }, { method: "wallet" }] } }, sequence: ["block.upi", "block.other"], preferences: { show_default_blocks: false } } };
/** Option 1 (2026-10-11): the Razorpay window runs inside a page of the website that is registered with Razorpay (IT Services by Rajat Agarwal), shown in a frame on our payment screen. Unset = the window opens on our own page as before. */
const hopOf = (env: PayEnv): { hop?: string } => (env.PAY_HOP_URL && /^https:\/\/[a-z0-9.-]+\/[A-Za-z0-9/_-]*$/.test(env.PAY_HOP_URL) ? { hop: env.PAY_HOP_URL } : {});
const rzpOf = (env: PayEnv): (RazorpayConfig) | null => (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET, webhookSecret: env.RAZORPAY_WEBHOOK_SECRET, baseUrl: env.RAZORPAY_BASE_URL } : null);
/**
 * Central payments (product rule 2026-10-12): every order is opened through IT Services by Rajat Agarwal, so every rupee sits in its ONE Razorpay ledger as
 * razorpay / IT Services / <website> / <stream> / <plan>. This site is the "sales" stream; the plan is the pack (pack_250) or payment_test.
 * Without PAY_SERVICE_KEY, or if the central service cannot be reached, the order is opened directly with Razorpay exactly as before (the webhook still reaches the ledger).
 */
const centralOf = (env: PayEnv) => (env.PAY_SERVICE_KEY ? { url: (env.PAY_SERVICE_URL ?? "https://itservices-rajat-agarwal.pages.dev").replace(/\/+$/, ""), key: env.PAY_SERVICE_KEY, site: env.PAY_SITE ?? "corporate-tic-tac-toe.pages.dev" } : null);
async function placeOrder(env: PayEnv, rzp: RazorpayConfig, o: { amountMinor: number; currency: "INR" | "USD"; receipt: string; notes: Record<string, string>; plan: string; user?: string | null; email?: string }): Promise<CreatedOrder> {
  const c = centralOf(env);
  if (c) {
    try {
      const r = await fetch(`${c.url}/api/pay/order`, { method: "POST", headers: { "content-type": "application/json", "x-site-key": c.key }, body: JSON.stringify({ site: c.site, product: "corporate_tic_tac_toe", plan: o.plan, amount_minor: o.amountMinor, currency: o.currency, payment_ref: o.receipt, extra_notes: o.notes, ...(o.user ? { user: o.user } : {}), ...(o.email ? { payer_email: o.email } : {}) }), signal: AbortSignal.timeout(6000) });
      const d: any = await r.json().catch(() => ({}));
      if (r.ok && d.orderId) return { id: d.orderId, amount: o.amountMinor, currency: o.currency, receipt: o.receipt, status: "created" };
      console.warn("central order refused", r.status, d?.error);
    } catch (e) { console.warn("central order unreachable", String(e)); }
  }
  return createOrder(rzp, o);
}
/** After a correctly signed payment: tell the central ledger (best effort, never blocks or fails the buyer; the central webhook records it too). */
async function reportToCentral(env: PayEnv, b: any): Promise<void> {
  const c = centralOf(env); if (!c) return;
  try { await fetch(`${c.url}/api/pay/verify`, { method: "POST", headers: { "content-type": "application/json", "x-site-key": c.key }, body: JSON.stringify({ site: c.site, razorpay_order_id: String(b.razorpay_order_id), razorpay_payment_id: String(b.razorpay_payment_id), razorpay_signature: String(b.razorpay_signature) }), signal: AbortSignal.timeout(4000) }); } catch { /* the webhook records it */ }
}
/** Optional switch (env FREE_LAUNCH="1"): small engagements (up to FREE_CAP participants) may be published without a purchase. Building a draft is always free. */
export const FREE_CAP = 100, MAX_DRAFTS = 10;
/** A game held for payment begins this many rounds (3 s each = 2 minutes) after the payment is confirmed. */
export const LATE_PAY_LEAD_ROUNDS = 40;
export const freeLaunch = (env: PayEnv) => env.FREE_LAUNCH === "1";
export const payMode = (env: PayEnv) => (rzpOf(env) ? "razorpay" : env.TEST_MODE === "1" ? "test" : "off");

async function body(req: Request, max = 4096): Promise<any | null> { const t = await req.text(); if (t.length > max) return null; try { const v = JSON.parse(t); return v && typeof v === "object" ? v : null; } catch { return null; } }

const KEYRE = /cb[kah]_[0-9a-f]{48}/g;
/**
 * Mail goes out through Resend (the same account and verified sending domain DPDP already uses, so no extra cost). Only organizers, the people who bought,
 * are ever e-mailed; participants are reached by mobile number only. In production the mail body is never kept: a sent mail leaves no body behind, and a
 * mail that could not be sent is kept (with any organizer key blanked out) only so the daily job can try again, then it is dropped after 3 days.
 * Without RESEND_API_KEY (local/test) the mail simply stays in the outbox so it can be read.
 */
export async function sendMail(env: PayEnv, db: D1, to: string, subject: string, text: string, now: number, opts: { html?: string; secret?: boolean } = {}): Promise<boolean> {
  // `secret` = the mail carries a personal AI work link: if it cannot be sent, no body is kept at all (nothing to retry later; the organizer can replace the link and get a fresh mail).
  // TEST mode (mode.ts): only the owner's allow-list is ever e-mailed; everyone else is dropped and logged. Not sent = false, and no body is kept.
  if ((await getMode(env)) === "TEST") { if (!(await mailGate(env, to, subject, now))) return false; subject = "[TEST] " + subject; }
  const html = opts.html ?? plainToHtml(subject, text, env.PUBLIC_ORIGIN); // every mail carries the brand header and footer, whoever built it
  text = withFooter(text, env.PUBLIC_ORIGIN);
  if (!env.RESEND_API_KEY) { await db.prepare("INSERT INTO outbox(to_addr,subject,body,at_ms,sent) VALUES(?,?,?,?,0)").bind(to, subject, text, now).run(); return true; }
  const ok = await resendSend(env, to, subject, text, html);
  await db.prepare("INSERT INTO outbox(to_addr,subject,body,at_ms,sent) VALUES(?,?,?,?,?)").bind(to, subject, ok ? "" : opts.secret ? "" : text.replace(KEYRE, "cbk_(blanked; use the key shown when you paid, or sign in with an e-mailed code)"), now, ok ? 1 : 0).run();
  return ok;
}
/** Mail sent with attachments in a test run (no mail key): the tests read the PDFs from here. Never used in production. */
export const sentReports: { to: string; subject: string; text: string; attachments: { filename: string; content: Uint8Array }[] }[] = [];
const toB64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
/** E-mails the engagement report. The attachment is passed straight to the mail service and is never stored or logged here. Returns false when it could not be sent (the caller tries again). */
export async function sendReportMail(env: PayEnv, to: string, subject: string, text: string, attachments: { filename: string; content: Uint8Array }[]): Promise<boolean> {
  if ((await getMode(env)) === "TEST") { if (!(await mailGate(env, to, subject, Date.now()))) return true; subject = "[TEST] " + subject; } // dropped on purpose and logged: counts as handled so the report steps carry on
  const html = plainToHtml(subject, text, env.PUBLIC_ORIGIN); text = withFooter(text, env.PUBLIC_ORIGIN);
  if (!env.RESEND_API_KEY) { sentReports.push({ to, subject, text, attachments }); return true; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM ?? "Corporate Tic Tac Toe <noreply@corporate-tic-tac-toe.example>", to: [to], subject, text, html, attachments: attachments.map((a) => ({ filename: a.filename, content: toB64(a.content) })), ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}), headers: { "Auto-Submitted": "auto-generated" } }),
    });
    return r.ok;
  } catch { return false; }
}
async function resendSend(env: PayEnv, to: string, subject: string, text: string, html?: string): Promise<boolean> {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM ?? "Corporate Tic Tac Toe <noreply@corporate-tic-tac-toe.example>", to: [to], subject, text, ...(html ? { html } : {}), ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}), headers: { "Auto-Submitted": "auto-generated" } }),
    });
    return r.ok;
  } catch { return false; }
}
/** Daily job: tries unsent mail once more (only mail with a body worth retrying), and forgets anything older than 3 days. */
export async function retryOutbox(env: PayEnv, now: number): Promise<{ retried: number; dropped: number }> {
  const db = env.DB; let retried = 0;
  if (env.RESEND_API_KEY && (await getMode(env)) !== "TEST") { // in TEST mode nothing queued earlier is sent: it is only ever the owner's allow-list that gets mail
    const rows = (await db.prepare("SELECT id, to_addr, subject, body FROM outbox WHERE sent=0 AND body<>'' AND at_ms>?").bind(now - 3 * 86_400_000).all<any>()).results ?? [];
    for (const r of rows) if (await resendSend(env, r.to_addr, r.subject, r.body)) { await db.prepare("UPDATE outbox SET sent=1, body='' WHERE id=?").bind(r.id).run(); retried++; }
  }
  const old = await db.prepare("DELETE FROM outbox WHERE at_ms<?").bind(now - 3 * 86_400_000).run();
  return { retried, dropped: old.meta?.changes ?? 0 };
}

/** The public "Payment Testing" page (Rs 1 / US$ 1, product rule 2026-10-10): a REAL payment that buys nothing. It never touches packs, credit, commission or the real invoice series; the receipt is numbered PAYTEST-<year>-<n> and the row is flagged is_test so it stays out of the owner's reports. */
async function fulfilPaytest(env: PayEnv, p: any, meta: any, now: number) {
  const db = env.DB;
  const co = company(env), fy = financialYear(new Date(now));
  const rz = rzpOf(env); let pinfo: ReturnType<typeof paymentInfo> | undefined;
  if (rz && p.rzp_payment_id) { try { pinfo = paymentInfo(await fetchPayment(rz, p.rzp_payment_id)); } catch { /* the receipt still prints without it */ } }
  const seq = -(((await db.prepare("SELECT COUNT(*) AS c FROM invoice WHERE brand=? AND fy=? AND seq<0").bind(brand.id, fy).first<{ c: number }>())?.c ?? 0) + 1);
  const number = `PAYTEST-${fy}-${-seq}`;
  const tax = splitGst(p.amount, p.currency, co.stateCode, undefined);
  const data: InvoiceData = { number, issuedAt: now, brand, company: co, draft: false, buyer: { name: meta.org || meta.name, gstin: meta.taxId || undefined, email: p.email, phone: meta.phone || undefined, country: meta.country }, currency: p.currency,
    lines: [{ description: `${brand.name}: payment test (nothing was bought)`, quantity: 1, amount: tax.taxable }], tax, paymentRef: p.rzp_payment_id ?? undefined, orderRef: p.id, paidAtMs: pinfo?.createdAtMs ?? now,
    organizer: { name: meta.name, email: p.email, phone: meta.phone || undefined }, ...(pinfo ? { pay: pinfo } : {}), note: "This receipt is for a payment test. No game, pack or credit was bought." };
  const token = "inv_" + randHex(16);
  await db.prepare("INSERT OR IGNORE INTO invoice(token,payment_id,brand,fy,seq,number,issued_ms,data) VALUES(?,?,?,?,?,?,?,?)").bind(token, p.id, brand.id, fy, seq, number, now, JSON.stringify(data)).run();
  const origin = env.PUBLIC_ORIGIN ?? meta.origin ?? "";
  await sendMail(env, db, p.email, `${brand.name}: payment test received, receipt ${number}`, `Thank you. Your payment test worked. Nothing was bought.

INVOICE
${renderInvoiceText(data)}
View or print it: ${origin}/api/invoice/${token}`, now);
  const result = { ok: true, paytest: true, orderId: p.id, total: p.amount, currency: p.currency, invoiceUrl: `/api/invoice/${token}`, invoiceNumber: number, razorpayPaymentId: p.rzp_payment_id ?? null };
  await db.prepare("UPDATE payment SET status='paid', paid_ms=?, result=? WHERE id=?").bind(now, JSON.stringify(result), p.id).run();
  return { result };
}

export async function fulfil(env: PayEnv, paymentId: string, now: number, spend: (n: number) => Promise<boolean>) {
  const db = env.DB;
  const p = await db.prepare("SELECT * FROM payment WHERE id=?").bind(paymentId).first<any>();
  if (!p) return { error: "Unknown payment.", status: 404 };
  if (p.status === "paid") return { result: JSON.parse(p.result ?? "{}") };
  if (!(await spend(6))) return { error: "Busy day. Your payment is safe; this will complete shortly.", status: 503 };
  const meta = JSON.parse(p.meta);
  if (meta.paytest) return fulfilPaytest(env, p, meta, now);
  const eh = await sha("email|" + p.email.toLowerCase());
  let org: string | null = meta.orgId ?? (await db.prepare("SELECT org FROM organizer_email WHERE email_hash=?").bind(eh).first<{ org: string }>())?.org ?? null;
  let organizerKey: string | null = null;
  const test = p.is_test ? 1 : 0; // a payment made in TEST mode (mode.ts): everything it creates is flagged too
  if (meta.orgId) await db.prepare("INSERT OR IGNORE INTO organizer_email(email_hash,org) VALUES(?,?)").bind(eh, meta.orgId).run(); // the confirmed email can sign this organizer in too
  if (!org) { // a first purchase makes the organizer; the key is shown once (and mailed)
    org = randHex(8); organizerKey = "cbk_" + randHex(24);
    await db.batch([
      db.prepare("INSERT INTO organizer_key(hash,org,kind,revoked,created_ms,is_test) VALUES(?,?,?,0,?,?)").bind(await sha("key|" + organizerKey), org, "master", now, test),
      db.prepare("INSERT INTO organizer_email(email_hash,org,is_test) VALUES(?,?,?)").bind(eh, org, test),
    ]);
  }
  // NO REFUNDS (docs/ROLES_AND_CONSOLE_SPEC_6.md): a payment that arrives for a game that was cancelled, or that closed as "did not start", is kept as CREDIT for the account. It buys no pack.
  const closedGame = meta.eid ? await db.prepare("SELECT id, org, config, cancelled_ms, unplayed_ms FROM engagement WHERE id=? AND org=?").bind(meta.eid, org).first<any>() : null;
  const closed = !!(closedGame && (closedGame.cancelled_ms || closedGame.unplayed_ms));
  if (!closed) await db.prepare("INSERT OR IGNORE INTO entitlement(id,org,pack,payment_id,eid,created_ms) VALUES(?,?,?,?,NULL,?)").bind("ent_" + p.id, org, p.pack, p.id, now).run();
  let published: string | null = null, restart: number | null = null;
  if (meta.eid) { // publish the draft this payment was made for (only if it is still an unpublished draft of the same organizer)
    const up = await db.prepare("UPDATE engagement SET pack=? WHERE id=? AND org=? AND pack=0 AND cancelled_ms IS NULL AND unplayed_ms IS NULL").bind(p.pack, meta.eid, org).run(); // a cancelled game is never published by a late payment
    if ((up.meta?.changes ?? 0) > 0) {
      await db.prepare("UPDATE entitlement SET eid=? WHERE id=? AND eid IS NULL").bind(meta.eid, "ent_" + p.id).run(); published = meta.eid;
      await db.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)").bind(`pub/${meta.eid}`, String(now)).run(); // paying also publishes
      if (meta.paidBy) await db.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)").bind(`paidby/${meta.eid}`, JSON.stringify({ by: meta.paidBy, ms: now, ...(meta.viaCredit ? { via: "credit" } : {}) })).run(); // who paid: organizer, host or co-host (and "credit" when credit paid for it)
      const st = await db.prepare("SELECT start_round FROM engagement WHERE id=?").bind(meta.eid).first<{ start_round: number }>();
      if (st && (1692803367 + (st.start_round - 1) * 3) * 1000 <= now) { // it was held because it was not paid at its start time: the first number now comes 2 minutes after the payment was confirmed, for everyone already waiting
        restart = Math.floor((now / 1000 - 1692803367) / 3) + 2 + LATE_PAY_LEAD_ROUNDS - GRACE_ROUNDS; // 2 minutes to the first number: the 2-minute setup window (GRACE_ROUNDS = 40) is all of it, so the clock start is the next round
        await db.prepare("UPDATE engagement SET start_round=? WHERE id=?").bind(restart, meta.eid).run();
      }
    }
  }
  if (published && typeof meta.creditInr === "number") await restoreCreditUses(db, published, now, meta.creditInr); // credit applied after this checkout was opened is given back: the game is already covered
  const cuses = published ? await creditUsesFor(db, published) : [];
  const creditTotal = Math.round(cuses.reduce((t, u) => t + u.amount, 0) * 100) / 100;
  // invoice: brand-wise numbering per financial year; the legal entity is always the supplier; missing supplier details => DRAFT, never a fake valid invoice
  const co = company(env);
  const fy = financialYear(new Date(now));
  const tax = splitGst(p.amount, p.currency, co.stateCode, meta.taxId);
  const token = "inv_" + randHex(16);
  // a test payment never uses a number of the real series: it gets a negative sequence and a TEST- number, and the invoice is marked as a draft
  const seq = test
    ? -(((await db.prepare("SELECT COUNT(*) AS c FROM invoice WHERE brand=? AND fy=? AND seq<0").bind(brand.id, fy).first<{ c: number }>())?.c ?? 0) + 1)
    : ((await db.prepare("SELECT COALESCE(MAX(seq),0) AS m FROM invoice WHERE brand=? AND fy=? AND seq>0").bind(brand.id, fy).first<{ m: number }>())?.m ?? 0) + 1;
  const number = test ? `TEST-${fy}-${-seq}` : formatInvoiceNumber(brand, fy, seq);
  // what Razorpay itself recorded (method, masked UPI id / card tail, bank reference, its own time): printed on the invoice and kept in the payment's meta. A failed lookup never blocks the invoice.
  const rz = rzpOf(env); let pinfo: ReturnType<typeof paymentInfo> | undefined;
  if (rz && p.rzp_payment_id && !test) { try { pinfo = paymentInfo(await fetchPayment(rz, p.rzp_payment_id)); await db.prepare("UPDATE payment SET meta=? WHERE id=?").bind(JSON.stringify({ ...meta, rzp: pinfo }), p.id).run(); } catch { pinfo = meta.rzp; } } else if (meta.rzp) pinfo = meta.rzp;
  const eidForInvoice = meta.eid ?? published ?? undefined;
  let gameName: string | undefined, gameStart: number | undefined, contact: any = {};
  if (eidForInvoice) {
    try { const g = await db.prepare("SELECT config, start_round FROM engagement WHERE id=?").bind(eidForInvoice).first<{ config: string | null; start_round: number }>(); if (g) { try { const c = g.config ? JSON.parse(g.config) : {}; if (typeof c.name === "string" && c.name) gameName = c.name.slice(0, 120); } catch { /* the id is the name */ } gameStart = (1692803367 + (g.start_round - 1) * 3) * 1000; } } catch { /* optional */ }
    try { const r = await db.prepare("SELECT v FROM kv WHERE k=?").bind(`contact/${eidForInvoice}`).first<{ v: string }>(); contact = r ? JSON.parse(r.v) : {}; } catch { contact = {}; }
  }
  const organizer = { name: meta.paidBy && meta.paidBy !== "organizer" ? contact.name : meta.name ?? contact.name, org: meta.org || undefined, email: contact.email ?? p.email, phone: contact.phone ? String(contact.phone) : meta.phone };
  const data: InvoiceData = { number, issuedAt: now, brand, company: co, draft: !!test || companyGaps(co).length > 0, buyer: { name: meta.org || meta.name || "", gstin: meta.taxId || undefined, email: p.email, phone: meta.phone || undefined, country: meta.country }, currency: p.currency,
    lines: [{ description: closed ? `${brand.name}: payment received after the game closed (kept as credit)` : `${brand.name}: up to ${p.pack} participants (one engagement)${creditTotal > 0 ? (p.amount > 0 ? ", balance after credit" : ", paid from credit") : ""}`, quantity: 1, amount: tax.taxable }], tax, paymentRef: p.rzp_payment_id ?? undefined, orderRef: p.id, paidAtMs: pinfo?.createdAtMs ?? now, ...(eidForInvoice ? { game: { id: eidForInvoice, ...(gameName ? { name: gameName } : {}), ...(gameStart ? { startMs: gameStart } : {}) } } : {}), organizer, ...(pinfo ? { pay: pinfo } : {}),
    ...(creditTotal > 0 ? { note: `${cuses.map((u) => `Paid from credit of invoice ${u.invoice ?? u.credit_id}: ${rs(u.amount, p.currency)}`).join("; ")}.` } : {}) };
  await db.prepare("INSERT OR IGNORE INTO invoice(token,payment_id,brand,fy,seq,number,issued_ms,data) VALUES(?,?,?,?,?,?,?,?)").bind(token, p.id, brand.id, fy, seq, number, now, JSON.stringify(data)).run();
  const origin = env.PUBLIC_ORIGIN ?? meta.origin ?? "";
  const keptCredit = closed ? await creditFromPayment(db, { ...p, paid_ms: now }, org, meta.eid, now, "late") : null; // a payment for a cancelled or closed game: credit, never a refund
  const lines = [
    closed ? `Thank you. Your payment was received after the game "${meta.eid}" had been cancelled or closed. We do not give refunds: it stays as credit for the organizer's next game${keptCredit ? ` until ${new Date(keptCredit.expires_ms - 1).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}` : ""}.` : `Thank you. Payment received for up to ${p.pack} participants.`,
    closed ? "The organizer has been told." : published ? `Your engagement is live. Share the link from your console: ${origin}/zc.html?e=${published}` : organizerKey ? `Your organizer key (keep it private, it is shown only once): ${organizerKey}\nOpen ${origin}/zc.html and paste it to begin.` : `Use your existing organizer key at ${origin}/zc.html to create this engagement.`,
    `\nINVOICE\n${renderInvoiceText(data)}\nView or print it: ${origin}/api/invoice/${token}`,
  ];
  await sendMail(env, db, p.email, `${brand.name}: payment received, invoice ${number}`, lines.join("\n\n"), now);
  // the same invoice goes to the organizer's own e-mail when someone else paid (a Co-host or a pay link) or the organizer's e-mail differs from the payer's
  const orgMail = typeof organizer.email === "string" ? organizer.email.trim().toLowerCase() : "";
  if (orgMail && EMAIL.test(orgMail) && orgMail !== p.email.trim().toLowerCase()) await sendMail(env, db, orgMail, `${brand.name}: invoice ${number} for your game`, `An invoice for your game${eidForInvoice ? ` ${eidForInvoice}` : ""} was issued by ${brand.name}.\n\nINVOICE\n${renderInvoiceText(data)}\n\nView or print it: ${origin}/api/invoice/${token}\nDownload the PDF: ${origin}/api/invoice/${token}.pdf`, now);
  await recordCommission(env, p, tax.taxable, now); // refer & earn: a commission row for a referred, PAID purchase only
  const result = { ok: true, orderId: p.id, pack: p.pack, total: p.amount, tax: p.tax, currency: p.currency, invoiceUrl: `/api/invoice/${token}`, invoiceNumber: number, razorpayPaymentId: p.rzp_payment_id ?? null, organizerKey, newOrganizer: !!organizerKey, published: !!published, eid: published, restartedAtMs: restart ? (1692803367 + (restart - 1) * 3) * 1000 : null, ...(keptCredit ? { creditKept: true, creditId: keptCredit.id, creditExpiresMs: keptCredit.expires_ms } : {}) };
  await db.prepare("UPDATE payment SET status='paid', paid_ms=?, org=?, result=? WHERE id=?").bind(now, org, JSON.stringify(result), p.id).run();
  if (meta.eid) { try { await keepLegalParty(db, meta.eid, now); } catch { /* the deletion step copies it again */ } } // permanent record of who paid and the organizer's invoice details
  if (keptCredit && closedGame) await mailCreditCreated(env, keptCredit, closedGame, "late", now); // the Organizer and the Hosts are told once; the payer got the receipt above
  if (published) await recordFunnelForOrg({ DB: db }, org, "published", now); // marketing funnel (visits.ts): counted once, against the visitor's first visit
  await recordFunnelForOrg({ DB: db }, org, "paid", now);
  return { result };
}

/** Which keys may pay a game of their account, and how the payment is shown. */
export const PAYER: Record<string, string> = { master: "organizer", host: "host", cohost: "co-host" };
/** Returns a Response for payment routes, or null when the path is not one of ours. */
export async function payRoute(req: Request, env: PayEnv, now: number, spend: (n: number) => Promise<boolean>): Promise<Response | null> {
  const url = new URL(req.url); const p = url.pathname; const db = env.DB;
  const rzp = rzpOf(env); const mode = payMode(env);
  const busy = () => json({ error: "It is very busy right now. Please try again in a few minutes." }, 503);

  if (req.method === "GET" && p === "/api/payments/status") { const co = company(env); return json({ mode: (await getMode(env)) === "TEST" ? "test" : mode, siteMode: await getMode(env), freeLaunch: freeLaunch(env), freeCap: FREE_CAP, brand: brand.name, legalEntity: co.legalName, missingCompanyDetails: companyGaps(co), international: env.RAZORPAY_INTERNATIONAL === "1" }); }

  // The public pay link (paylink.ts): anyone holding the token sees the game's name, start and price, and may pay for THIS game only.
  const plm = p.match(/^\/api\/paylink\/([0-9a-f]{48})(\/checkout)?$/);
  if (plm && !plm[2] && req.method === "GET") {
    const v = await lookupPayLink(db, plm[1]!, now);
    if (!v) return json({ error: "Not found" }, 404);
    let name = v.e.id; try { const c = v.e.config ? JSON.parse(v.e.config) : {}; if (typeof c.name === "string" && c.name) name = c.name; } catch { /* the id is the name */ }
    const pub = payLinkPublic(v, name, (1692803367 + (v.e.start_round - 1) * 3) * 1000, url.searchParams.get("currency") === "USD" ? "USD" : "INR");
    // the full price, unless the person who made the link had already applied credit to this game: then (and only then) the reduced amount is what gets charged. The credit itself is never shown.
    const credited = pub.price && v.status === "open" ? await creditAppliedFor(db, v.e.id) : 0;
    if (pub.price && credited > 0 && pub.price.currency === "INR") { const total = Math.max(0, Math.round((pub.price.total - credited) * 100) / 100); pub.price = { ...pub.price, total, base: Math.round((total / 1.18) * 100) / 100, gst: Math.round((total - total / 1.18) * 100) / 100 }; }
    return json(pub);
  }
  if (req.method === "POST" && (p === "/api/checkout" || p === "/api/payments/test" || !!plm?.[2])) {
    // TEST mode (mode.ts): no Razorpay order is ever made; the payment is a labelled test payment that is marked paid at once, flagged is_test, and publishes the draft it was made for. LIVE refuses the labelled path.
    const siteTest = (await testFlag(env)) === 1;
    if (p === "/api/payments/test" && !siteTest) return json({ error: "Test payments are only available while the service is in test mode." }, 403);
    const rzp = siteTest ? null : rzpOf(env), mode = siteTest ? "test" : payMode(env);
    if (mode === "off") return json({ error: "Payments are not switched on yet. Please try again later." }, 503);
    const b = await body(req);
    // a signed-in organizer paying to publish their own draft: the pack is the smallest one that fits the draft, and the payment is bound to them and to it
    let boundOrg: string | null = null, boundEid: string | null = null, boundPack: number | null = null, paidBy: string | null = null;
    const presented = (req.headers.get("x-organizer") ?? "").trim();
    if (plm) { // the pay link binds the payment to its game; the payer needs no account and no key (and a key sent along is ignored)
      const pv = await lookupPayLink(db, plm[1]!, now);
      if (!pv) return json({ error: "Not found" }, 404);
      if (pv.status !== "open") return json({ error: pv.status === "paid" ? "This game has already been paid for." : pv.status === "cancelled" ? "This game was cancelled by the organizer. It cannot be paid for." : pv.status === "closed" ? "This game did not start and is closed. It cannot be paid for." : pv.status === "confirming" ? "A payment for this game is being confirmed. Please wait a few minutes." : "This pay link has expired. Ask for a new one.", status: pv.status }, 409);
      boundPack = packFor(pv.e.cap);
      if (!boundPack) return json({ error: "That many participants needs a custom arrangement. Please write to us." }, 400);
      boundOrg = pv.link.org; boundEid = pv.link.eid; paidBy = "link";
      try { // the same free-plan guard as other public writes: a few attempts per network address per day, and a daily write budget
        const ipk = `plim/${new Date(now).toISOString().slice(0, 10)}/pl${(await sha("ip|" + (req.headers.get("cf-connecting-ip") ?? "local"))).slice(0, 16)}`;
        const used = Number((await db.prepare("SELECT v FROM kv WHERE k=?").bind(ipk).first<{ v: string }>())?.v ?? 0);
        if (used >= PAYLINK_PER_IP_DAY) return json({ error: "Too many payment attempts from this network today. Please try again tomorrow." }, 429);
        await db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=?").bind(ipk, String(used + 1), String(used + 1)).run();
      } catch { /* never block a payment on the counter */ }
    } else if (presented && typeof b?.eid === "string") {
      const k = await db.prepare("SELECT org, kind, eid FROM organizer_key WHERE hash=? AND revoked=0 AND (expires_ms IS NULL OR expires_ms>?)").bind(await sha("key|" + presented), now).first<{ org: string; kind: string; eid: string | null }>();
      if (!k || !(k.kind in PAYER)) return json({ error: "Please sign in again." }, 403); // the Organizer, a Host or a Co-host of this account may pay; one payment is enough for the game
      paidBy = PAYER[k.kind]!;
      const eg = await db.prepare("SELECT org, cap, pack, cancelled_ms, unplayed_ms FROM engagement WHERE id=?").bind(b.eid).first<{ org: string | null; cap: number; pack: number | null; cancelled_ms: number | null; unplayed_ms: number | null }>();
      if (!eg || eg.org !== k.org) return json({ error: "No such engagement." }, 404);
      if (k.kind === "cohost" && k.eid && k.eid !== b.eid) return json({ error: "Your Co-host link is for a different game." }, 403); // a Co-host belongs to one game
      if (eg.cancelled_ms) return json({ error: "This game was cancelled by the organizer. It cannot be paid for." }, 409);
      if (eg.unplayed_ms) return json({ error: "This game did not start and is closed. It cannot be paid for.", code: "did-not-start" }, 409);
      if (eg.pack !== 0) return json({ error: "This engagement is already published." }, 409);
      if (await db.prepare("SELECT 1 AS x FROM kv WHERE k=?").bind(`startpending/${b.eid}`).first()) return json({ error: "Pick the date and time of this game first.", code: "start-pending" }, 400);
      boundPack = PACKS.find((x) => x[0] >= eg.cap)?.[0] ?? null;
      if (!boundPack) return json({ error: "That many participants needs a custom arrangement. Please write to us." }, 400);
      boundOrg = k.org; boundEid = b.eid;
    }
    const pack = boundPack ?? Number(b?.pack); const cur = b?.currency === "USD" ? "USD" : "INR";
    if (!b || !PACKS.some((x) => x[0] === pack)) return json({ error: "Choose a pack." }, 400);
    { const mt = consentRequired(b, "K3"); if (mt) return mt; } // K3: "I agree to the Terms and the Refund Policy. I understand there is no refund; my payment stays as credit."
    if (typeof b.email !== "string" || !EMAIL.test(b.email.trim())) return json({ error: "Enter a valid e-mail address." }, 400);
    // minimum to pay: a name and an e-mail. Organisation, mobile, country and GSTIN are optional (an older caller that sends only `org` still works: it is used as the name).
    const payerName = (typeof b.name === "string" && b.name.trim() ? b.name : typeof b.org === "string" ? b.org : "").trim();
    if (payerName.length < 2) return json({ error: "Enter your name." }, 400);
    const orgName = typeof b.org === "string" ? b.org.trim() : "";
    const dial = typeof b.phoneCode === "string" && /^\d{1,4}$/.test(b.phoneCode) ? b.phoneCode : "91", phoneDigits = typeof b.phone === "string" ? b.phone.replace(/\D/g, "").replace(/^0+/, "") : "";
    const contact = phoneDigits.length >= 6 && phoneDigits.length <= 14 ? `+${dial}${phoneDigits}` : "";
    if ((typeof b.country !== "string" || b.country.slice(0, 2) === "IN") && typeof b.taxId === "string" && b.taxId.trim() && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(b.taxId.trim().toUpperCase())) return json({ error: "That GSTIN does not look right. It has 15 characters, like 27ABCDE1234F1Z5." }, 400);
    if (cur === "USD" && rzp && env.RAZORPAY_INTERNATIONAL !== "1") return json({ error: "Payments in US dollars are not switched on yet. Please pay in Indian rupees or write to us." }, 400);
    if (!(await spend(2))) return busy();
    const full = price(pack, cur);
    // credit already applied to THIS game (by the Organizer, a Host or a Co-host, before this checkout) reduces what is charged; nothing else about credit is ever shown or used here
    const credited = boundEid ? Math.round((await creditAppliedFor(db, boundEid)) * 100) / 100 : 0;
    const cash = Math.round((full.total - credited) * 100) / 100;
    if (boundEid && credited > 0 && cash < 1) return json({ error: "Credit already covers this game. Tap Use my credit to finish.", code: "use-credit" }, 409);
    const pr = credited > 0 ? { total: cash, base: cur === "INR" ? Math.round((cash / 1.18) * 100) / 100 : cash, tax: cur === "INR" ? Math.round((cash - cash / 1.18) * 100) / 100 : 0 } : full;
    const id = "pay_" + randHex(8);
    await recordConsent(db, { subject: boundOrg ?? "payer", kind: "K3", ref: id, now }); // K3: stored with the payment it was for
    const meta = { org: orgName.slice(0, 120), name: payerName.slice(0, 120), ...(contact ? { phone: contact } : {}), country: typeof b.country === "string" ? b.country.slice(0, 2) : "IN", taxId: typeof b.taxId === "string" ? b.taxId.trim().slice(0, 20) : "", origin: env.PUBLIC_ORIGIN ?? url.origin, ...(boundOrg ? { orgId: boundOrg, eid: boundEid, paidBy, ...(credited > 0 ? { creditInr: credited } : {}) } : {}) };
    let order: any = null;
    if (rzp) {
      try { order = await placeOrder(env, rzp, { amountMinor: toMinor(pr.total), currency: cur, receipt: id, plan: `tictactoe_pack_${pack}`, user: boundOrg ?? null, email: b.email.trim().toLowerCase(), notes: { brand: brand.name, site: env.PAY_SITE ?? "corporate-tic-tac-toe.pages.dev", stream: "sales", product: "corporate_tic_tac_toe", plan: `tictactoe_pack_${pack}`, variation: `tictactoe_pack_${pack}`, pack: String(pack), currency: cur, organization: (meta.org || meta.name).slice(0, 80), payment_ref: id } }); }
      catch (e: any) { return json({ error: `The payment service said: ${e.message}` }, 502); }
    }
    const ref = refCode(b.ref); // from the buyer's own browser (valid for 30 days after the link was opened); checked against real partners when the payment is fulfilled
    const bph = partnerCode(b.phone); // optional, only used to spot a partner buying through their own link
    const lf = ledgerFields(siteOf(meta.origin), "game_pack", `pack_${pack}`, boundOrg ?? null);
    await db.prepare("INSERT INTO payment(id,org,email,pack,currency,amount,tax,rzp_order_id,status,created_ms,meta,ref,buyer_phone_hash,is_test,eid,site,product,product_type,product_ref,payer_user) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, null, b.email.trim().toLowerCase(), pack, cur, pr.total, pr.tax, order?.id ?? null, "created", now, JSON.stringify(meta), ref, bph ? await phoneHashFor(env, bph) : null, siteTest ? 1 : 0, boundEid, lf.site, lf.product, lf.productType, lf.productRef, lf.payerUser).run();
    if (!rzp) { const f = await fulfil(env, id, now, spend); return "result" in f ? json({ mode: "test", paymentId: id, result: f.result, ...(siteTest ? { testPayment: true, label: "TEST payment: nothing was charged." } : {}) }) : json({ error: f.error }, f.status); }
    return json({ mode: "razorpay", paymentId: id, ...hopOf(env), razorpay: { keyId: rzp.keyId, orderId: order.id, amount: toMinor(pr.total), currency: cur, name: brand.name, description: "(close group bingo software) | owned and made by IT Services by Rajat Agarwal", prefill: { email: b.email.trim(), name: payerName.slice(0, 80), ...(contact ? { contact } : {}) }, notes: { brand: brand.name, participants: String(pack) }, theme: { color: brand.theme }, ...(cur === "INR" ? { config: UPI_FIRST } : {}) } });
  }

  const ptm = p.match(/^\/api\/payments\/paytest\/(pay_[0-9a-f]{16})$/); // the test page asks while Razorpay is still confirming
  if (req.method === "GET" && ptm) {
    const row = await db.prepare("SELECT status, result, meta FROM payment WHERE id=?").bind(ptm[1]).first<any>();
    let m: any = {}; try { m = JSON.parse(row?.meta ?? "{}"); } catch { m = {}; }
    if (!row || !m.paytest) return json({ error: "Not found" }, 404);
    return row.status === "paid" ? json(JSON.parse(row.result)) : json({ confirming: true }, 202);
  }
  if (req.method === "POST" && p === "/api/payments/paytest") { // Payment Testing: Rs 1 from India, US$ 1 from abroad; buys nothing; anyone, any number of times
    if (!rzp || (await getMode(env)) === "TEST") return json({ error: "Online payments are not switched on." }, 503);
    const b = await body(req);
    if (!b || typeof b.email !== "string" || !EMAIL.test(b.email.trim())) return json({ error: "Enter a valid e-mail address." }, 400);
    const nm = typeof b.name === "string" ? b.name.trim() : ""; if (nm.length < 2) return json({ error: "Enter your name." }, 400);
    const cty = typeof b.country === "string" && /^[A-Z]{2}$/.test(b.country) ? b.country : "IN", cur = cty === "IN" ? "INR" : "USD";
    if (cur === "USD" && env.RAZORPAY_INTERNATIONAL !== "1") return json({ error: "Payments in US dollars are not switched on yet. Please try again later." }, 400);
    const dial = typeof b.phoneCode === "string" && /^\d{1,4}$/.test(b.phoneCode) ? b.phoneCode : "91", digits = typeof b.phone === "string" ? b.phone.replace(/\D/g, "").replace(/^0+/, "") : "";
    const contact = digits.length >= 6 && digits.length <= 14 ? `+${dial}${digits}` : "";
    if (!(await spend(2))) return busy();
    const id = "pay_" + randHex(8);
    let order: any;
    try { order = await placeOrder(env, rzp, { amountMinor: 100, currency: cur, receipt: id, plan: "payment_test", email: b.email.trim().toLowerCase(), notes: { brand: brand.name, site: env.PAY_SITE ?? "corporate-tic-tac-toe.pages.dev", stream: "sales", product: "corporate_tic_tac_toe", plan: "payment_test", variation: "payment_test", payment_ref: id } }); }
    catch (e: any) { return json({ error: `The payment service said: ${e.message}` }, 502); }
    const taxId = typeof b.taxId === "string" ? b.taxId.trim().toUpperCase().slice(0, 20) : "";
    if (cty === "IN" && taxId && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(taxId)) return json({ error: "That GSTIN does not look right. It has 15 characters, like 27ABCDE1234F1Z5." }, 400);
    const meta = { paytest: true, name: nm.slice(0, 120), ...(typeof b.org === "string" && b.org.trim() ? { org: b.org.trim().slice(0, 120) } : {}), ...(taxId ? { taxId } : {}), ...(contact ? { phone: contact } : {}), country: cty, origin: env.PUBLIC_ORIGIN ?? url.origin };
    const lf = ledgerFields(siteOf(meta.origin), "payment_test", "payment_test", null);
    await db.prepare("INSERT INTO payment(id,org,email,pack,currency,amount,tax,rzp_order_id,status,created_ms,meta,is_test,site,product,product_type,product_ref,payer_user) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)").bind(id, null, b.email.trim().toLowerCase(), 0, cur, 1, 0, order.id, "created", now, JSON.stringify(meta), lf.site, lf.product, lf.productType, lf.productRef, lf.payerUser).run();
    return json({ mode: "razorpay", paymentId: id, ...hopOf(env), razorpay: { keyId: rzp.keyId, orderId: order.id, amount: 100, currency: cur, name: brand.name, description: "(close group bingo software) | owned and made by IT Services by Rajat Agarwal", prefill: { email: b.email.trim(), name: nm.slice(0, 80), ...(contact ? { contact } : {}) }, notes: { brand: brand.name }, theme: { color: brand.theme }, ...(cur === "INR" ? { config: UPI_FIRST } : {}) } });
  }

  if (req.method === "POST" && p === "/api/payments/verify") {
    if (!rzp) return json({ error: "Online payments are not switched on." }, 400);
    const b = await body(req);
    const row = b && typeof b.paymentId === "string" ? await db.prepare("SELECT * FROM payment WHERE id=?").bind(b.paymentId).first<any>() : null;
    if (!row || row.rzp_order_id !== b.razorpay_order_id) return json({ error: "We could not match this payment." }, 404);
    if (row.status === "paid") return json(JSON.parse(row.result));
    if (!verifyPaymentSignature(rzp.keySecret, String(b.razorpay_order_id), String(b.razorpay_payment_id), String(b.razorpay_signature)))
      return json({ error: "The payment could not be verified. If money was taken it will be refunded." }, 400);
    // "Confirming your payment...": from the moment the buyer's browser reports a correctly signed payment until the gateway itself says the money arrived, the game shows that soft state. It is never Paid before the gateway confirms.
    const marked = row.eid && (await spend(1));
    if (marked) await db.prepare("UPDATE payment SET confirming_ms=? WHERE id=? AND status<>'paid'").bind(now, row.id).run();
    const unconfirm = async () => { if (marked) await db.prepare("UPDATE payment SET confirming_ms=NULL WHERE id=? AND status<>'paid'").bind(row.id).run(); };
    const pay = await fetchPayment(rzp, String(b.razorpay_payment_id)).catch(() => null);
    if (!pay || pay.order_id !== b.razorpay_order_id || Number(pay.amount) !== toMinor(row.amount)) { await unconfirm(); return json({ error: "The payment details did not match the order." }, 400); }
    if (pay.status === "created") { await db.prepare("UPDATE payment SET rzp_payment_id=COALESCE(rzp_payment_id,?) WHERE id=?").bind(String(b.razorpay_payment_id), row.id).run(); return json({ confirming: true, paid: false, message: "Confirming your payment..." }, 202); } // the page asks again in a few seconds; the gateway's webhook finishes it too
    if (pay.status === "authorized") await capturePayment(rzp, pay.id, toMinor(row.amount), row.currency).catch(() => null);
    else if (pay.status !== "captured") { await unconfirm(); return json({ error: `The payment is ${pay.status}. Nothing was charged to your order.` }, 402); }
    await db.prepare("UPDATE payment SET rzp_payment_id=? WHERE id=?").bind(String(b.razorpay_payment_id), row.id).run();
    await reportToCentral(env, b);
    const f = await fulfil(env, row.id, now, spend);
    return "result" in f ? json(f.result) : json({ error: f.error }, f.status);
  }

  if (req.method === "POST" && p === "/api/payments/webhook") {
    const raw = await req.text();
    const eventId = req.headers.get("x-razorpay-event-id");
    const hook = async (res: Response, outcome: string, f: Partial<HookRecord> = {}) => { await logWebhook(db, { now, eventId, signatureOk: true, outcome, status: res.status, ...f }); return res; }; // every webhook call leaves a row in webhook_log
    if (!rzp?.webhookSecret) return json({ error: "Webhook secret is not set." }, 503);
    if (raw.length > 100_000 || !verifyWebhookSignature(rzp.webhookSecret, raw, req.headers.get("x-razorpay-signature") ?? "")) return hook(json({ error: "Bad signature." }, 400), "bad signature", { signatureOk: false });
    let ev: any; try { ev = JSON.parse(raw); } catch { return hook(json({ error: "Bad body." }, 400), "bad body"); }
    const ent = ev?.payload?.payment?.entity, ord = ev?.payload?.order?.entity;
    const orderId = ent?.order_id ?? ord?.id;
    const seen: Partial<HookRecord> = { event: typeof ev?.event === "string" ? ev.event.slice(0, 60) : null, orderId: orderId ?? null, rzpPaymentId: ent?.id ?? null, amountMinor: Number.isFinite(Number(ent?.amount)) ? Number(ent.amount) : null };
    if (ev.event === "payment.authorized" && orderId) { // the gateway has the money but has not captured it yet: the buyer sees "Confirming your payment..." and nothing is marked Paid
      await db.prepare("UPDATE payment SET confirming_ms=? WHERE rzp_order_id=? AND status<>'paid'").bind(now, orderId).run();
      const pr = await db.prepare("SELECT id FROM payment WHERE rzp_order_id=?").bind(orderId).first<{ id: string }>();
      return hook(json({ ok: true, confirming: true }), "confirming", { ...seen, paymentId: pr?.id });
    }
    if (!["payment.captured", "order.paid"].includes(ev.event) || !orderId) return hook(json({ ok: true, ignored: ev.event }), "ignored: not a payment event", seen);
    const row = await db.prepare("SELECT * FROM payment WHERE rzp_order_id=?").bind(orderId).first<any>();
    if (!row) return hook(json({ ok: true, ignored: "unknown order" }), "ignored: unknown order", seen);
    if (Number(ent?.amount ?? toMinor(row.amount)) !== toMinor(row.amount)) return hook(json({ ok: true, ignored: "amount mismatch" }), "ignored: amount mismatch", { ...seen, paymentId: row.id }); // never fulfil an order that was paid a different amount
    if (ent?.id) await db.prepare("UPDATE payment SET rzp_payment_id=COALESCE(rzp_payment_id,?) WHERE id=?").bind(ent.id, row.id).run();
    const wasPaid = row.status === "paid";
    const f = await fulfil(env, row.id, now, spend);
    return "result" in f ? hook(json({ ok: true, fulfilled: row.id }), wasPaid ? "already paid (no change)" : "marked paid by webhook", { ...seen, paymentId: row.id }) : hook(json({ error: f.error }, f.status), `failed: ${f.error}`, { ...seen, paymentId: row.id });
  }

  const cm = p.match(/^\/api\/credit-note\/(cn_[0-9a-f]{32})$/); // the GST credit note issued with a refund
  if (req.method === "GET" && cm) {
    const r = await db.prepare("SELECT data FROM credit_note WHERE token=?").bind(cm[1]).first<{ data: string }>();
    return r ? new Response(renderInvoiceHtml(JSON.parse(r.data)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } }) : json({ error: "Not found" }, 404);
  }
  // The PROFORMA invoice (same template as the invoice, "NOT PAID"): shown before payment, with a Pay now button on the page. Nothing is stored and no invoice number is used up.
  if (req.method === "POST" && p === "/api/proforma") {
    const b = await body(req); if (!b) return json({ error: "Bad request." }, 400);
    const presented = (req.headers.get("x-organizer") ?? "").trim();
    let eid: string | null = null;
    if (typeof b.link === "string") { const pv = await lookupPayLink(db, b.link, now); if (!pv || pv.status !== "open") return json({ error: "Not found" }, 404); eid = pv.e.id; }
    else if (presented && typeof b.eid === "string") {
      const k = await db.prepare("SELECT org, kind, eid FROM organizer_key WHERE hash=? AND revoked=0 AND (expires_ms IS NULL OR expires_ms>?)").bind(await sha("key|" + presented), now).first<{ org: string; kind: string; eid: string | null }>();
      const eg = k && (k.kind in PAYER) ? await db.prepare("SELECT org FROM engagement WHERE id=?").bind(b.eid).first<{ org: string | null }>() : null;
      if (!k || !eg || eg.org !== k.org || (k.kind === "cohost" && k.eid && k.eid !== b.eid)) return json({ error: "Please sign in again." }, 403);
      eid = b.eid;
    }
    if (!eid) return json({ error: "Not found" }, 404);
    const g = await db.prepare("SELECT cap, pack, config, start_round FROM engagement WHERE id=?").bind(eid).first<{ cap: number; pack: number | null; config: string | null; start_round: number }>();
    if (!g || g.pack !== 0) return json({ error: "This game is not waiting for payment." }, 409);
    const pack = PACKS.find((x) => x[0] >= g.cap)?.[0]; if (!pack) return json({ error: "That many participants needs a custom arrangement. Please write to us." }, 400);
    const cur = b.currency === "USD" ? "USD" : "INR", co = company(env), fy = financialYear(new Date(now));
    const credited = Math.round((await creditAppliedFor(db, eid)) * 100) / 100, total = Math.max(0, Math.round((price(pack, cur).total - credited) * 100) / 100);
    const tax = splitGst(total, cur, co.stateCode, typeof b.taxId === "string" && b.taxId.trim() ? b.taxId.trim().toUpperCase() : undefined);
    let gameName: string | undefined; try { const c = g.config ? JSON.parse(g.config) : {}; if (typeof c.name === "string" && c.name) gameName = c.name.slice(0, 120); } catch { /* the id is the name */ }
    const s = (x: unknown, n: number) => (typeof x === "string" ? x.trim().slice(0, n) : "");
    const data: InvoiceData = { kind: "proforma", number: `PF-${fy}-${eid}`.slice(0, 60), issuedAt: now, brand, company: co, draft: false, currency: cur,
      buyer: { name: s(b.org, 120) || s(b.name, 120) || "(your name)", gstin: s(b.taxId, 20) || undefined, email: s(b.email, 120) || undefined, phone: s(b.phone, 20) || undefined, country: s(b.country, 2) || undefined },
      lines: [{ description: `${brand.name}: up to ${pack} participants (one engagement)${credited > 0 ? ", balance after credit" : ""}`, quantity: 1, amount: tax.taxable }], tax, orderRef: eid,
      game: { id: eid, name: gameName, startMs: (1692803367 + (g.start_round - 1) * 3) * 1000 }, organizer: { name: s(b.name, 120) || undefined, org: s(b.org, 120) || undefined, email: s(b.email, 120) || undefined },
      note: "This is a proforma invoice. It is NOT PAID and is not a tax invoice. Pay now to receive your invoice, and the same invoice is e-mailed to you and to the organizer." };
    const full = renderInvoiceHtml(data), style = full.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? "";
    const html = style + full.replace(/^[\s\S]*?<\/head>\s*(<body[^>]*>)?/i, "").replace(/<\/body>\s*<\/html>\s*$/i, "");
    return json({ ok: true, number: data.number, total, currency: cur, html });
  }
  // The invoice shown on the payment-done screen: the invoice markup alone (drawn inside a shadow root by the page), a real PDF to download, and "e-mail it to me".
  const ix = p.match(/^\/api\/invoice\/(inv_[0-9a-f]{32})(\.fragment|\.pdf|\/email)$/);
  if (ix) {
    const r = await db.prepare("SELECT data, number FROM invoice WHERE token=?").bind(ix[1]).first<{ data: string; number: string }>();
    if (!r) return json({ error: "Not found" }, 404);
    const data: InvoiceData = JSON.parse(r.data);
    const origin = env.PUBLIC_ORIGIN ?? url.origin;
    if (req.method === "GET" && ix[2] === ".fragment") {
      const full = renderInvoiceHtml(data), style = full.match(/<style>[\s\S]*?<\/style>/)?.[0] ?? "";
      const body = full.replace(/^[\s\S]*?<\/head>\s*(<body[^>]*>)?/i, "").replace(/<\/body>\s*<\/html>\s*$/i, "");
      return new Response(style + body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
    }
    if (req.method === "GET" && ix[2] === ".pdf") {
      const pdf = new PdfDoc(); pdf.footer = `${data.brand.name} · ${r.number}`;
      pdf.para(data.brand.name, { font: "F2", size: 18, color: NAVY }); pdf.gap(8);
      for (const line of renderInvoiceText(data).split("\n").slice(1)) { if (line.trim()) pdf.para(line, { size: 10 }); else pdf.gap(7); }
      return new Response(pdf.build() as unknown as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="invoice-${r.number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`, "cache-control": "no-store", "x-robots-tag": "noindex" } });
    }
    if (req.method === "POST" && ix[2] === "/email") {
      const b = await body(req); const to = b && typeof b.to === "string" ? b.to.trim().toLowerCase() : "";
      if (!EMAIL.test(to)) return json({ error: "Enter a valid e-mail address." }, 400);
      const k = `invmail/${ix[1]}`, used = Number((await db.prepare("SELECT v FROM kv WHERE k=?").bind(k).first<{ v: string }>())?.v ?? 0);
      if (used >= 5) return json({ error: "This invoice has already been e-mailed 5 times." }, 429);
      if (!(await spend(1))) return busy();
      await db.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").bind(k, String(used + 1)).run();
      await sendMail(env, db, to, `${data.brand.name}: invoice ${r.number}`, `Your invoice.\n\nINVOICE\n${renderInvoiceText(data)}\n\nView or print it: ${origin}/api/invoice/${ix[1]}\nDownload the PDF: ${origin}/api/invoice/${ix[1]}.pdf`, now);
      return json({ ok: true });
    }
  }
  const im = p.match(/^\/api\/invoice\/(inv_[0-9a-f]{32})$/);
  if (req.method === "GET" && im) {
    const r = await db.prepare("SELECT data FROM invoice WHERE token=?").bind(im[1]).first<{ data: string }>();
    return r ? new Response(renderInvoiceHtml(JSON.parse(r.data)), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } }) : json({ error: "Not found" }, 404);
  }
  return null;
}
