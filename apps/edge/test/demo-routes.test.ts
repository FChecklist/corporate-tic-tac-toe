// Free Demo game (flag DEMO_GAME, owner order 1 Nov 2026) and the owner-only Rs 1 payment test (flag PAYTEST_OWNER_ONLY), through the REAL routes.
// The demo: off by default; up to 10 people; labelled Demo in what the game reports; a bought pack is never used; no payment row; at most 3 a day per organizer and per network.
// The Rs 1 test: reachable only with the owner key when the switch is on. Runs on the partner laptop (the Worker cannot load on every machine).
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import type { PayEnv } from "../src/pay";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200;
let env: PayEnv & Record<string, any>; let raw: ReturnType<typeof makeD1>["raw"]; let n = 0;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, T);
const j = async (r: Response) => (await r.json()) as any;
const key = (k: string) => ({ "x-organizer": k });
async function organizer(ip = `7.1.1.${++n}`, email = `person${n}@example.org`) {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ email }) }), env as any, T));
  return st.token as string;
}
const demo = (k: string, id: string, ip = "9.9.9.9", extra: Record<string, unknown> = {}) => call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 10, demo: true, ...extra }, { ...key(k), "cf-connecting-ip": ip });

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat-owner-key-123", DAILY_WRITE_BUDGET: "1000000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "http://x", PHONE_SALT: "salt", DEMO_GAME: "on" };
});

describe("the free Demo game", () => {
  test("a demo is made, labelled Demo in what the game reports, and published with nothing to pay", async () => {
    const k = await organizer();
    const r = await demo(k, "DEMO-1"); expect(r.status).toBe(200); expect((await j(r)).demo).toBe(true);
    expect((await j(await call("GET", "/api/z/DEMO-1/info", undefined, key(k)))).demo).toBe(true);
    const pub = await call("POST", "/api/z/DEMO-1/publish", { email: "organizer@example.org", phone: "98765 43210" }, key(k)); expect(pub.status).toBe(200);
    const info = await j(await call("GET", "/api/z/DEMO-1/info")); expect(info.demo).toBe(true); expect(info.rs0).toBe(true);
    expect(raw.query("SELECT COUNT(*) c FROM payment").get()).toEqual({ c: 0 });
    expect((raw.query("SELECT pack FROM engagement WHERE id='DEMO-1'").get() as any).pack).toBe(10);
  });
  test("a normal game is not labelled Demo", async () => {
    const k = await organizer();
    expect((await call("POST", "/api/z", { id: "REAL-1", startRound: START, callSeconds: 6, cap: 10 }, key(k))).status).toBe(200);
    expect((await j(await call("GET", "/api/z/REAL-1/info", undefined, key(k)))).demo).toBeUndefined();
  });
  test("the switch is off by default: demo is ignored, nothing is recorded, no label", async () => {
    delete env.DEMO_GAME; const k = await organizer();
    const r = await demo(k, "OFF-1"); expect(r.status).toBe(200); expect((await j(r)).demo).toBeUndefined();
    expect((await j(await call("GET", "/api/z/OFF-1/info", undefined, key(k)))).demo).toBeUndefined();
    expect((raw.query("SELECT COUNT(*) c FROM kv WHERE k LIKE 'demo%'").get() as any).c).toBe(0);
  });
  test("a demo is for up to 10 people", async () => {
    const k = await organizer(); const r = await demo(k, "BIG-1", "9.9.9.9", { cap: 11 }); expect(r.status).toBe(400);
  });
  test("a demo never uses a bought pack", async () => {
    const k = await organizer(); const org = (raw.query("SELECT org FROM organizer_key LIMIT 1").get() as any).org;
    raw.query("INSERT INTO entitlement(id,org,pack,payment_id,eid,created_ms) VALUES('en1',?,100,'p1',NULL,1)").run(org);
    expect((await demo(k, "PACK-1")).status).toBe(200);
    expect(raw.query("SELECT eid FROM entitlement WHERE id='en1'").get()).toEqual({ eid: null });
  });
  test("at most 3 a day per organizer, then a calm refusal; a new day starts again", async () => {
    const k = await organizer();
    for (const id of ["A-1", "A-2", "A-3"]) expect((await demo(k, id, `9.9.9.${id.length}${id.charCodeAt(2)}`)).status).toBe(200);
    const no = await demo(k, "A-4", "9.9.8.8"); expect(no.status).toBe(429); expect((await j(no)).error).toMatch(/3 demo games a day/);
    expect(raw.query("SELECT COUNT(*) c FROM engagement WHERE id='A-4'").get()).toEqual({ c: 0 });
  });
  test("at most 3 a day per network, even from different organizers", async () => {
    for (let i = 1; i <= 3; i++) expect((await demo(await organizer(), `N-${i}`, "5.5.5.5")).status).toBe(200);
    expect((await demo(await organizer(), "N-4", "5.5.5.5")).status).toBe(429);
    expect((await demo(await organizer(), "N-5", "6.6.6.6")).status).toBe(200);
  });
});

describe("the Rs 1 payment test is owner only when the switch is on", () => {
  const pt = { email: "owner@example.org", name: "Rajat Agarwal", country: "IN" };
  test("without the switch the public test works as before", async () => {
    expect((await call("POST", "/api/payments/paytest", pt)).status).not.toBe(404);
  });
  test("with the switch: no key, a wrong key and an organizer key all get 404 on both routes; the owner key reaches the test", async () => {
    env.PAYTEST_OWNER_ONLY = "on"; const k = await organizer();
    for (const h of [{}, key("wrong"), key(k)]) { expect((await call("POST", "/api/payments/paytest", pt, h)).status).toBe(404); expect((await call("GET", "/api/payments/paytest/pay_0123456789abcdef", undefined, h)).status).toBe(404); }
    expect((await call("POST", "/api/payments/paytest", pt, key("plat-owner-key-123"))).status).not.toBe(404);
    expect((await call("GET", "/api/payments/paytest/pay_0123456789abcdef", undefined, key("plat-owner-key-123"))).status).toBe(404); // the owner key passes the gate; this payment simply does not exist
  });
});
