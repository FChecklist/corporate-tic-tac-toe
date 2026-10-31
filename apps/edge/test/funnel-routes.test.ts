// Sales funnel (funnel.ts, owner order 1 Nov 2026) through the REAL routes: every one of the thirteen events fires from the code that really handles it (the page beacon, creating a game,
// publishing, the pay link, checkout, the payment confirmation, the gateway's failure message, and the lifecycle tick that sees a game start and end); the switch is off by default;
// the owner's report and CSV answer only the owner; and after a whole journey with real-looking personal details the table holds none of them.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { lifecycleTick } from "../src/lifecycle";
import { FUNNEL_EVENTS } from "../src/funnel";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367, DAY = 86_400_000;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200, START_MS = (GEN + (START - 1) * 3) * 1000, AFTER = T + 8 * 3_600_000;
let env: PayEnv & Record<string, any>; let raw: ReturnType<typeof makeD1>["raw"]; let ipN = 0; let orders: any[] = [];
const realFetch = globalThis.fetch;
const hmac = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("hex");
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => (String(i).padStart(2, "0") + "b".repeat(32)).slice(0, 32);
const evs = () => (raw.prepare("SELECT name FROM sqlite_master WHERE name='ttt_fun'").get() ? (raw.prepare("SELECT * FROM ttt_fun").all() as any[]) : []);
const have = () => new Set(evs().map((r) => r.ev));
const beacon = (event: string, visit: string, extra: Record<string, unknown> = {}) => call("POST", "/api/f", { event, at: T, visit, ...extra }, { origin: "http://x", "content-type": "text/plain" });

beforeEach(() => {
  const d = makeD1(); raw = d.raw; orders = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); const o = { id: "order_" + (orders.length + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }; orders.push(o); return new Response(JSON.stringify(o)); }
    const pm = u.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (pm) return new Response(JSON.stringify({ id: pm[1], order_id: orders[0]?.id, status: "captured", amount: orders[0]?.amount }));
    return new Response("{}", { status: 404 });
  };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "http://x", PHONE_SALT: "salt", FUNNEL_EVENTS: "on" };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function organizer() {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `7.9.9.${++ipN}` }, body: JSON.stringify({ email: "ravi.kumar@acme.com" }) }), env as any, T));
  return st.token as string;
}
const key = (k: string) => ({ "x-organizer": k });

async function journey() {
  expect((await beacon("viewed", "aaaaaaaaaaaa")).status).toBe(204); expect((await beacon("size_chosen", "aaaaaaaaaaaa", { size: 100 })).status).toBe(204);
  expect((await beacon("signup_started", "aaaaaaaaaaaa")).status).toBe(204); expect((await beacon("payment_page_opened", "bbbbbbbbbbbb")).status).toBe(204);
  const k = await organizer();
  expect((await call("POST", "/api/z", { id: "FUN-1", startRound: START, callSeconds: 6, cap: 100 }, key(k))).status).toBe(200);
  expect((await call("POST", "/api/z/FUN-1/publish", { email: "boss.person@acme.com", phone: "98765 43210" }, key(k))).status).toBe(200);
  expect((await call("POST", "/api/z/FUN-1/paylink", {}, key(k))).status).toBe(200);
  // a payment that goes through, and one the gateway reports as failed
  const buy = async () => j(await call("POST", "/api/checkout", { org: "Acme Ltd", email: "Boss.Person@Acme.com", phone: "9876543210", country: "IN", taxId: "", pack: 500, currency: "INR" }));
  const b1 = await buy(); expect(b1.paymentId).toBeTruthy();
  expect((await call("POST", "/api/payments/verify", { paymentId: b1.paymentId, razorpay_order_id: b1.razorpay.orderId, razorpay_payment_id: "pay_1", razorpay_signature: hmac("sek", `${b1.razorpay.orderId}|pay_1`) })).status).toBe(200);
  const b2 = await buy();
  const failed = JSON.stringify({ event: "payment.failed", created_at: Math.floor(T / 1000), payload: { payment: { entity: { id: "pay_f1", order_id: b2.razorpay.orderId, amount: b2.razorpay.amount, status: "failed", method: "card", error_code: "BAD_REQUEST_ERROR", error_description: "Payment failed", error_source: "customer", error_step: "payment_authorization", error_reason: "insufficient_funds" } } } });
  expect((await call("POST", "/api/payments/webhook", failed, { "x-razorpay-signature": hmac("whsec", failed) })).status).toBe(200);
  // a game that is paid for, has a player, starts and ends (the lifecycle tick sees both)
  const r = await call("POST", "/api/z/FUN-1/join", { phone: "9100000001", name: "Pat Sharma", device: dev(1) }); expect(r.status).toBe(200);
  raw.prepare("UPDATE engagement SET pack=100 WHERE id=?").run("FUN-1");
  await lifecycleTick(env as any, START_MS + 10_000); expect(have().has("game_started")).toBe(true); expect(have().has("game_completed")).toBe(false);
  await lifecycleTick(env as any, AFTER); expect(have().has("game_completed")).toBe(true);
  return k;
}

