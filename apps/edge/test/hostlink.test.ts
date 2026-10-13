import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { lifecycleTick, PURGE_AFTER_MS } from "../src/lifecycle";
import { creditExpiryMs } from "../src/credit";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

// Round 2 (rewritten for spec 6: NO REFUNDS, a cancelled paid game becomes credit, see credit.test.ts): cancel a game (Organizer and Host), the Host e-mail, the Co-host bound to one game, "Confirming your payment",
// and the "your guests' personal data has been deleted" e-mail. See docs/ROLES_AND_CONSOLE_SPEC_2.md items 1 to 7.
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const H = 3_600_000;
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const START = roundAt(T + 3 * H); // the game starts 3 hours after T
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const realFetch = globalThis.fetch;
let orders: any[]; let payments: Record<string, any>; let refundCalls: any[]; let razorpayCalls: number; let refundStatus: string; let refundFails: boolean;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const outbox = (like = "%") => raw.prepare("SELECT to_addr, subject, body FROM outbox WHERE subject LIKE ? OR body LIKE ? ORDER BY id").all(like, like) as { to_addr: string; subject: string; body: string }[];
const mailsTo = (to: string) => raw.prepare("SELECT subject, body FROM outbox WHERE to_addr=? ORDER BY id").all(to) as { subject: string; body: string }[];

beforeEach(() => {
  const d = makeD1(); raw = d.raw; orders = []; payments = {}; refundCalls = []; razorpayCalls = 0; refundStatus = "processed"; refundFails = false;
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (!u.startsWith("https://rzp.test")) return realFetch(url, init);
    razorpayCalls++;
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); const o = { id: "order_" + (orders.length + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }; orders.push(o); return new Response(JSON.stringify(o)); }
    const rf = u.match(/\/payments\/([^/]+)\/refund$/);
    if (rf) { const b = JSON.parse(init.body); refundCalls.push({ payment: rf[1], ...b }); return refundFails ? new Response(JSON.stringify({ error: { description: "gateway down" } }), { status: 502 }) : new Response(JSON.stringify({ id: "rfnd_" + refundCalls.length, status: refundStatus, amount: b.amount })); }
    const pm = u.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (pm) { const p = payments[pm[1]!]; if (pm[2]) p.status = "captured"; return new Response(JSON.stringify(p)); }
    return new Response("{}", { status: 404 });
  };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://bingo.test", OWNER_EMAIL: "owner@platform.test" };
});
afterEach(() => { globalThis.fetch = realFetch; });

let ip = 0;
let lastAi = "";
const start = async (email: string) => { const r = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `9.9.9.${++ip}` }, body: JSON.stringify({ email }) }), env as Env, T)); lastAi = r.aiKey as string; return r.token as string; };
/** Organizer + a Host (own e-mail) + a Co-host for game CAN-1, 300 places, starting 3 hours after T. */
const team = async () => {
  const master = await start("boss@acme.com"); const ai = lastAi;
  await call("POST", "/api/z", { id: "CAN-1", startRound: START, callSeconds: 9, cap: 300 }, master);
  const hostR = await j(await call("POST", "/api/org/host", { mobile: "9876500009", label: "Priya", email: "priya@acme.com" }, master));
  const cohostR = await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "98765 00001", e: "CAN-1" }, master));
  return { master, ai, host: hostR.hostKey as string, cohost: cohostR.cohostKey as string, hostId: hostR.id as string, cohostId: cohostR.id as string };
};
const pay = (key: string, eid = "CAN-1", now = T) => call("POST", "/api/checkout", { eid, org: "Acme Ltd", name: "Boss", email: "payer@acme.com", country: "IN", taxId: "", currency: "INR" }, key, now);
const sign = (c: any, id: string) => createHmac("sha256", "sek").update(`${c.razorpay.orderId}|${id}`).digest("hex");
const complete = async (c: any, id = "pay_1", now = T, status = "captured") => {
  payments[id] = { id, order_id: c.razorpay.orderId, status, amount: orders.find((o) => o.id === c.razorpay.orderId)!.amount };
  return call("POST", "/api/payments/verify", { paymentId: c.paymentId, razorpay_order_id: c.razorpay.orderId, razorpay_payment_id: id, razorpay_signature: sign(c, id) }, undefined, now);
};
const paidGame = async (t: { master: string }) => { const c = await j(await pay(t.master)); expect((await j(await complete(c))).published).toBe(true); return c; };
const join = (phone: string, name = "Guest") => call("POST", "/api/z/CAN-1/join", { phone, name });
const cancelIt = (key: string, now = T, confirmations = 3) => call("POST", "/api/z/CAN-1/cancel", { confirmations }, key, now);
const paymentRow = () => raw.prepare("SELECT * FROM payment WHERE status='paid'").get() as any;

// Gap closed 2026-10-09: a Host added from inside a game gets a link (and an e-mail) that opens THAT game; a game id of another account is ignored.
describe("Host link carries the game id", () => {
  test("added from a game: the link and the e-mail open that game", async () => {
    const t = await team();
    const r = await j(await call("POST", "/api/org/host", { label: "Meena", email: "meena@acme.com", e: "CAN-1" }, t.master));
    expect(r.link).toContain("&e=CAN-1"); expect(r.link).toMatch(/zc\.html\?k=cbh_[0-9a-f]{48}&e=CAN-1$/);
    const m = mailsTo("meena@acme.com").find((x) => x.subject.includes("Host"))!;
    expect(m.body).toContain("&e=CAN-1");
  });
  test("added with no game, or with a game that is not theirs: no game id in the link", async () => {
    const t = await team();
    const a = await j(await call("POST", "/api/org/host", { label: "A", email: "a@acme.com" }, t.master)); expect(a.link).not.toContain("&e=");
    const other = await start("other@rival.com");
    await call("POST", "/api/z", { id: "RIV-1", startRound: START, callSeconds: 9, cap: 100 }, other);
    const b = await j(await call("POST", "/api/org/host", { label: "B", email: "b@acme.com", e: "RIV-1" }, t.master)); expect(b.link).not.toContain("RIV-1");
    const c = await j(await call("POST", "/api/org/host", { label: "C", email: "c@acme.com", e: "x y/../" }, t.master)); expect(c.link).not.toContain("&e=");
  });
  test("a new first-open link also carries the game id", async () => {
    const t = await team();
    const h = await j(await call("POST", "/api/org/host", { label: "D", email: "d@acme.com", mobile: "9876500011" }, t.master));
    raw.prepare("UPDATE host_state SET verified_ms=NULL WHERE substr(host_id,1,10)=?").run(h.id); // this harness marks a new Host as set up; the first-open state is what the route needs
    const n = await j(await call("POST", "/api/org/host/link", { id: h.id, e: "CAN-1" }, t.master));
    expect(JSON.stringify(n)).toContain("&e=CAN-1"); expect(n.link).toMatch(/&e=CAN-1$/);
  });
});
