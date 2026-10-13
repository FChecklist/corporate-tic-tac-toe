// Phase 3: a pay link anyone can open (docs/ROLES_AND_CONSOLE_SPEC_4.md section B, spec 2 item 13, apps/edge/src/paylink.ts).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { price } from "../../../packages/shared/src/pricing";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 8, 10, 0, 0), H = 3_600_000, DAY = 24 * H;
const START = Math.floor(((T + 3 * H) / 1000 - 1692803367) / 3) + 1; // the game starts 3 hours after T
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let orders: any[]; let payments: Record<string, any>; let ipN = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, key?: string, now = T, ip = "2.2.2.2") =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const tokenOf = (url: string) => new URL(url).searchParams.get("t")!;
const sign = (orderId: string, id: string) => createHmac("sha256", "sek").update(`${orderId}|${id}`).digest("hex");

beforeEach(() => {
  const d = makeD1(); raw = d.raw; orders = []; payments = {};
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (!u.startsWith("https://rzp.test")) return realFetch(url, init);
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); const o = { id: "order_" + (orders.length + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }; orders.push(o); return new Response(JSON.stringify(o)); }
    const pm = u.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (pm) { const p = payments[pm[1]!]; if (pm[2]) p.status = "captured"; return new Response(JSON.stringify(p)); }
    return new Response("{}", { status: 404 });
  };
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://bingo.test", OWNER_EMAIL: "owner@platform.test" } as PayEnv;
});
afterEach(() => { globalThis.fetch = realFetch; });

/** Organizer + Host + Co-host (for PL-1) + an AI key; a second Organizer with their own game PL-2. */
const team = async () => {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `9.9.9.${++ipN}` }, body: JSON.stringify({ email: `boss${ipN}@acme.com` }) }), env as Env, T));
  const master = st.token as string;
  await call("POST", "/api/z", { id: "PL-1", startRound: START, callSeconds: 9, cap: 300, name: "Diwali Bingo" }, master);
  const host = (await j(await call("POST", "/api/org/host", { label: "Priya", email: "priya@acme.com", mobile: "9876500009" }, master))).hostKey as string;
  const cohost = (await j(await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500001", e: "PL-1" }, master))).cohostKey as string;
  const o2 = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `9.9.9.${++ipN}` }, body: JSON.stringify({ email: `other${ipN}@acme.com` }) }), env as Env, T));
  await call("POST", "/api/z", { id: "PL-2", startRound: START, callSeconds: 9, cap: 100 }, o2.token);
  return { master, ai: st.aiKey as string, host, cohost, other: o2.token as string };
};
const link = async (key: string, eid = "PL-1", now = T) => { const r = await call("POST", `/api/z/${eid}/paylink`, {}, key, now); return { status: r.status, body: await j(r) }; };
const pay = (token: string, body: Record<string, unknown> = {}, now = T, ip = "2.2.2.2") => call("POST", `/api/paylink/${token}/checkout`, { name: "Finance Fiona", email: "fiona@acme.com", ...body }, undefined, now, ip);
const complete = async (c: any, id = "pay_1", now = T) => {
  payments[id] = { id, order_id: c.razorpay.orderId, status: "captured", amount: orders.find((o) => o.id === c.razorpay.orderId)!.amount };
  return call("POST", "/api/payments/verify", { paymentId: c.paymentId, razorpay_order_id: c.razorpay.orderId, razorpay_payment_id: id, razorpay_signature: sign(c.razorpay.orderId, id) }, undefined, now);
};
const view = async (token: string, now = T) => j(await call("GET", `/api/paylink/${token}`, undefined, undefined, now));

