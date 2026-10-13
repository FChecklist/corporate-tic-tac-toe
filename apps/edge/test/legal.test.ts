import { beforeEach, describe, expect, test } from "bun:test";
import { eraseEverything } from "../src/lifecycle";
import { keepLegalParty } from "../src/legal";
import { makeD1 } from "./d1-sqlite";

// product rule 2026-10-09: payments, invoices, the organizer's invoice details (name, e-mail, mobile) and who paid are kept FOR EVER (the law).
// Everything else about a game is deleted at the end of day 365.
let raw: ReturnType<typeof makeD1>["raw"]; let env: any;
const one = (sql: string, ...a: any[]) => raw.prepare(sql).get(...a) as any;
const n = (sql: string, ...a: any[]) => one(sql, ...a).c as number;

beforeEach(() => {
  const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat" };
  raw.prepare("INSERT INTO engagement(id,org,cap,pack,start_round,call_seconds,created_ms) VALUES('G1','o1',100,100,1000,9,1)").run();
  raw.prepare("INSERT INTO kv(k,v) VALUES('contact/G1', ?)").run(JSON.stringify({ email: "boss@acme.com", phone: "9876543210" }));
  raw.prepare("INSERT INTO kv(k,v) VALUES('pub/G1','1')").run();
  raw.prepare("INSERT INTO payment(id,org,email,pack,currency,amount,tax,status,created_ms,paid_ms,meta,eid) VALUES('pay_1','o1','payer@acme.com',100,'INR',1179,179,'paid',1,2,?, 'G1')").run(JSON.stringify({ org: "Acme Ltd", name: "Asha Rao", phone: "+919811111111", country: "IN", taxId: "27ABCDE1234F1Z5" }));
  raw.prepare("INSERT INTO invoice(token,payment_id,brand,fy,seq,number,issued_ms,data) VALUES('inv_1','pay_1','ct','2026-27',1,'CT-1',2,'{}')").run();
  raw.prepare("INSERT INTO entitlement(id,org,pack,payment_id,eid,created_ms) VALUES('ent_1','o1',100,'pay_1','G1',2)").run();
});

describe("what the law makes us keep for ever", () => {
  test("day-365 deletion removes the game but keeps payment, invoice, entitlement and the organizer / payer details", async () => {
    await eraseEverything(env, "G1", 400 * 86_400_000);
    expect(n("SELECT COUNT(*) c FROM engagement WHERE id='G1'")).toBe(0);
    expect(n("SELECT COUNT(*) c FROM kv WHERE k IN ('contact/G1','pub/G1')")).toBe(0); // the rest is deleted
    expect(n("SELECT COUNT(*) c FROM payment WHERE id='pay_1'")).toBe(1);
    expect(n("SELECT COUNT(*) c FROM invoice WHERE payment_id='pay_1'")).toBe(1);
    expect(n("SELECT COUNT(*) c FROM entitlement WHERE payment_id='pay_1'")).toBe(1);
    const p = one("SELECT * FROM legal_party WHERE eid='G1'");
    expect([p.organizer_email, p.organizer_phone, p.organizer_name]).toEqual(["boss@acme.com", "9876543210", "Asha Rao"]); // the mobile confirmed at Publish survives the deletion of contact/G1
    expect([p.payer_name, p.payer_org, p.payer_email, p.payer_phone, p.payer_tax_id]).toEqual(["Asha Rao", "Acme Ltd", "payer@acme.com", "+919811111111", "27ABCDE1234F1Z5"]);
  });
  test("keeping is repeatable and a game without a paid payment leaves no permanent record", async () => {
    expect(await keepLegalParty(env.DB, "G1", 5)).toBe(true); expect(await keepLegalParty(env.DB, "G1", 6)).toBe(true);
    expect(n("SELECT COUNT(*) c FROM legal_party")).toBe(1);
    raw.prepare("INSERT INTO engagement(id,org,cap,pack,start_round,call_seconds,created_ms) VALUES('G2','o1',100,0,1000,9,1)").run();
    expect(await keepLegalParty(env.DB, "G2", 5)).toBe(false); await eraseEverything(env, "G2", 400 * 86_400_000);
    expect(n("SELECT COUNT(*) c FROM legal_party WHERE eid='G2'")).toBe(0);
  });
  test("an unpaid game's contact is deleted with it, nothing is kept", async () => {
    raw.prepare("UPDATE payment SET status='created'").run(); await eraseEverything(env, "G1", 400 * 86_400_000);
    expect(n("SELECT COUNT(*) c FROM legal_party")).toBe(0);
  });
});
