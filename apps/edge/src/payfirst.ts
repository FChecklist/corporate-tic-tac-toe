// The Razorpay-first payment flow (owner order 2 Nov 2026), the small pure parts, the same in all six games.
//   BEFORE paying the payer chooses nothing but the country (it decides the currency); no name, e-mail, mobile, company or GST box.
//   Razorpay Checkout asks for the mobile and e-mail itself and checks them; the Worker takes both back from Razorpay when the payment is captured.
//   AFTER paying the payer may add a name, a company and a GST / Tax ID to the invoice, or skip. The tax invoice is issued when they send or skip, or by itself 15 minutes after capture.
// The routes and the fulfilment live in pay.ts (they need its helpers); everything that can be written without them is here.
import type { D1 } from "./worker";

/** What a payment's e-mail holds between the order and the capture: nobody's address, and never the same for two payments (so no two payers can ever be taken for one organizer). */
const PENDING_DOMAIN = "payer.invalid";
export const pendingEmail = (paymentId: string): string => `${paymentId}@${PENDING_DOMAIN}`;
export const isPendingEmail = (e: unknown): boolean => typeof e === "string" && e.toLowerCase().endsWith("@" + PENDING_DOMAIN);

/** A tax invoice is issued by itself this long after the capture when the payer closed the page without sending or skipping. */
export const INVOICE_AFTER_MS = 15 * 60_000;

/** The public Rs 1 test has no key any more, so each visitor (by network address) gets a small allowance of orders: this many an hour and this many a day. */
export const PAYTEST_PER_HOUR = 5, PAYTEST_PER_DAY = 20;

/** Every field of the payment form is a constant here, so a later change of the rules is one line (boss note, 2 Nov 2026). */
export const PAY_RULES = {
  /** a GST / Tax ID needs the business name on the invoice */
  taxIdNeedsCompany: true,
  /** longest text kept for the name, the company and the Tax ID */
  maxName: 120, maxTaxId: 20,
} as const;
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const GSTIN_MSG = "That GSTIN does not look right. It has 15 characters, like 27ABCDE1234F1Z5.";
export const COMPANY_MSG = "Please add your company name. A GST invoice needs the business name.";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The visitor's country as Cloudflare tells it (request.cf.country, else the CF-IPCountry header). null = cannot be told: no header, Tor ("T1"), unknown ("XX"). It is only ever the DEFAULT the page starts from. */
export function visitorCountry(req: Request): string | null {
  const c = String((req as unknown as { cf?: { country?: string } }).cf?.country || req.headers.get("cf-ipcountry") || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null;
}
/** India pays in rupees with GST; every other country pays in US dollars, with no Indian GST. */
export const currencyForCountry = (country: string): "INR" | "USD" => (country === "IN" ? "INR" : "USD");
/** The country the payer chose (the explicit choice always wins over the header). null = the body names none: older callers send only `currency`. */
export function chosenCountry(b: any): string | null { const c = str(b?.country).toUpperCase(); return /^[A-Z]{2}$/.test(c) ? c : null; }
/** A Razorpay-first order (no name or e-mail yet) is charged in the money of the country the payer chose. An older caller that sends a name or an e-mail keeps its own `currency` field, as before (there `country` is only the billing country). */
export function orderCurrency(b: any): "INR" | "USD" { const c = chosenCountry(b); return c && isPayFirst(b) ? currencyForCountry(c) : b?.currency === "USD" ? "USD" : "INR"; }

/** A Razorpay-first order carries no name, e-mail or company (an older caller that still sends them is served exactly as before). */
export const isPayFirst = (b: any): boolean => !str(b?.email) && !str(b?.name) && !str(b?.org);

/** The optional details after payment. Returns the clean details or the plain-words reason they cannot be used. */
export function cleanInvoiceDetails(b: any, country: string): { ok: true; name: string; org: string; taxId: string } | { ok: false; error: string } {
  const name = str(b?.name).slice(0, PAY_RULES.maxName), org = str(b?.org).slice(0, PAY_RULES.maxName), taxId = str(b?.taxId).toUpperCase().slice(0, PAY_RULES.maxTaxId);
  if (taxId && country === "IN" && !GSTIN_RE.test(taxId)) return { ok: false, error: GSTIN_MSG };
  if (taxId && !org && PAY_RULES.taxIdNeedsCompany) return { ok: false, error: COMPANY_MSG };
  return { ok: true, name, org, taxId };
}

const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const stamp = (now: number) => new Date(now).toISOString().replace(/[-:T]/g, "").slice(0, 10); // yyyymmddhh

/** One more test order for this visitor: true = allowed, false = over the hourly or the daily allowance (nothing is counted then). Keyed by network address, never by e-mail. */
export async function paytestAllowed(db: D1, req: Request, now: number): Promise<boolean> {
  try {
    const who = (await sha("ip|" + (req.headers.get("cf-connecting-ip") ?? "local"))).slice(0, 16), h = stamp(now), d = h.slice(0, 8);
    const kh = `ptl/h/${h}/${who}`, kd = `ptl/d/${d}/${who}`;
    const get = async (k: string) => Number((await db.prepare("SELECT v FROM kv WHERE k=?").bind(k).first<{ v: string }>())?.v ?? 0);
    const [nh, nd] = [await get(kh), await get(kd)];
    if (nh >= PAYTEST_PER_HOUR || nd >= PAYTEST_PER_DAY) return false;
    for (const [k, n] of [[kh, nh], [kd, nd]] as const) await db.prepare("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(k, String(n + 1)).run();
    return true;
  } catch { return true; /* a broken counter never blocks a payment test: the daily write budget still stands */ }
}
/** Forgets the counters of earlier days (run by the scheduled tick). */
export async function purgePaytestCounters(db: D1, now: number): Promise<void> {
  try {
    const old = stamp(now - 2 * 86_400_000);
    await db.prepare("DELETE FROM kv WHERE (k>='ptl/h/' AND k<?) OR (k>='ptl/d/' AND k<?)").bind(`ptl/h/${old}`, `ptl/d/${old.slice(0, 8)}`).run();
  } catch { /* the next tick tries again */ }
}
