// Shared set-up for the table-driven suite (param-*.test.ts). Everything runs against the real Worker code (handle()), the in-memory SQLite stand-in for D1,
// the mail log (the `outbox` table is the fake mailbox) and a stand-in for Razorpay's REST API. No browser, no network.
// One mutable world `W` is rebuilt before every test (reset()), so a test file only needs `beforeEach(reset); afterEach(restore)`.
import { createHmac } from "node:crypto";
import { expect } from "bun:test";
import { handle as realHandle, type Env } from "../src/worker";
import { handle } from "./with-terms";
import { withDevice } from "./device";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";
import { resetRate } from "../src/visits";

export const T = Date.UTC(2026, 9, 1, 10, 0, 0); // 15:30 IST on 1 Oct 2026
export const GEN = 1692803367;
export const HOUR = 3_600_000, DAY = 86_400_000, MIN = 60_000;
export const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
export const roundMs = (r: number) => (GEN + (r - 1) * 3) * 1000;
/** The start round of a game that begins `ms` after T (rounded down to a 3-second round). */
export const startIn = (ms: number) => roundAt(T + ms);
export const realFetch = globalThis.fetch;

export interface World { env: PayEnv; raw: ReturnType<typeof makeD1>["raw"]; orders: any[]; payments: Record<string, any>; ip: number }
export const W: World = { env: null as any, raw: null as any, orders: [], payments: {}, ip: 0 };

export function reset(extra: Partial<PayEnv> = {}) {
  try { W.raw?.close(); } catch { /* none yet */ }
  const d = makeD1(); W.raw = d.raw; W.orders = []; W.payments = {}; W.ip = 0; resetRate();
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.startsWith("https://rzp.test/v1/orders")) { const b = JSON.parse(init.body); const o = { id: "order_" + (W.orders.length + 1), amount: b.amount, currency: b.currency, receipt: b.receipt, status: "created" }; W.orders.push(o); return new Response(JSON.stringify(o), { status: 200 }); }
    const pm = u.match(/\/payments\/([^/]+)(\/capture)?$/);
    if (pm) { const p = W.payments[pm[1]!]; if (!p) return new Response(JSON.stringify({ error: { description: "no such payment" } }), { status: 404 }); if (pm[2]) p.status = "captured"; return new Response(JSON.stringify(p), { status: 200 }); }
    return new Response("{}", { status: 404 });
  };
  W.env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "10000000", DATA_KEY: "dk", PHONE_SALT: "salt", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://tictactoe.test", ...extra } as PayEnv;
}
export function restore() { globalThis.fetch = realFetch; try { W.raw?.close(); } catch { /* already closed */ } } // closing the in-memory database after each test keeps a run of ~900 tests small

export const PLAT = { "x-organizer": "plat" };
export const keyH = (k?: string): Record<string, string> => (k ? { "x-organizer": k } : {});
export const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), W.env as Env, now);
/** The same call, but through the real handler with no consent ticks added (for proving what the server refuses). */
export const callRaw = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T, waitUntil?: (p: Promise<unknown>) => void) =>
  realHandle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), W.env as Env, now, waitUntil);
export const j = async (r: Response) => (await r.json().catch(() => ({}))) as any;
export const q = (sql: string, ...a: any[]) => W.raw.prepare(sql).all(...a) as any[];
export const one = (sql: string, ...a: any[]) => W.raw.prepare(sql).get(...a) as any;
export const mails = (to?: string) => (to ? q("SELECT * FROM outbox WHERE to_addr=? ORDER BY id", to) : q("SELECT * FROM outbox ORDER BY id"));

/** A new organizer account by e-mail (the console opens at once). Returns the master key and the lasting AI key. */
export async function organizer(email = `org${++W.ip}x${Math.floor(Math.random() * 1e6)}@acme.com`) {
  const r = await call("POST", "/api/start", { email }, { "cf-connecting-ip": `8.8.${Math.floor(W.ip / 250)}.${(++W.ip % 250) + 1}` });
  const b = await j(r); expect(r.status).toBe(200); expect(b.token).toMatch(/^cbk_/);
  return { key: b.token as string, h: keyH(b.token), ai: b.aiKey as string, aiH: keyH(b.aiKey), email };
}
let n = 0;
export const uid = (p = "PRM") => `${p}-${(++n).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.slice(0, 40);
export const eng = (id: string, over: Record<string, unknown> = {}) => ({ id, startRound: startIn(2 * HOUR), callSeconds: 6, cap: 100, ...over });
/** Create a game as `key` (draft unless an entitlement exists). */
export const create = (key: string | undefined, id: string, over: Record<string, unknown> = {}, now = T) => call("POST", "/api/z", eng(id, over), key ? keyH(key) : PLAT, now);
export const contact = { email: "boss@acme.com", phone: "98765 43210" };
export const publish = (key: string, id: string, body: Record<string, unknown> = contact, now = T) => call("POST", `/api/z/${id}/publish`, body, keyH(key), now);

export const hmac = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("hex");
/** Start a checkout for a game (or a bare pack) and return the response JSON. */
export async function checkout(key: string | undefined, body: Record<string, unknown>, now = T) {
  const r = await call("POST", "/api/checkout", { org: "Acme Ltd", email: "boss@acme.com", country: "IN", taxId: "", currency: "INR", ...body }, key ? keyH(key) : {}, now);
  return { status: r.status, body: await j(r) };
}
export const verify = (c: any, payId = "pay_1", over: Record<string, unknown> = {}, now = T) => {
  const orderId = c.razorpay.orderId;
  return call("POST", "/api/payments/verify", { paymentId: c.paymentId, razorpay_order_id: orderId, razorpay_payment_id: payId, razorpay_signature: hmac("sek", `${orderId}|${payId}`), ...over }, {}, now);
};
/** The gateway reports payment `payId` as captured for the order of checkout `c`. */
export const capture = (c: any, payId = "pay_1", over: Record<string, unknown> = {}) => {
  W.payments[payId] = { id: payId, order_id: c.razorpay.orderId, status: "captured", amount: W.orders.find((o) => o.id === c.razorpay.orderId)!.amount, ...over };
};
/** Create a draft as a fresh organizer, publish it and pay for it. Returns everything a test needs. */
export async function paidGame(opts: { id?: string; cap?: number; over?: Record<string, unknown>; email?: string; payNow?: number } = {}) {
  const o = await organizer(opts.email ?? `o${++n}@acme.com`);
  const id = opts.id ?? uid();
  const r = await create(o.key, id, { cap: opts.cap ?? 100, ...(opts.over ?? {}) });
  expect(r.status).toBe(200);
  expect((await publish(o.key, id)).status).toBe(200);
  if ((opts.cap ?? 100) <= 10) return { ...o, id, c: null as any, v: {} as any }; // a game of up to 10 people is free: publishing is all it needs (no payment to make)
  const c = await checkout(o.key, { eid: id, email: o.email }, opts.payNow ?? T);
  expect(c.status).toBe(200);
  capture(c.body, "pay_" + id);
  const v = await verify(c.body, "pay_" + id, {}, opts.payNow ?? T);
  expect(v.status).toBe(200);
  return { ...o, id, c: c.body, v: await j(v) };
}
export const mob = (i: number) => "9" + String(100000000 + i);
export const dev = (i: number) => (String(i).padStart(2, "0") + "b".repeat(32)).slice(0, 32);
export const join = (id: string, i: number, extra: Record<string, unknown> = {}, now = T) => call("POST", `/api/z/${id}/join`, { phone: mob(i), name: "Guest " + i, device: dev(i), ...extra }, {}, now);
