/**
 * Shared billing.
 *   - one Razorpay account; the seller on a receipt is "IT Services by Rajat Agarwal" (shown only at payment and on the receipt)
 *   - the BRAND is what the customer sees: invoice title, invoice number series
 *   - GST is OFF (the seller is not registered): invoices carry no tax lines. GST_ENABLED is the one switch; when it is true the same code issues GST invoices as before.
 * Pure functions + a thin Razorpay REST client (public API: https://razorpay.com/docs/api/). No secrets are stored here.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------- brands
export type BrandId = "corporate_tic_tac_toe" | "dpdp" | "projexa" | "dewberry";
export interface Brand {
  id: BrandId;
  name: string; // shown on checkout and as the invoice title
  domain: string;
  invoicePrefix: string; // numbering series, per brand per financial year
  theme: string; // checkout colour
  line: string; // one-line description on the invoice
}
export const BRANDS: Record<BrandId, Brand> = {
  corporate_tic_tac_toe: { id: "corporate_tic_tac_toe", name: "Corporate Tic Tac Toe", domain: "corporate-tic-tac-toe.example", invoicePrefix: "CB", theme: "#0B5D5B", line: "Live game software" },
  dpdp: { id: "dpdp", name: "dpdp.VERIDIAN-AIOS.COM", domain: "dpdp.veridian-aios.com", invoicePrefix: "DPDP", theme: "#0E7C6E", line: "Data protection compliance software" },
  projexa: { id: "projexa", name: "projexa-ai.com", domain: "projexa-ai.com", invoicePrefix: "PXA", theme: "#1C2B3A", line: "Project management software" },
  dewberry: { id: "dewberry", name: "dewberry.in", domain: "dewberry.in", invoicePrefix: "DEW", theme: "#5B3A8C", line: "Software solutions" },
};
export const brandOf = (id: string): Brand => BRANDS[id as BrandId] ?? BRANDS.corporate_tic_tac_toe;

// ---------------------------------------------------------------- legal entity (filled from config/company.json, never guessed)
/** The seller is not registered for GST (owner, 2026-10-09). Set to true only after registering; then a GSTIN, state code and SAC code must be filled in company.json / COMPANY_JSON. */
export const GST_ENABLED = false;
export interface Company {
  legalName: string; cin: string; pan: string; gstin: string; stateCode: string; stateName: string;
  addressLines: string[]; email: string; phone: string; sacCode: string; sacDescription: string;
  bank: { name: string; accountNumber: string; ifsc: string }; invoiceFooter: string;
}
export const DEFAULT_COMPANY: Company = {
  legalName: "IT Services by Rajat Agarwal", cin: "", pan: "", gstin: "", stateCode: "", stateName: "", addressLines: [], email: "rajatsiroffice@gmail.com", phone: "(+91) 96503 97480",
  sacCode: "", sacDescription: "Software solutions and products", bank: { name: "", accountNumber: "", ifsc: "" }, invoiceFooter: "This is a computer generated invoice. GST is not charged.",
};
/** Which required details are still missing (a real tax invoice needs these). */
export function companyGaps(c: Company, gstOn: boolean = GST_ENABLED): string[] {
  const g: string[] = [];
  if (!gstOn) return g; // no GST: nothing else is needed on a receipt
  if (!c.gstin) g.push("GSTIN"); if (!c.stateCode) g.push("state code"); if (!c.addressLines.length) g.push("registered address"); if (!c.sacCode) g.push("SAC code");
  return g;
}

// ---------------------------------------------------------------- GST
export const GST_RATE = 0.18;
const r2 = (x: number) => Math.round(x * 100) / 100;
export interface TaxSplit { taxable: number; cgst: number; sgst: number; igst: number; total: number; mode: "intra" | "inter" | "export" | "none"; placeOfSupply: string }
/** Price is GST-inclusive for INR. Same state => CGST+SGST, different state => IGST. USD (export of services) => no GST here (CA to confirm LUT). */
export function splitGst(totalInclusive: number, currency: "INR" | "USD", supplierState: string, buyerGstin: string | undefined, gstOn: boolean = GST_ENABLED): TaxSplit {
  if (!gstOn) return { taxable: totalInclusive, cgst: 0, sgst: 0, igst: 0, total: totalInclusive, mode: "none", placeOfSupply: "" }; // not registered: the price is the whole amount
  if (currency === "USD") return { taxable: totalInclusive, cgst: 0, sgst: 0, igst: 0, total: totalInclusive, mode: "export", placeOfSupply: "Outside India" };
  const taxable = r2(totalInclusive / (1 + GST_RATE));
  const tax = r2(totalInclusive - taxable);
  const buyerState = buyerGstin && /^\d{2}/.test(buyerGstin) ? buyerGstin.slice(0, 2) : "";
  const intra = !!supplierState && !!buyerState && supplierState === buyerState;
  if (intra) { const half = r2(tax / 2); return { taxable, cgst: half, sgst: r2(tax - half), igst: 0, total: totalInclusive, mode: "intra", placeOfSupply: buyerState }; }
  return { taxable, cgst: 0, sgst: 0, igst: tax, total: totalInclusive, mode: "inter", placeOfSupply: buyerState || "unknown" };
}