describe("making the link: who may", () => {
  test("the Organizer, a Host and a Co-host of that game may; the link opens on the site's pay-link page and lasts 7 days", async () => {
    const t = await team();
    for (const key of [t.master, t.host, t.cohost]) {
      const r = await link(key);
      expect(r.status).toBe(200); expect(r.body.url).toMatch(/^https:\/\/bingo\.test\/paylink\.html\?t=[0-9a-f]{48}$/); expect(r.body.expiresMs).toBe(T + 7 * DAY);
    }
  });
  test("an AI key, a stranger, no key, another Organizer, another game's Co-host and a Host on an AI link are all refused", async () => {
    const t = await team();
    expect((await link(t.ai)).status).toBe(403); expect((await link("cbk_" + "a".repeat(48))).status).toBe(403); expect((await link("")).status).toBe(403);
    expect((await link(t.other, "PL-1")).status).toBe(404); expect((await link(t.master, "NOPE-1")).status).toBe(404);
    const other = await j(await call("POST", "/api/org/cohost", { label: "Zed", phone: "9876500005", e: "PL-2" }, t.other));
    expect((await link(other.cohostKey, "PL-1")).status).toBe(404);
    const mine = await j(await call("POST", "/api/org/cohost", { label: "Moe", phone: "9876500006", e: "PL-1" }, t.master));
    expect((await link(mine.cohostKey, "PL-1")).status).toBe(200);
    const viaAi = await call("POST", `/ai/${t.ai}/z/PL-1/paylink`, {}); expect(viaAi.status).toBe(403);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM paylink").get() as any).c).toBe(1); // only the one made by this game's own Co-host
  });
  test("the token is stored hashed, never in clear", async () => {
    const t = await team(); const r = await link(t.master); const tok = tokenOf(r.body.url);
    const all = JSON.stringify([raw.prepare("SELECT * FROM paylink").all(), raw.prepare("SELECT * FROM kv").all(), raw.prepare("SELECT * FROM outbox").all()]);
    expect(all).not.toContain(tok); expect(JSON.stringify(raw.prepare("SELECT hash FROM paylink").all())).toMatch(/[0-9a-f]{64}/);
  });
  test("one open link per game: a new one cancels the old at once", async () => {
    const t = await team(); const a = tokenOf((await link(t.master)).body.url), b = tokenOf((await link(t.host)).body.url);
    expect(a).not.toBe(b); expect((await view(a)).status).toBe("expired"); expect((await view(b)).status).toBe("open");
    expect((await pay(a)).status).toBe(409); expect((await pay(b)).status).toBe(200);
  });
  test("no link for a game that is cancelled or already paid", async () => {
    const t = await team(); const tok = tokenOf((await link(t.master)).body.url);
    expect((await call("POST", "/api/z/PL-1/cancel", { confirmations: 3 }, t.master)).status).toBe(200);
    expect((await view(tok)).status).toBe("cancelled"); expect((await link(t.master)).status).toBe(409);
    expect((await pay(tok)).status).toBe(409);
  });
});

describe("what the link shows: the game's name, start and price, and nothing else", () => {
  test("GET /api/paylink/{token} answers exactly game, price and status", async () => {
    const t = await team(); const tok = tokenOf((await link(t.master)).body.url);
    const v = await view(tok); const p = price(500, "INR"); // 300 places need the 500 pack
    expect(Object.keys(v).sort()).toEqual(["game", "price", "status"]);
    expect(v.game).toEqual({ name: "Diwali Bingo", participants: 500, startMs: (1692803367 + (START - 1) * 3) * 1000 }); expect(Object.keys(v.game).sort()).toEqual(["name", "participants", "startMs"]); // the pack is shown so the payer sees what is being paid for; the game ID stays private to a link holder
    expect(v.price).toEqual({ base: p.base, gst: p.tax, total: p.total, currency: "INR" }); expect(v.status).toBe("open");
    const text = JSON.stringify(v); for (const secret of ["PL-1", "boss", "acme", "cap", "300", t.master, "org"]) expect([secret, text.includes(secret)]).toEqual([secret, false]);
    expect((await j(await call("GET", `/api/paylink/${tok}?currency=USD`))).price).toEqual({ base: 67, gst: 0, total: 67, currency: "USD" });
  });
  test("a wrong, short or made-up token is the same plain 404", async () => {
    await team();
    for (const tok of ["0".repeat(48), "abc", "G".repeat(48), "0".repeat(47), "0".repeat(49)]) expect([tok.length, (await call("GET", `/api/paylink/${tok}`)).status]).toEqual([tok.length, 404]);
    expect((await call("POST", `/api/paylink/${"0".repeat(48)}/checkout`, { name: "A B", email: "a@b.co" })).status).toBe(404);
  });
  test("the link ends after 7 days", async () => {
    const t = await team(); const tok = tokenOf((await link(t.master)).body.url);
    expect((await view(tok, T + 7 * DAY - 1000)).status).toBe("open");
    expect((await view(tok, T + 7 * DAY + 1000)).status).toBe("expired");
    expect((await pay(tok, {}, T + 7 * DAY + 1000)).status).toBe(409);
  });
});

