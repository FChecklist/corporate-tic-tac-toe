-- One payment ledger for every product and website paid through IT Services by Rajat Agarwal: product, website, type, reference and payer on each payment; a product catalog; a log of every Razorpay webhook call; and the payment_ledger view.
-- Run once (the ALTER lines fail if repeated; the rest is safe to repeat).
ALTER TABLE payment ADD COLUMN site TEXT;
ALTER TABLE payment ADD COLUMN product TEXT;
ALTER TABLE payment ADD COLUMN product_type TEXT;
ALTER TABLE payment ADD COLUMN product_ref TEXT;
ALTER TABLE payment ADD COLUMN payer_user TEXT;
CREATE INDEX IF NOT EXISTS payment_product ON payment (product, product_type);
CREATE TABLE IF NOT EXISTS product_catalog (product TEXT NOT NULL, product_type TEXT NOT NULL, site TEXT NOT NULL, name TEXT NOT NULL, seller TEXT NOT NULL, notes TEXT, PRIMARY KEY (product, product_type));
INSERT OR IGNORE INTO product_catalog(product,product_type,site,name,seller,notes) VALUES('corporate_tic_tac_toe','game_pack','corporate-tic-tac-toe.pages.dev','Corporate Tic Tac Toe','IT Services by Rajat Agarwal','One game, sold as up to N participants (product_ref = pack_N, payer_user = organizer account)');
INSERT OR IGNORE INTO product_catalog(product,product_type,site,name,seller,notes) VALUES('corporate_tic_tac_toe','payment_test','corporate-tic-tac-toe.pages.dev','Corporate Tic Tac Toe payment test','IT Services by Rajat Agarwal','Rs 1 / US$ 1 test payment that buys nothing');
UPDATE payment SET site='corporate-tic-tac-toe.pages.dev', product='corporate_tic_tac_toe', product_type=CASE WHEN json_extract(meta,'$.paytest') THEN 'payment_test' ELSE 'game_pack' END, product_ref=CASE WHEN json_extract(meta,'$.paytest') THEN 'payment_test' ELSE 'pack_' || pack END WHERE site IS NULL;
CREATE TABLE IF NOT EXISTS webhook_log (id INTEGER PRIMARY KEY AUTOINCREMENT, received_ms INTEGER NOT NULL, event TEXT, rzp_event_id TEXT, rzp_order_id TEXT, rzp_payment_id TEXT, payment_id TEXT, amount_minor INTEGER, signature_ok INTEGER NOT NULL, outcome TEXT NOT NULL, http_status INTEGER);
CREATE INDEX IF NOT EXISTS webhook_log_payment ON webhook_log (payment_id);
CREATE INDEX IF NOT EXISTS webhook_log_order ON webhook_log (rzp_order_id);
CREATE VIEW IF NOT EXISTS payment_ledger AS SELECT p.id AS payment_id, p.rzp_order_id, p.rzp_payment_id, p.site, p.product, c.name AS product_name, p.product_type, p.product_ref, p.eid AS engagement, p.payer_user, p.email AS payer_email, json_extract(p.meta,'$.name') AS payer_name, json_extract(p.meta,'$.org') AS payer_org, json_extract(p.meta,'$.country') AS payer_country, p.currency, p.amount, p.tax, p.status, p.is_test, datetime(p.created_ms/1000,'unixepoch') AS created_utc, datetime(p.paid_ms/1000,'unixepoch') AS paid_utc, (SELECT COUNT(*) FROM webhook_log w WHERE w.payment_id=p.id AND w.signature_ok=1) AS webhooks_received, (SELECT group_concat(w.event || ':' || w.outcome, ', ') FROM webhook_log w WHERE w.payment_id=p.id AND w.signature_ok=1) AS webhook_events FROM payment p LEFT JOIN product_catalog c ON c.product=p.product AND c.product_type=p.product_type;