// ---------------------------------------------------------------- invoice numbers: brand-wise, per Indian financial year (Apr-Mar)
export function financialYear(d: Date): string {
  // The Indian financial year starts on 1 April IST (00:00 IST = 18:30 UTC the day before): working it out from the UTC clock gave the OLD year's invoice number to a payment made between 00:00 and 05:30 IST on 1 April (found by the 20-game rehearsal, G10/G13)
  const ist = new Date(d.getTime() + 19_800_000);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth();
  const start = m >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
export const formatInvoiceNumber = (brand: Brand, fy: string, seq: number) => `${brand.invoicePrefix}/${fy}/${String(seq).padStart(6, "0")}`;

// ---------------------------------------------------------------- invoice
export interface InvoiceData {
  number: string; issuedAt: number; brand: Brand; company: Company; draft: boolean;
  buyer: { name: string; gstin?: string; email?: string; phone?: string; country?: string };
  currency: "INR" | "USD"; lines: { description: string; quantity: number; amount: number }[]; tax: TaxSplit; paymentRef?: string; orderRef?: string;
  /** "credit_note" = a GST credit note for a refund (same layout, own number series, names the invoice it reduces). Default: a tax invoice. */
  kind?: "invoice" | "credit_note" | "proforma"; originalNumber?: string;
  /** A plain sentence printed under the totals (e.g. "Paid from credit of invoice ..."). */
  note?: string;
  /** The moment the payment was captured (the invoice itself is issued at issuedAt). Printed in IST. */
  paidAtMs?: number;
  /** What was paid for. */
  game?: { id: string; name?: string; startMs?: number };
  /** The organizer of the game (may be a different person from the payer when a Host or Co-host paid). */
  organizer?: { name?: string; email?: string; phone?: string; org?: string };
  /** What Razorpay reported for this payment (see paymentInfo). */
  pay?: PaymentInfo;
}

/** The part of Razorpay's payment record that is printed on the invoice. Never holds a full card number or a full UPI id. */
export interface PaymentInfo {
  paymentId?: string; orderId?: string; status?: string; method?: string; methodLabel?: string; detail?: string; bank?: string; wallet?: string; network?: string;
  international?: boolean; email?: string; contact?: string; currency?: string; amountMinor?: number; createdAtMs?: number; rrn?: string; authCode?: string; upiTxnId?: string;
}
const maskVpa = (v: string) => { const [u, h] = String(v).split("@"); return h ? `${(u ?? "").slice(0, 2)}${"*".repeat(Math.max(2, (u ?? "").length - 2))}@${h}` : "****"; };
/** Turns Razorpay's payment entity (GET /payments/:id) into the printable summary. Unknown fields are simply left out. */
export function paymentInfo(raw: any): PaymentInfo {
  if (!raw || typeof raw !== "object") return {};
  const m = String(raw.method ?? "");
  const lab: Record<string, string> = { upi: "UPI", card: "Card", netbanking: "Net banking", wallet: "Wallet", emi: "EMI", paylater: "Pay later", bank_transfer: "Bank transfer" };
  let detail = "";
  if (m === "upi") detail = raw.vpa ? `UPI ID ${maskVpa(raw.vpa)}` : "UPI";
  else if (m === "card" && raw.card) detail = `${raw.card.network ?? ""} ${raw.card.type ?? ""} card ending ${raw.card.last4 ?? "****"}`.replace(/\s+/g, " ").trim();
  else if (m === "netbanking") detail = raw.bank ? `Bank ${raw.bank}` : "";
  else if (m === "wallet") detail = raw.wallet ? `Wallet ${raw.wallet}` : "";
  const acq = raw.acquirer_data ?? {};
  return {
    paymentId: raw.id, orderId: raw.order_id, status: raw.status, method: m, methodLabel: lab[m] ?? (m || undefined), detail: detail || undefined, bank: raw.bank ?? undefined, wallet: raw.wallet ?? undefined,
    network: raw.card?.network ?? undefined, international: raw.international === true ? true : undefined, email: raw.email, contact: raw.contact, currency: raw.currency, amountMinor: typeof raw.amount === "number" ? raw.amount : undefined,
    createdAtMs: typeof raw.created_at === "number" ? raw.created_at * 1000 : undefined, rrn: acq.rrn ?? undefined, authCode: acq.auth_code ?? undefined, upiTxnId: acq.upi_transaction_id ?? undefined,
  };
}
/** "10 Oct 2026, 14:32:07 IST" for any instant. */
export const istStamp = (ms: number) => new Date(ms + 19_800_000).toLocaleString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) + " IST";

