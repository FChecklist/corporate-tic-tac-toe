// One clear payment ledger for every product and website that is paid through "IT Services by Rajat Agarwal" (product rule 2026-10-11).
//   payment         one row per order: WHO (payer_email, payer_user), WHAT (product, product_type, product_ref), WHERE (site), HOW MUCH (currency, amount, tax), STATE (status, paid_ms).
//   product_catalog the list of products: which website sells it, what type it is, who the seller is. A new product or website is one INSERT here.
//   webhook_log     every call Razorpay makes to our webhook, good or bad: what it said, which payment it matched, what we did about it.
//   payment_ledger  a read-only view that joins the three, one row per payment, for the owner and the accountant.
import type { D1 } from "./worker";

export const SELLER = "IT Services by Rajat Agarwal";
export const TTT_SITE = "corporate-tic-tac-toe.pages.dev";
export const TTT_PRODUCT = "corporate_tic_tac_toe";

export const LEDGER_SCHEMA: string[] = [
  `ALTER TABLE payment ADD COLUMN site TEXT`,
  `ALTER TABLE payment ADD COLUMN product TEXT`,
  `ALTER TABLE payment ADD COLUMN product_type TEXT`,
  `ALTER TABLE payment ADD COLUMN product_ref TEXT`,
  `ALTER TABLE payment ADD COLUMN payer_user TEXT`,
  `CREATE INDEX IF NOT EXISTS payment_product ON payment (product, product_type)`,
  `CREATE TABLE IF NOT EXISTS product_catalog (product TEXT NOT NULL, product_type TEXT NOT NULL, site TEXT NOT NULL, name TEXT NOT NULL, seller TEXT NOT NULL, notes TEXT, PRIMARY KEY (product, product_type))`,
  `INSERT OR IGNORE INTO product_catalog(product,product_type,site,name,seller,notes) VALUES('corporate_tic_tac_toe','game_pack','corporate-tic-tac-toe.pages.dev','Corporate Tic Tac Toe','IT Services by Rajat Agarwal','One game, sold as up to N participants (product_ref = pack_N, payer_user = organizer account)')`,
  `INSERT OR IGNORE INTO product_catalog(product,product_type,site,name,seller,notes) VALUES('corporate_tic_tac_toe','payment_test','corporate-tic-tac-toe.pages.dev','Corporate Tic Tac Toe payment test','IT Services by Rajat Agarwal','Rs 1 / US$ 1 test payment that buys nothing')`,
  `UPDATE payment SET site='corporate-tic-tac-toe.pages.dev', product='corporate_tic_tac_toe', product_type=CASE WHEN json_extract(meta,'$.paytest') THEN 'payment_test' ELSE 'game_pack' END, product_ref=CASE WHEN json_extract(meta,'$.paytest') THEN 'payment_test' ELSE 'pack_' || pack END WHERE site IS NULL`,
  `CREATE TABLE IF NOT EXISTS webhook_log (id INTEGER PRIMARY KEY AUTOINCREMENT, received_ms INTEGER NOT NULL, event TEXT, rzp_event_id TEXT, rzp_order_id TEXT, rzp_payment_id TEXT, payment_id TEXT, amount_minor INTEGER, signature_ok INTEGER NOT NULL, outcome TEXT NOT NULL, http_status INTEGER)`,
  `CREATE INDEX IF NOT EXISTS webhook_log_payment ON webhook_log (payment_id)`,
  `CREATE INDEX IF NOT EXISTS webhook_log_order ON webhook_log (rzp_order_id)`,
  `CREATE VIEW IF NOT EXISTS payment_ledger AS SELECT p.id AS payment_id, p.rzp_order_id, p.rzp_payment_id, p.site, p.product, c.name AS product_name, p.product_type, p.product_ref, p.eid AS engagement, p.payer_user, p.email AS payer_email, json_extract(p.meta,'$.name') AS payer_name, json_extract(p.meta,'$.org') AS payer_org, json_extract(p.meta,'$.country') AS payer_country, p.currency, p.amount, p.tax, p.status, p.is_test, datetime(p.created_ms/1000,'unixepoch') AS created_utc, datetime(p.paid_ms/1000,'unixepoch') AS paid_utc, (SELECT COUNT(*) FROM webhook_log w WHERE w.payment_id=p.id AND w.signature_ok=1) AS webhooks_received, (SELECT group_concat(w.event || ':' || w.outcome, ', ') FROM webhook_log w WHERE w.payment_id=p.id AND w.signature_ok=1) AS webhook_events FROM payment p LEFT JOIN product_catalog c ON c.product=p.product AND c.product_type=p.product_type`,
];

/** The ledger fields for one new payment: where it was bought, what it is, who bought it. */
export function ledgerFields(site: string, productType: "game_pack" | "payment_test", productRef: string, payerUser: string | null) {
  return { site, product: TTT_PRODUCT, productType, productRef, payerUser };
}

/** The website name (no scheme) a payment came from. */
export const siteOf = (origin: string): string => { try { return new URL(origin).host; } catch { return TTT_SITE; } };

export interface HookRecord { now: number; event?: string | null; eventId?: string | null; orderId?: string | null; rzpPaymentId?: string | null; paymentId?: string | null; amountMinor?: number | null; signatureOk: boolean; outcome: string; status: number }

/** One row per webhook call. A logging failure must never fail the webhook itself. */
export async function logWebhook(db: D1, r: HookRecord): Promise<void> {
  try {
    await db.prepare("INSERT INTO webhook_log(received_ms,event,rzp_event_id,rzp_order_id,rzp_payment_id,payment_id,amount_minor,signature_ok,outcome,http_status) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(r.now, r.event ?? null, r.eventId ?? null, r.orderId ?? null, r.rzpPaymentId ?? null, r.paymentId ?? null, r.amountMinor ?? null, r.signatureOk ? 1 : 0, r.outcome.slice(0, 200), r.status).run();
  } catch { /* the ledger is a record, not a gate */ }
}