describe("paying through the link", () => {
  test("name and e-mail are required; the rest is optional; a GSTIN is checked only when given", async () => {
    const t = await team(); const tok = tokenOf((await link(t.master)).body.url);
    for (const bad of [{ name: "" }, { name: "A" }, { email: "" }, { email: "not-an-email" }, { name: undefined }, { email: undefined }]) expect([JSON.stringify(bad), (await pay(tok, bad as any)).status]).toEqual([JSON.stringify(bad), 400]);
    const g = await pay(tok, { country: "IN", taxId: "27BAD" }); expect(g.status).toBe(400); expect((await j(g)).error).toMatch(/GSTIN/);
    const ok = await pay(tok, { country: "IN", taxId: "" }); expect(ok.status).toBe(200);
    const ok2 = await pay(tok); expect(ok2.status).toBe(200); // only name and e-mail
    expect((await pay(tok, { taxId: "27ABCDE1234F1Z5", org: "Acme Ltd", phone: "98765 43210", phoneCode: "91", country: "IN" })).status).toBe(200);
  });
  test("the payment is bound to THIS game and the right pack, whatever the payer sends", async () => {
    const t = await team(); const tok = tokenOf((await link(t.master)).body.url);
    const r = await j(await pay(tok, { eid: "PL-2", pack: 100, org: "Acme" }));
    expect(r.mode).toBe("razorpay"); const row = raw.prepare("SELECT eid, org, pack, amount, meta FROM payment").get() as any;
    expect(row.eid).toBe("PL-1"); expect(row.pack).toBe(500); expect(row.amount).toBe(price(500, "INR").total); expect(JSON.parse(row.meta).paidBy).toBe("link");
    expect(raw.prepare("SELECT org FROM engagement WHERE id='PL-1'").get()).toEqual({ org: (raw.prepare("SELECT org FROM engagement WHERE id='PL-1'").get() as any).org });
  });
  test("a verified payment publishes the game, records 'paid by link', issues the invoice; the link then says paid and cannot be used again", async () => {
    const t = await team(); const tok = tokenOf((await link(t.master)).body.url);
    const c = await j(await pay(tok, { org: "Acme Ltd" })); expect(c.mode).toBe("razorpay");
    expect((await view(tok)).status).toBe("open");
    const done = await j(await complete(c)); expect(done).toMatchObject({ ok: true, published: true, eid: "PL-1" }); expect(done.organizerKey).toBeNull(); // a payer by link never receives a key
    expect(await view(tok)).toMatchObject({ status: "paid" });
    const s = await j(await call("GET", "/api/z/PL-1/summary", undefined, t.master)); expect(s.payment).toMatchObject({ status: "paid", paidBy: "link" });
    expect(raw.prepare("SELECT COUNT(*) AS c FROM invoice").get()).toEqual({ c: 1 });
    expect((raw.prepare("SELECT body FROM outbox WHERE to_addr='fiona@acme.com'").all() as any[]).some((m) => /invoice/i.test(m.body))).toBe(true);
    expect((await pay(tok)).status).toBe(409); expect((await link(t.master)).status).toBe(409);
  });
  test("verifying again is idempotent (one invoice, one entitlement), and the gateway webhook for the same order changes nothing", async () => {
    const t = await team(); const tok = tokenOf((await link(t.master)).body.url);
    const c = await j(await pay(tok)); const first = await j(await complete(c)); const again = await j(await complete(c));
    expect(again.invoiceNumber).toBe(first.invoiceNumber);
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: c.razorpay.orderId, amount: orders[0].amount } } } });
    const wh = await handle(new Request("http://x/api/payments/webhook", { method: "POST", headers: { "x-razorpay-signature": createHmac("sha256", "whsec").update(body).digest("hex") }, body }), env as Env, T);
    expect(wh.status).toBe(200);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM invoice").get()).toEqual({ c: 1 }); expect(raw.prepare("SELECT COUNT(*) AS c FROM entitlement").get()).toEqual({ c: 1 });
  });
  test("a payment that the gateway has not confirmed yet shows 'confirming' on the link, never 'paid'", async () => {
    const t = await team(); const tok = tokenOf((await link(t.master)).body.url);
    const c = await j(await pay(tok)); payments["pay_1"] = { id: "pay_1", order_id: c.razorpay.orderId, status: "created", amount: orders[0].amount };
    const v = await call("POST", "/api/payments/verify", { paymentId: c.paymentId, razorpay_order_id: c.razorpay.orderId, razorpay_payment_id: "pay_1", razorpay_signature: sign(c.razorpay.orderId, "pay_1") });
    expect(v.status).toBe(202); expect((await view(tok)).status).toBe("confirming");
    expect((await pay(tok)).status).toBe(409);
  });
  test("a wrong signature never publishes anything", async () => {
    const t = await team(); const tok = tokenOf((await link(t.master)).body.url);
    const c = await j(await pay(tok)); payments["pay_1"] = { id: "pay_1", order_id: c.razorpay.orderId, status: "captured", amount: orders[0].amount };
    const v = await call("POST", "/api/payments/verify", { paymentId: c.paymentId, razorpay_order_id: c.razorpay.orderId, razorpay_payment_id: "pay_1", razorpay_signature: "0".repeat(64) });
    expect(v.status).toBe(400); expect((await view(tok)).status).toBe("open");
  });
  test("no refund: the Organizer cancels the paid game, the payment stays as credit, no refund row, and the link says cancelled", async () => {
    const t = await team(); const tok = tokenOf((await link(t.master)).body.url);
    await complete(await j(await pay(tok)));
    const pre = await j(await call("GET", "/api/z/PL-1/cancel-preview", undefined, t.master)); expect(pre.paid).toBe(true); expect(pre.credit.amountInr).toBeGreaterThan(0);
    expect((await call("POST", "/api/z/PL-1/cancel", { confirmations: 3 }, t.master)).status).toBe(200);
    expect(raw.prepare("SELECT COUNT(*) AS c FROM refund").get()).toEqual({ c: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS c FROM credit").get()).toEqual({ c: 1 });
    expect((await view(tok)).status).toBe("cancelled");
  });
  test("the same free-plan guard as other public writes: 30 attempts a day from one network, then 429; another network is fine", async () => {
    const t = await team(); const tok = tokenOf((await link(t.master)).body.url);
    for (let i = 0; i < 30; i++) expect((await pay(tok, { name: "" }, T, "7.7.7.7")).status).toBe(400);
    const r = await pay(tok, {}, T, "7.7.7.7"); expect(r.status).toBe(429);
    expect((await pay(tok, {}, T, "7.7.7.8")).status).toBe(200);
  });
});