/** The text kept on every invoice (product rule 2026-10-10). */
export const INVOICE_KEEP_NOTE = "The details on this invoice (including the payer's, the organizer's and the payment details reported by Razorpay) are kept for invoice, tax and accounting purposes only, as the law requires, and are not used for anything else.";
/** Page 2 of every invoice. Kept in step with the Terms page of the service (no refunds; cancelled paid game becomes credit). */
export const INVOICE_TERMS: string[] = [
  "This invoice is issued by IT Services by Rajat Agarwal for the service named on page 1. Online payments are processed by Razorpay.",
  "We do not give refunds. If a paid game is cancelled before it starts, the payment stays as credit on the organizer's account and can be used for another game. Credit lapses 365 days after the payment date. No credit note is raised for credit that lapses.",
  "A payment buys one game for up to the number of participants named on the invoice. Participants never pay; rewards are given by the organizer. Unused places are not credited once the game has started.",
  "Prices are in the currency shown. Payments from India are in Indian rupees (INR); payments from outside India are in US dollars (USD). Bank, card and currency-conversion charges of the payer's own bank are the payer's own.",
  "Where GST applies it is shown on page 1. Where it is not charged, the invoice says so. The payer is responsible for any withholding tax, VAT or duty that applies in the payer's own country.",
  "The organizer is responsible for the rewards, the participants' consent and the conduct of the game. The service runs the game software and does not take part in the draw of rewards.",
  "Invoice, payment, payer and organizer details are kept for invoice, tax and accounting purposes, for as long as the law requires. All other game data is deleted as described in the Privacy page.",
  "Disputes are handled first by e-mail to the seller at the address on page 1. Indian law applies and the courts of the seller's place of business have jurisdiction, unless the payer's own consumer law says otherwise.",
  "This is a computer generated invoice. It needs no signature.",
];
const titleOf = (i: InvoiceData) => (i.kind === "credit_note" ? "CREDIT NOTE" : i.kind === "proforma" ? "PROFORMA INVOICE (NOT PAID)" : i.tax.mode === "none" ? "INVOICE" : "TAX INVOICE");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (n: number, cur: string) => (cur === "INR" ? "₹" : "US$") + n.toLocaleString(cur === "INR" ? "en-IN" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderInvoiceText(i: InvoiceData): string {
  const c = i.company, t = i.tax;
  const rows = i.lines.map((l) => `  ${l.description} x ${l.quantity}: ${money(l.amount, i.currency)}`).join("\n");
  return `${i.draft ? "DRAFT - " : ""}${titleOf(i)}
${i.brand.name}
${t.mode === "none" ? `Seller: ${c.legalName}${c.email ? `\n${c.email}` : ""}${c.phone ? `  ${c.phone}` : ""}` : `A product of ${c.legalName}\n${c.addressLines.join(", ")}${c.gstin ? `\nGSTIN: ${c.gstin}` : ""}${c.cin ? `  CIN: ${c.cin}` : ""}${c.pan ? `  PAN: ${c.pan}` : ""}`}

${i.kind === "credit_note" ? "Credit note number" : i.kind === "proforma" ? "Proforma number" : "Invoice number"}: ${i.number}${i.originalNumber ? `
Against invoice: ${i.originalNumber}` : ""}
Issued: ${istStamp(i.issuedAt)}${i.paidAtMs ? `
Paid on: ${istStamp(i.paidAtMs)}` : ""}
${i.game ? `Paid for: ${i.game.name ? `${i.game.name} (${i.game.id})` : i.game.id}
` : ""}Billed to: ${i.buyer.name}${i.buyer.gstin ? `  GSTIN: ${i.buyer.gstin}` : ""}${i.buyer.phone ? `  Mobile: ${i.buyer.phone}` : ""}

${rows}
${t.mode === "none" ? "" : `  Taxable value: ${money(t.taxable, i.currency)}\n`}${t.mode === "none" ? "" : t.mode === "intra" ? `  CGST 9%: ${money(t.cgst, i.currency)}\n  SGST 9%: ${money(t.sgst, i.currency)}` : t.mode === "inter" ? `  IGST 18%: ${money(t.igst, i.currency)}` : "  GST: not charged (export of services)"}
  TOTAL: ${money(t.total, i.currency)}
${i.paymentRef || i.pay ? `Paid via Razorpay${i.pay?.methodLabel ? ` (${i.pay.methodLabel}${i.pay.detail ? `, ${i.pay.detail}` : ""})` : ""}, payment ${i.pay?.paymentId ?? i.paymentRef}${i.pay?.orderId ? `, order ${i.pay.orderId}` : ""}` : ""}${i.organizer && (i.organizer.name || i.organizer.email || i.organizer.phone) ? `
Organizer: ${[i.organizer.name, i.organizer.email, i.organizer.phone].filter(Boolean).join(", ")}` : ""}
${INVOICE_KEEP_NOTE}${i.note ? `
${i.note}` : ""}
${c.sacCode && t.mode !== "none" ? `SAC ${c.sacCode} - ${c.sacDescription}` : c.sacDescription}
${c.invoiceFooter}`;
}

/** Page-1 blocks added 2026-10-10: what was paid for, when (IST), how, the payer, the organizer and Razorpay's own record. */
function renderDetailsHtml(i: InvoiceData): string {
  const rows = (kv: [string, unknown][]) => `<table class="kv">${kv.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
  const pi = i.pay, paid = i.paidAtMs;
  const out: string[] = [];
  out.push(`<div class="meta"><div class="box"><b>${i.kind === "proforma" ? "To be paid for" : "Paid for"}</b>${rows([["Game", i.game ? (i.game.name ? `${i.game.name} (${i.game.id})` : i.game.id) : undefined], ["Game starts", i.game?.startMs ? istStamp(i.game.startMs) : undefined], ["Service", i.lines[0]?.description]])}</div>
<div class="box"><b>${i.kind === "proforma" ? "Payment status" : "Paid on / via"}</b>${i.kind === "proforma" ? rows([["Status", "NOT PAID"], ["Amount to pay", money(i.tax.total, i.currency)], ["Pay with", "Razorpay: UPI, cards, net banking"]]) : rows([["Paid on (IST)", paid ? istStamp(paid) : undefined], ["Paid via", pi?.methodLabel ? `Razorpay: ${pi.methodLabel}` : i.paymentRef ? "Razorpay" : undefined], ["Payment details", pi?.detail], ["Amount paid", money(i.tax.total, i.currency)]])}</div></div>`);
  out.push(`<div class="meta"><div class="box"><b>${i.kind === "proforma" ? "Payer (to pay)" : "Payer (paid by)"}</b>${rows([["Name", i.buyer.name], ["E-mail", i.buyer.email], ["Mobile", i.buyer.phone], ["Country", i.buyer.country], ["Tax ID", i.buyer.gstin]])}</div>
<div class="box"><b>Organizer</b>${rows([["Name", i.organizer?.name], ["Organization", i.organizer?.org], ["E-mail", i.organizer?.email], ["Mobile", i.organizer?.phone]])}</div></div>`);
  if (pi || i.paymentRef || i.orderRef) out.push(`<div class="box" style="margin-top:14px"><b>Payment record from Razorpay</b>${rows([["Razorpay payment ID", pi?.paymentId ?? i.paymentRef], ["Razorpay order ID", pi?.orderId], ["Our reference", i.orderRef], ["Status", pi?.status], ["Method", pi?.methodLabel], ["Details", pi?.detail], ["Card network", pi?.network], ["International card", pi?.international ? "Yes" : undefined], ["Currency / amount", pi?.currency && pi.amountMinor !== undefined ? `${pi.currency} ${(pi.amountMinor / 100).toFixed(2)}` : undefined], ["Razorpay time (IST)", pi?.createdAtMs ? istStamp(pi.createdAtMs) : undefined], ["Bank reference (RRN)", pi?.rrn], ["UPI transaction ID", pi?.upiTxnId], ["Authorisation code", pi?.authCode], ["E-mail given to Razorpay", pi?.email], ["Mobile given to Razorpay", pi?.contact]])}</div>`);
  return out.join("");
}

export function renderInvoiceHtml(i: InvoiceData): string {
  const c = i.company, t = i.tax, b = i.brand;
  const taxRows = t.mode === "intra"
    ? `<tr><td>CGST 9%</td><td class="r">${money(t.cgst, i.currency)}</td></tr><tr><td>SGST 9%</td><td class="r">${money(t.sgst, i.currency)}</td></tr>`
    : t.mode === "inter" ? `<tr><td>IGST 18%</td><td class="r">${money(t.igst, i.currency)}</td></tr>` : `<tr><td>GST</td><td class="r">Not charged (export of services)</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.name)} invoice ${esc(i.number)}</title>
