import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

// Roles: Organizer (master), Host (cbh_, up to 5), Co-host (cbc_, unlimited). See docs/ROLES_AND_CONSOLE_SPEC.md.
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const FAR_START = Math.floor(((T + 2 * 86_400_000) / 1000 - 1692803367) / 3) + 1; // a game two days ahead (a game time can be at most 30 days ahead)
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const realFetch = globalThis.fetch;
let orders: any[]; let payments: Record<string, any>;
const call = (method: string, path: string, body?: unknown, key?: string) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: withDevice(method, path, body) }), env as Env, T);
const j = async (r: Response) => (await r.json()) as any;
beforeEach(() => {
  const d = makeD1(); raw = d.raw; orders = []; payments = {};
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); const o = { id: "order_" + (orders.length + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }; orders.push(o); return new Response(JSON.stringify(o)); }
    const pm = u.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (pm) { const p = payments[pm[1]!]; if (pm[2]) p.status = "captured"; return new Response(JSON.stringify(p)); }
    return new Response("{}", { status: 404 });
  };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://bingo.test" };
});
afterEach(() => { globalThis.fetch = realFetch; });

let ip = 0;
const start = async (email: string) => (await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `9.9.9.${++ip}` }, body: JSON.stringify({ email }) }), env as Env, T))).token as string;
const team = async (org = "boss@acme.com", gid = "ROLE-1") => {
  const master = await start(org);
  await call("POST", "/api/z", { id: gid, startRound: FAR_START, callSeconds: 9, cap: 300 }, master);
  const host = (await j(await call("POST", "/api/org/host", { mobile: "9876500009", label: "Priya", email: "priya@acme.com" }, master))).hostKey as string;
  const cohost = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500001", e: gid }, master))).cohostKey as string;
  return { master, host, cohost };
};
const pay = (key: string, eid = "ROLE-1") => call("POST", "/api/checkout", { eid, org: "Acme Ltd", email: "boss@acme.com", country: "IN", taxId: "", currency: "INR" }, key);
const complete = async (c: any, id = "pay_1") => {
  payments[id] = { id, order_id: c.razorpay.orderId, status: "captured", amount: orders.find((o) => o.id === c.razorpay.orderId)!.amount };
  return call("POST", "/api/payments/verify", { paymentId: c.paymentId, razorpay_order_id: c.razorpay.orderId, razorpay_payment_id: id, razorpay_signature: createHmac("sha256", "sek").update(`${c.razorpay.orderId}|${id}`).digest("hex") });
};

describe("who is who", () => {
  test("whoami tells the three roles apart, and a Co-host key has the cbc_ prefix", async () => {
    const t = await team();
    expect(t.cohost.startsWith("cbc_")).toBe(true);
    expect((await j(await call("GET", "/api/whoami", undefined, t.master))).kind).toBe("master");
    expect((await j(await call("GET", "/api/whoami", undefined, t.host))).kind).toBe("host");
    expect((await j(await call("GET", "/api/whoami", undefined, t.cohost))).kind).toBe("cohost");
  });
  test("the team list shows ids and labels, never keys; a Co-host may not read it", async () => {
    const t = await team();
    const r = await j(await call("GET", "/api/org/team", undefined, t.master));
    expect(r.maxHosts).toBe(5);
    expect(r.hosts).toHaveLength(1); expect(r.hosts[0].label).toBe("Priya"); expect(r.hosts[0].id).toMatch(/^[0-9a-f]{10}$/);
    expect(r.cohosts).toHaveLength(1); expect(r.cohosts[0]).toMatchObject({ label: "Ravi", brought: 0 });
    expect(JSON.stringify(r)).not.toContain(t.host); expect(JSON.stringify(r)).not.toContain(t.cohost);
    expect((await call("GET", "/api/org/team", undefined, t.host)).status).toBe(200);
    expect((await call("GET", "/api/org/team", undefined, t.cohost)).status).toBe(403);
  });
});

describe("adding and retiring people", () => {
  test("a Host may add a Co-host but not a Host; the sixth Host is refused", async () => {
    const t = await team();
    expect((await call("POST", "/api/org/cohost", { label: "Meera", phone: "9876500002", e: "ROLE-1" }, t.host)).status).toBe(200);
    expect((await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, t.host)).status).toBe(403);
    for (let i = 0; i < 4; i++) expect((await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, t.master)).status).toBe(200);
    expect((await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, t.master)).status).toBe(409); // 5 active already
  });
  test("a Co-host cannot add anyone; Co-hosts have no limit", async () => {
    const t = await team();
    expect((await call("POST", "/api/org/cohost", {}, t.cohost)).status).toBe(403);
    expect((await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, t.cohost)).status).toBe(403);
    for (let i = 0; i < 8; i++) expect((await call("POST", "/api/org/cohost", { label: "Guest " + i, phone: "98765001" + String(i).padStart(2, "0"), e: "ROLE-1" }, t.master)).status).toBe(200);
  });
  test("the Organizer retires a Host or Co-host; a Host retires a Co-host only", async () => {
    const t = await team();
    const r = await j(await call("GET", "/api/org/team", undefined, t.master));
    expect((await call("POST", "/api/org/team/retire", { id: r.hosts[0].id }, t.host)).status).toBe(403);
    expect((await call("POST", "/api/org/team/retire", { id: r.cohosts[0].id }, t.cohost)).status).toBe(403);
    expect((await call("POST", "/api/org/team/retire", { id: r.cohosts[0].id }, t.host)).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, t.cohost)).status).toBe(403); // the retired key no longer works
    expect((await call("POST", "/api/org/team/retire", { id: r.hosts[0].id }, t.master)).status).toBe(200);
    expect((await call("GET", "/api/whoami", undefined, t.host)).status).toBe(403);
  });
});