describe("every event fires from the real route or page code", () => {
  test("all thirteen events are kept after one journey, and a repeat changes nothing", async () => {
    await journey();
    expect([...have()].sort()).toEqual([...FUNNEL_EVENTS].sort());
    const n = evs().length; await beacon("viewed", "aaaaaaaaaaaa"); await lifecycleTick(env as any, AFTER + 1000); expect(evs().length).toBe(n);
  });
  test("the steps carry the size of the game or pack, never anything about a person", async () => {
    await journey();
    const by = Object.fromEntries(evs().map((r) => [r.ev, r]));
    expect(by.size_chosen.size).toBe(100); expect(by.game_created.size).toBe(100); expect(by.payment_started.size).toBe(500); expect(by.payment_failed.reason).toBe("error");
  });
});

describe("no event carries a name, a mobile number or an e-mail", () => {
  test("after a whole journey with real-looking details the table holds none of them", async () => {
    await journey(); await beacon("size_chosen", "cccccccccccc", { size: 200, name: "Pat Sharma", phone: "9100000001", email: "pat@acme.com", game: "pat@acme.com" });
    const all = JSON.stringify(evs());
    for (const bad of ["ravi", "kumar", "boss", "person", "acme", "98765", "9876543210", "9100000001", "pat", "sharma", "FUN-1", "@"]) expect(all.toLowerCase()).not.toContain(bad.toLowerCase());
    expect(Object.keys(evs()[0]!).sort()).toEqual(["at_ms", "ev", "k", "mode", "reason", "size"]);
    for (const r of evs()) expect(r.k).toMatch(/^[0-9a-f]{12}$|^[a-z0-9]{12}$/);
  });
});

describe("the switch is off until the owner has audited it", () => {
  test("with FUNNEL_EVENTS unset, the same journey keeps nothing and makes no table", async () => {
    delete env.FUNNEL_EVENTS; await journey().catch(() => {}); // the journey checks its own on-only steps last; the first failure there is expected
    expect(evs().length).toBe(0); expect(raw.prepare("SELECT name FROM sqlite_master WHERE name='ttt_fun'").get()).toBeNull();
  });
  test("Do Not Track and Global Privacy Control on the page route keep nothing", async () => {
    expect((await call("POST", "/api/f", { event: "viewed", at: T, visit: "dddddddddddd" }, { "sec-gpc": "1", origin: "http://x" })).status).toBe(204);
    expect((await call("POST", "/api/f", { event: "viewed", at: T, visit: "dddddddddddd" }, { dnt: "1", origin: "http://x" })).status).toBe(204);
    expect(evs().length).toBe(0);
  });
});

describe("the owner's report", () => {
  test("only the platform key reads it: 404 for nobody, a wrong key or an organizer; JSON and CSV give the same counts", async () => {
    const k = await journey();
    expect((await call("GET", "/api/owner/funnel", undefined, {}, T + DAY)).status).toBe(404); expect((await call("GET", "/api/owner/funnel", undefined, key("wrong"), T + DAY)).status).toBe(404); expect((await call("GET", "/api/owner/funnel", undefined, key(k), T + DAY)).status).toBe(404);
    const rep = await j(await call("GET", "/api/owner/funnel?from=2026-10-01&to=2026-10-31", undefined, key("plat"), T + DAY));
    const t = Object.fromEntries(rep.total.map((x: any) => [x.step, x.count]));
    for (const e of FUNNEL_EVENTS) expect(t[e]).toBeGreaterThanOrEqual(1);
    const c = await call("GET", "/api/owner/funnel?from=2026-10-01&to=2026-10-31&format=csv", undefined, key("plat"), T + DAY);
    expect(c.headers.get("content-type")).toContain("text/csv"); const text = await c.text(); expect(text.startsWith("scope,period,step,label,count,percent_of_previous,percent_of_first")).toBe(true); expect(text).toContain("total,all,viewed,Page viewed,1,,100");
    expect((await call("POST", "/api/owner/funnel", {}, key("plat"), T + DAY)).status).toBe(404);
  });
});