<style>body{font:15px/1.5 Inter,system-ui,sans-serif;color:#1c1a18;margin:0;background:#EEF5F4}.sheet{max-width:780px;margin:24px auto;background:#fff;padding:36px;border-radius:12px;box-shadow:0 2px 14px #0002}
h1{font:700 26px/1.1 Georgia,serif;margin:0;color:${esc(b.theme)};letter-spacing:.02em}.sub{color:#5C6F6D;font-size:13px}.top{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;border-bottom:3px solid ${esc(b.theme)};padding-bottom:16px}
.draft{background:#fff3cd;border:1px solid #e0c36a;padding:8px 12px;border-radius:8px;margin:12px 0;font-size:13px}table{width:100%;border-collapse:collapse;margin-top:18px}td,th{padding:9px 6px;border-bottom:1px solid #D5E3E1;text-align:left}th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#5C6F6D}.r{text-align:right}tfoot td{font-weight:700;border-bottom:0}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:18px}.foot{margin-top:22px;font-size:12px;color:#5C6F6D}.box{border:1px solid #D5E3E1;border-radius:8px;padding:10px 12px;font-size:13px}.box b{display:block;margin-bottom:2px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#5C6F6D}.kv{width:100%;margin-top:6px}.kv td{padding:3px 6px;border-bottom:1px dotted #D5E3E1;font-size:13px}.kv td:first-child{color:#5C6F6D;width:38%}.terms ol{padding-left:20px}.terms li{margin:8px 0;font-size:13px}@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;border-radius:0}.terms{page-break-before:always;break-before:page}}@media(max-width:560px){.meta{grid-template-columns:1fr}}</style></head><body><div class="sheet">
<div class="top"><div><h1>${esc(b.name)}</h1><div class="sub">${esc(b.line)}${t.mode === "none" ? "" : `<br>A product of <b>${esc(c.legalName)}</b>`}</div></div><div class="sub r" style="text-align:right"><b>${titleOf(i)}</b><br>${esc(i.number)}${i.originalNumber ? `<br>Against invoice ${esc(i.originalNumber)}` : ""}<br>Issued ${esc(istStamp(i.issuedAt))}</div></div>
${i.draft ? `<div class="draft">${t.mode === "none" ? "DRAFT (test payment)." : "DRAFT: the supplier's registration details are not complete yet, so this is not yet a valid tax invoice."}</div>` : ""}
<div class="meta"><div><b>Supplier</b><br>${esc(c.legalName)}${t.mode === "none" ? `${c.email ? `<br>${esc(c.email)}` : ""}${c.phone ? `<br>${esc(c.phone)}` : ""}` : ""}<br>${c.addressLines.map(esc).join("<br>")}${c.gstin ? `<br>GSTIN: ${esc(c.gstin)}` : ""}${c.cin ? `<br>CIN: ${esc(c.cin)}` : ""}${c.pan ? `<br>PAN: ${esc(c.pan)}` : ""}</div>
<div><b>Billed to</b><br>${esc(i.buyer.name)}${i.buyer.gstin ? `<br>GSTIN: ${esc(i.buyer.gstin)}` : ""}${i.buyer.email ? `<br>${esc(i.buyer.email)}` : ""}${i.buyer.phone ? `<br>${esc(i.buyer.phone)}` : ""}${t.mode === "none" ? "" : `<br>Place of supply: ${esc(t.placeOfSupply)}`}</div></div>
${renderDetailsHtml(i)}
<table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead><tbody>${i.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${l.quantity}</td><td class="r">${money(l.amount, i.currency)}</td></tr>`).join("")}</tbody>
<tfoot>${t.mode === "none" ? "" : `<tr><td colspan="2">Taxable value</td><td class="r">${money(t.taxable, i.currency)}</td></tr>`}${t.mode === "none" ? "" : taxRows.replace(/<tr><td>/g, '<tr><td colspan="2">').replace(/<td class="r">/g, '<td class="r">')}<tr><td colspan="2">TOTAL</td><td class="r">${money(t.total, i.currency)}</td></tr></tfoot></table>
<div class="foot">${i.pay || !i.paymentRef ? "" : `Paid online via Razorpay. Payment reference: ${esc(i.paymentRef)}.<br>`}${i.note ? `${esc(i.note)}<br>` : ""}${c.sacCode && t.mode !== "none" ? `SAC ${esc(c.sacCode)}: ` : ""}${esc(c.sacDescription)}.${c.bank.accountNumber ? `<br>Bank: ${esc(c.bank.name)}, A/c ${esc(c.bank.accountNumber)}, IFSC ${esc(c.bank.ifsc)}` : ""}<br>${esc(c.invoiceFooter)}<br><b>${esc(INVOICE_KEEP_NOTE)}</b></div></div>
<div class="sheet terms"><h2>Terms and conditions</h2><div class="sub">${esc(b.name)} · ${titleOf(i)} ${esc(i.number)}</div><ol>${INVOICE_TERMS.map((x) => `<li>${esc(x)}</li>`).join("")}</ol><div class="foot">Seller: ${esc(c.legalName)}${c.email ? ` · ${esc(c.email)}` : ""}${c.phone ? ` · ${esc(c.phone)}` : ""}</div></div></body></html>`;
}

// ---------------------------------------------------------------- Razorpay (public REST API)
export interface RazorpayConfig { keyId: string; keySecret: string; webhookSecret?: string; baseUrl?: string }
const basic = (c: RazorpayConfig) => "Basic " + Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64");
const base = (c: RazorpayConfig) => c.baseUrl ?? "https://api.razorpay.com/v1";

export interface CreatedOrder { id: string; amount: number; currency: string; receipt: string; status: string }
/** Amount is in the currency's smallest unit (paise). Notes carry the brand so every payment in the dashboard shows which product it was for. */
export async function createOrder(cfg: RazorpayConfig, o: { amountMinor: number; currency: "INR" | "USD"; receipt: string; notes: Record<string, string> }): Promise<CreatedOrder> {
  const r = await fetch(`${base(cfg)}/orders`, { method: "POST", headers: { authorization: basic(cfg), "content-type": "application/json" }, body: JSON.stringify({ amount: o.amountMinor, currency: o.currency, receipt: o.receipt.slice(0, 40), notes: o.notes }) });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.description ?? `Razorpay refused the order (${r.status})`);
  return data;
}
// There is deliberately NO refund call here: the service does not give refunds (a cancelled paid game becomes credit, docs/ROLES_AND_CONSOLE_SPEC_6.md).
export async function fetchPayment(cfg: RazorpayConfig, paymentId: string): Promise<any> {
  const r = await fetch(`${base(cfg)}/payments/${encodeURIComponent(paymentId)}`, { headers: { authorization: basic(cfg) } });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.description ?? `Razorpay payment lookup failed (${r.status})`);
  return data;
}
/** If the account captures manually, the payment is only "authorized" until we capture exactly the order amount. */
export async function capturePayment(cfg: RazorpayConfig, paymentId: string, amountMinor: number, currency: string): Promise<any> {
  const r = await fetch(`${base(cfg)}/payments/${encodeURIComponent(paymentId)}/capture`, { method: "POST", headers: { authorization: basic(cfg), "content-type": "application/json" }, body: JSON.stringify({ amount: amountMinor, currency }) });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.description ?? `Razorpay capture failed (${r.status})`);
  return data;
}
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
/** Checkout returns razorpay_payment_id and razorpay_signature = HMAC_SHA256(order_id|payment_id, key_secret). */
export function verifyPaymentSignature(secret: string, orderId: string, paymentId: string, signature: string): boolean {
  return safeEq(createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex"), String(signature ?? ""));
}
/** Webhook header X-Razorpay-Signature = HMAC_SHA256(raw body, webhook secret). */
export function verifyWebhookSignature(secret: string, rawBody: string, signature: string): boolean {
  return safeEq(createHmac("sha256", secret).update(rawBody).digest("hex"), String(signature ?? ""));
}
export const toMinor = (amount: number) => Math.round(amount * 100);