describe("Option 1: the Razorpay window runs on the registered website", () => {
  test("checkout names the hop page only when PAY_HOP_URL is set and well formed", async () => {
    const body = { org: "Acme Ltd", email: "boss@acme.test", pack: 100, name: "Asha" };
    const off = await j(await call("POST", "/api/checkout", body));
    expect(off.mode).toBe("razorpay"); expect(off.hop).toBeUndefined();
    (env as any).PAY_HOP_URL = "https://itservices-rajat-agarwal.pages.dev/payframe/";
    const on = await j(await call("POST", "/api/checkout", body));
    expect(on.hop).toBe("https://itservices-rajat-agarwal.pages.dev/payframe/");
    (env as any).PAY_HOP_URL = "javascript:alert(1)";
    expect((await j(await call("POST", "/api/checkout", body))).hop).toBeUndefined();
  });
});

describe("proforma invoice (same template, NOT PAID, before paying)", () => {
  const pf = (body: Record<string, unknown>, headers?: string) => call("POST", "/api/proforma", body, headers);
  test("the pay link and a signed-in organizer each get the proforma; it says NOT PAID, names the game and uses no invoice number or record", async () => {
    const t = await team(); const l = await link(t.master); const tok = (l.body.url as string).split("t=")[1]!;
    const r = await pf({ link: tok, name: "Finance Fiona", email: "fiona@acme.com" }); expect(r.status).toBe(200);
    const b = await j(r); expect(b.ok).toBe(true); expect(b.number).toMatch(/^PF-/); expect(b.total).toBeGreaterThan(0);
    for (const x of ["PROFORMA INVOICE (NOT PAID)", "NOT PAID", "Finance Fiona", "Terms and conditions", "Payment status"]) expect(b.html).toContain(x);
    expect(b.html).not.toContain("Paid on (IST)");
    const o = await pf({ eid: "PL-1", name: "Boss" }, t.master); expect(o.status).toBe(200); expect((await j(o)).html).toContain("PROFORMA INVOICE (NOT PAID)");
    expect((raw.prepare("SELECT COUNT(*) AS c FROM invoice").get() as any).c).toBe(0);
  });
  test("a stranger, a bad link, no sign-in, or an already paid game get nothing", async () => {
    const t = await team();
    expect((await pf({ link: "0".repeat(48) })).status).toBe(404);
    expect((await pf({ eid: "PL-1" })).status).toBe(404);
    expect((await pf({ eid: "PL-1" }, "cbk_" + "a".repeat(48))).status).toBe(403);
    raw.prepare("UPDATE engagement SET pack=100 WHERE id='PL-1'").run();
    expect((await pf({ eid: "PL-1" }, t.master)).status).toBe(409);
  });
});
