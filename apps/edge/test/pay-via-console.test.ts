// 1.6.5 (27 Nov 2026, owner order): Tic Tac Toe takes no payment itself. The console asks `payable` (read-only), Moneypenny charges, the console sends the signed `paid` notice, this game unlocks.
// With PAY_VIA_CONSOLE=1 the pay pages go to the console (302) and the game's own pay, pay-link, credit and proforma routes answer 410; nothing is ever opened with Razorpay or the central service.
// FALSIFIED BY: payable-leaks-a-strangers-game, pay-route-left-open, credit-route-left-open, paylink-route-left-open, placeorder-opens-an-order-with-the-flag-on, jobs-run-with-the-flag-on
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(60_000);
import { type Env, runTick } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
// @ts-ignore the contract kit is plain JavaScript copied from the console repo
import { makeCtx, buildAssertion } from "./console-contract/kit.mjs";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const roundOf = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const ORIGIN = "https://ttt.test";
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const realFetch = globalThis.fetch;
let env: Env, raw: any, ctx: any, n = 0, outbound: string[] = [];

async function boot(flag: "1" | undefined) {
  ctx = await makeCtx();
  const d = makeD1(); raw = d.raw; outbound = [];
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "10000000", PHONE_SALT: "salt", DATA_KEY: "k", PUBLIC_ORIGIN: ORIGIN, CONSOLE_PUBKEYS: "k1:" + ctx.publicB64u, PAY_SERVICE_KEY: "svc", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "s", ...(flag ? { PAY_VIA_CONSOLE: flag } : {}) } as any;
  globalThis.fetch = (async (u: any, i?: any) => { outbound.push(String(u instanceof Request ? u.url : u)); return realFetch(u, i); }) as any;
}
afterEach(() => { globalThis.fetch = realFetch; });
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  handle(new Request(ORIGIN + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, T);
const j = async (r: Response) => (await r.json()) as any;
async function organizer(email: string) {
  const s = await j(await call("POST", "/api/start", { email }, { "cf-connecting-ip": "10.0.2." + ++n }));
  const name = "p" + ++n; ctx.people[name] = { email, sub: await sha("email|" + email) };
  return { email, key: s.token as string, who: name };
}
async function game(o: { email: string; key: string }, id: string, cap = 100) {
  expect((await call("POST", "/api/z", { id, startRound: roundOf(T) + 1200, callSeconds: 9, cap }, { "x-organizer": o.key })).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, { "x-organizer": o.key })).status).toBe(200);
}
const asr = async (spec: any) => (await buildAssertion(ctx, spec, ORIGIN, T)).token;
const payable = async (who: string, eid: string) => call("POST", "/api/console/payable", { assertion: await asr({ act: "payable", person: who, eid }), eid });
const paid = async (who: string, eid: string, item: string, orderRef: string) => call("POST", "/api/console/paid", { assertion: await asr({ act: "paid", person: who, eid }), eid, item, orderRef });
const pack = (eid: string) => raw.query("SELECT pack FROM engagement WHERE id=?").get(eid).pack;