describe("what each role may do", () => {
  test("a Host may change the game, set guest invites and publish; a Co-host may not", async () => {
    const t = await team();
    expect((await call("PATCH", "/api/z/ROLE-1/settings", { name: "Host game" }, t.host)).status).toBe(200);
    expect((await call("PATCH", "/api/z/ROLE-1/settings", { invites: { on: true, per: 3, cats: ["family"] } }, t.host)).status).toBe(200);
    expect((await j(await call("GET", "/api/z/ROLE-1/summary", undefined, t.host))).invites.on).toBe(true);
    expect((await call("PATCH", "/api/z/ROLE-1/settings", { invites: { on: false, per: 3, cats: ["family"] } }, t.cohost)).status).toBe(403);
    expect((await j(await call("GET", "/api/z/ROLE-1/summary", undefined, t.master))).invites.on).toBe(true); // the Co-host did not change it
  });
  test("a Co-host is refused the guest list, the summary, participants and keys", async () => {
    const t = await team();
    for (const [m, p] of [["GET", "/api/z/ROLE-1/summary"], ["GET", "/api/z/ROLE-1/participants"], ["POST", "/api/z/ROLE-1/roster"], ["POST", "/api/z/ROLE-1/publish"], ["GET", "/api/org/keys"], ["POST", "/api/org/ai"], ["GET", "/api/history"], ["POST", "/api/z"]] as const)
      expect((await call(m, p, {}, t.cohost)).status).toBe(403);
  });
  test("account-level routes deny a Host", async () => {
    const t = await team();
    for (const [m, p] of [["GET", "/api/org/keys"], ["POST", "/api/org/keys/revoke"], ["POST", "/api/org/ai"], ["POST", "/api/org/ai/replace"], ["GET", "/api/org/ai/link"], ["POST", "/api/org/close"], ["POST", "/api/org/host"]] as const)
      expect((await call(m, p, {}, t.host)).status).toBe(403);
  });
  test("a Host still has the narrow rights through an AI work link", async () => {
    const t = await team();
    const r = await handle(new Request("http://x/api/z/ROLE-1/settings", { method: "PATCH", headers: { "content-type": "application/json", "x-organizer": t.host, "x-cb-link": "1" }, body: JSON.stringify({ name: "x" }) }), env as Env, T);
    expect(r.status).toBe(403);
  });
  test("a Co-host reads only the small game header, with an own invite link", async () => {
    const t = await team();
    const h = await j(await call("GET", "/api/z/ROLE-1/cohost", undefined, t.cohost));
    expect(Object.keys(h).sort()).toEqual(["brought", "cap", "credit", "creditApplied", "creditExpiresMs", "didNotStart", "erasureMs", "inviteLink", "joined", "name", "payment", "price", "startMs", "waitingFor"]);
    expect(h).toMatchObject({ cap: 300, joined: 0, brought: 0, payment: { status: "pending" } });
    expect(h.inviteLink).toBeNull(); // a draft cannot take guests yet
    const other = await team("other@rival.com", "ROLE-2");
    expect((await call("GET", "/api/z/ROLE-1/cohost", undefined, other.cohost)).status).toBe(403); // another account's Co-host
  });
});

describe("paying", () => {
  for (const who of [["master", "organizer"], ["host", "host"], ["cohost", "co-host"]] as const) {
    test(`the ${who[0]} can pay and the game shows Paid by ${who[1]}`, async () => {
      const t = await team();
      expect((await j(await call("GET", "/api/z/ROLE-1/summary", undefined, t.master))).payment).toEqual({ status: "pending" });
      const c = await j(await pay((t as any)[who[0]]));
      expect(c.mode).toBe("razorpay");
      expect((await j(await complete(c))).published).toBe(true);
      const s = await j(await call("GET", "/api/z/ROLE-1/summary", undefined, t.master));
      expect(s.payment).toMatchObject({ status: "paid", paidBy: who[1] }); expect(typeof s.payment.paidMs).toBe("number");
      const h = await j(await call("GET", "/api/z/ROLE-1/cohost", undefined, t.cohost));
      expect(h.payment).toMatchObject({ status: "paid", paidBy: who[1] });
    });
  }
  test("one payment is enough: a second attempt by anyone is refused", async () => {
    const t = await team();
    await complete(await j(await pay(t.cohost)));
    expect((await pay(t.master)).status).toBe(409);
    expect((await pay(t.host)).status).toBe(409);
    expect((await pay(t.cohost)).status).toBe(409);
  });
  test("a key of another account cannot pay", async () => {
    const t = await team(); const o = await team("other@rival.com", "ROLE-2");
    expect((await pay(o.cohost)).status).toBe(404);
  });
});

describe("a Co-host's own invite link", () => {
  test("people who join through it are counted as brought by that Co-host, even with guest invites off", async () => {
    const t = await team();
    await complete(await j(await pay(t.master)));
    const link = (await j(await call("GET", "/api/z/ROLE-1/cohost", undefined, t.cohost))).inviteLink as string;
    const from = Number(new URL(link).searchParams.get("from"));
    expect(from).toBeGreaterThan(1_000_000_000);
    expect((await call("POST", "/api/z/ROLE-1/join", { phone: "9876543210", from })).status).toBe(200);
    expect((await call("POST", "/api/z/ROLE-1/join", { phone: "9876543211" })).status).toBe(200); // joined by the main link
    const h = await j(await call("GET", "/api/z/ROLE-1/cohost", undefined, t.cohost));
    expect(h).toMatchObject({ joined: 2, brought: 1 });
    expect((await j(await call("GET", "/api/org/team", undefined, t.master))).cohosts[0].brought).toBe(1);
  });
});
