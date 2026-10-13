// Records the law makes us keep for ever (product rule 2026-10-09):
//   1. payments and invoices (tables payment, invoice, entitlement: nothing deletes them),
//   2. the organizer's details that are part of the invoice (name, e-mail, mobile),
//   3. who paid (the payer: name, organisation, e-mail, mobile, country, GSTIN).
// Everything else about a game is deleted at the end of day 365 (lifecycle.ts). The details in 2 and 3 live in the payment and invoice rows;
// `legal_party` is a second, permanent copy per game that also holds the mobile number the organizer confirmed at Publish (kv contact/<eid>, which is deleted with the game).
import type { D1 } from "./worker";

export const LEGAL_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS legal_party (eid TEXT PRIMARY KEY, org TEXT, organizer_name TEXT, organizer_email TEXT, organizer_phone TEXT, payer_name TEXT, payer_org TEXT, payer_email TEXT, payer_phone TEXT, payer_country TEXT, payer_tax_id TEXT, payment_ids TEXT, kept_ms INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS legal_party_org ON legal_party (org)`,
];

/** Writes (or refreshes) the permanent record of a game that has a paid payment. Safe to repeat. Call it before the game's own rows are deleted. */
export async function keepLegalParty(db: D1, eid: string, now: number): Promise<boolean> {
  const pays = (await db.prepare("SELECT id, org, email, meta FROM payment WHERE eid=? AND status='paid' ORDER BY paid_ms, id").bind(eid).all<{ id: string; org: string | null; email: string; meta: string }>()).results ?? [];
  if (!pays.length) return false;
  const first = pays[0]!; let m: any = {}; try { m = JSON.parse(first.meta); } catch { m = {}; }
  let c: any = {}; try { const r = await db.prepare("SELECT v FROM kv WHERE k=?").bind(`contact/${eid}`).first<{ v: string }>(); c = r ? JSON.parse(r.v) : {}; } catch { c = {}; }
  const had = await db.prepare("SELECT organizer_phone, organizer_email FROM legal_party WHERE eid=?").bind(eid).first<{ organizer_phone: string | null; organizer_email: string | null }>();
  const orgEmail = c.email || had?.organizer_email || first.email, orgPhone = c.phone ? String(c.phone) : had?.organizer_phone ?? m.phone ?? null;
  await db.prepare("INSERT INTO legal_party(eid,org,organizer_name,organizer_email,organizer_phone,payer_name,payer_org,payer_email,payer_phone,payer_country,payer_tax_id,payment_ids,kept_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(eid) DO UPDATE SET org=excluded.org, organizer_name=excluded.organizer_name, organizer_email=excluded.organizer_email, organizer_phone=COALESCE(excluded.organizer_phone, legal_party.organizer_phone), payer_name=excluded.payer_name, payer_org=excluded.payer_org, payer_email=excluded.payer_email, payer_phone=COALESCE(excluded.payer_phone, legal_party.payer_phone), payer_country=excluded.payer_country, payer_tax_id=excluded.payer_tax_id, payment_ids=excluded.payment_ids, kept_ms=excluded.kept_ms")
    .bind(eid, first.org, m.name ?? m.org ?? null, orgEmail ?? null, orgPhone, m.name ?? null, m.org ?? null, first.email, m.phone ?? null, m.country ?? null, m.taxId ?? null, pays.map((p) => p.id).join(","), now).run();
  return true;
}