describe("payable and paid through the real router", () => {
  beforeEach(async () => { await boot("1"); });
  test("the owner is told the size and that it is unpaid; a stranger learns nothing; after paid it says paid; nothing changes on the question", async () => {
    const a = await organizer("a1@acme.com"), s = await organizer("s1@evil.com"); await game(a, "PVC-ONE");
    const before = pack("PVC-ONE");
    expect(await j(await payable(a.who, "PVC-ONE"))).toMatchObject({ ok: true, owner: true, item: "100", paid: false });
    expect(await j(await payable(s.who, "PVC-ONE"))).toMatchObject({ ok: true, owner: false, item: null, paid: false });
    expect(pack("PVC-ONE")).toBe(before);
    expect((await paid(a.who, "PVC-ONE", "100", "GAME-tictactoe-PVC-ONE")).status).toBe(200);
    expect(await j(await payable(a.who, "PVC-ONE"))).toMatchObject({ owner: true, paid: true });
    expect(await j(await paid(a.who, "PVC-ONE", "100", "GAME-tictactoe-PVC-ONE"))).toMatchObject({ ok: true, repeat: true });
  });
  test("a wrong act, a reused assertion and a forged signature are all 401 on both routes", async () => {
    const a = await organizer("a2@acme.com"); await game(a, "PVC-TWO");
    expect((await call("POST", "/api/console/paid", { assertion: await asr({ act: "payable", person: a.who, eid: "PVC-TWO" }), eid: "PVC-TWO", item: "100", orderRef: "GAME-tictactoe-w1" })).status).toBe(401);
    expect((await call("POST", "/api/console/payable", { assertion: await asr({ act: "paid", person: a.who, eid: "PVC-TWO" }), eid: "PVC-TWO" })).status).toBe(401);
    const tok = await asr({ act: "payable", person: a.who, eid: "PVC-TWO" });
    expect((await call("POST", "/api/console/payable", { assertion: tok, eid: "PVC-TWO" })).status).toBe(200);
    expect((await call("POST", "/api/console/payable", { assertion: tok, eid: "PVC-TWO" })).status).toBe(401);
    const forged = (await buildAssertion(ctx, { act: "paid", person: a.who, eid: "PVC-TWO", mutate: { forge: true } }, ORIGIN, T)).token;
    expect((await call("POST", "/api/console/paid", { assertion: forged, eid: "PVC-TWO", item: "100", orderRef: "GAME-tictactoe-w2" })).status).toBe(401);
    expect(pack("PVC-TWO")).toBe(0);
  });
});

describe("with PAY_VIA_CONSOLE=1 the game takes no payment itself", () => {
  beforeEach(async () => { await boot("1"); });
  test("pay pages go to the console (302); every old pay, pay-link, credit and proforma route of the API answers 410 with the console's address; the webhook is not shut", async () => {
    const o = await organizer("g1@acme.com"), h = { "x-organizer": o.key };
    for (const p of ["/pay.html", "/paylink.html", "/paytest.html"]) { const r = await call("GET", p); expect([p, r.status, r.headers.get("location")]).toEqual([p, 302, "https://console.corporatetambola.com/"]); }
    for (const [m, p] of [["POST", "/api/checkout"], ["POST", "/api/proforma"], ["POST", "/api/payments/test"], ["POST", "/api/payments/paytest"], ["POST", "/api/payments/verify"], ["GET", "/api/org/credit"], ["POST", "/api/z/GAME-0001/pay-with-credit"], ["POST", "/api/z/GAME-0001/paylink"], ["GET", "/api/paylink/" + "a".repeat(48)], ["POST", "/api/paylink/" + "a".repeat(48) + "/checkout"]] as const) {
      const r = await call(m, p, m === "POST" ? {} : undefined, h);
      expect([m, p, r.status]).toEqual([m, p, 410]);
      expect((await j(r)).code).toBe("pay-in-console");
    }
    expect((await call("POST", "/api/payments/webhook", {})).status).not.toBe(410);
    expect((await call("GET", "/api/payments/status")).status).toBe(200);
  });
  test("nothing is opened with Razorpay or the central order service, whatever keys are set", async () => {
    const a = await organizer("g2@acme.com"); await game(a, "PVC-THREE");
    for (const p of ["/api/checkout", "/api/payments/test"]) expect((await call("POST", p, { eid: "PVC-THREE", pack: 100 }, { "x-organizer": a.key })).status).toBe(410);
    expect(outbound.filter((u) => /razorpay|api\/pay\/order/i.test(u))).toEqual([]);
    expect(pack("PVC-THREE")).toBe(0);
  });
  test("the credit-expiry and ledger C jobs are skipped; with the flag off the ledger C job runs", async () => {
    const on: any = await runTick(env as any, T);
    expect(on.ledgerC).toBeNull(); expect(on.creditLapsed).toBeUndefined();
    (env as any).PAY_VIA_CONSOLE = undefined;
    expect(((await runTick(env as any, T)) as any).ledgerC).not.toBeNull();
  });
});

describe("rollback: with the flag off the old path is not shut", () => {
  test("the old routes do not answer 410 or 302", async () => {
    await boot(undefined); const o = await organizer("g3@acme.com");
    for (const p of ["/api/checkout", "/api/proforma"]) expect([410, 302]).not.toContain((await call("POST", p, {}, { "x-organizer": o.key })).status);
    expect([410, 302]).not.toContain((await call("GET", "/api/org/credit", undefined, { "x-organizer": o.key })).status);
  });
});
