// The three payment pages (pay, paylink, paytest) and the Worker answers behind them (docs: Boss order 2 Nov 2026, "payment pages redesign", pilot on Bingo):
//   - the Rs 1 / US$ 1 test is open to everybody: no key, no game lookup (the tests of that are in payfirst.test.ts)
//   - the game block (name, game ID, participants, start time, organizer with a MASKED e-mail) comes from the server for the pay link
//   - the browser field names (payfields.js) are exactly the Worker's (payfields.ts), so the work that records the game ID on a payment merges without touching these lines
// Everything runs through the real Worker with a real SQLite D1.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { PAY_FIELDS, GAME_ID_RE } from "../src/payfields";
import { maskEmail } from "../src/paysummary";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 8, 10, 0, 0), H = 3_600_000;
const START = Math.floor(((T + 3 * H) / 1000 - 1692803367) / 3) + 1; // the game starts 3 hours after T
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ipN = 0;
const call = (method: string, path: string, body?: unknown, key?: string, extra: Record<string, string> = {}) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": "2.2.2.2", ...(key ? { "x-organizer": key } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, T);
const j = async (r: Response) => (await r.json()) as any;

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", RUNNER_KEY: "test-runner-key-test-runner-key-test0000", DAILY_WRITE_BUDGET: "1000000", RAZORPAY_KEY_ID: "rzp_test_x", RAZORPAY_KEY_SECRET: "sek", RAZORPAY_WEBHOOK_SECRET: "whsec", RAZORPAY_BASE_URL: "https://rzp.test/v1", PUBLIC_ORIGIN: "https://bingo.test", OWNER_EMAIL: "owner@platform.test", DATA_KEY: "dk" } as PayEnv;
});
afterEach(() => {});

/** An organizer with one game, GAME-ONE (300 people), named "Diwali Bingo". */
const organizer = async () => {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `9.9.9.${++ipN}` }, body: JSON.stringify({ email: "jaya.menon@company.com" }) }), env as Env, T));
  const master = st.token as string;
  const made = await call("POST", "/api/z", { id: "GAME-ONE", startRound: START, callSeconds: 9, cap: 300, name: "Diwali Bingo" }, master);
  expect(made.status, JSON.stringify(await made.clone().json())).toBe(200);
  return master;
};

describe("the field names", () => {
  test("the browser file lists exactly the field names the Worker uses (payfields.js = payfields.ts)", () => {
    const win: any = {}; new Function("window", readFileSync(new URL("../../web/public/payfields.js", import.meta.url), "utf8"))(win);
    expect(win.PAYFIELDS).toBeDefined();
    expect({ ...win.PAYFIELDS }).toEqual({ ...PAY_FIELDS });
    expect(PAY_FIELDS.gameId).toBe("gameId");
  });
  test("a game ID is 4 to 40 letters, digits, - or _", () => {
    for (const ok of ["ABCD", "GAME-ONE", "acme_diwali-2026", "x".repeat(40)]) expect([ok, GAME_ID_RE.test(ok)]).toEqual([ok, true]);
    for (const bad of ["abc", "", "x".repeat(41), "has space", "a/b/c/d", "é-game"]) expect([bad, GAME_ID_RE.test(bad)]).toEqual([bad, false]);
  });
});

describe("masking the organizer's e-mail", () => {
  test("first letter, three stars, the domain; anything that is not an address gives nothing", () => {
    expect(maskEmail("jaya.menon@company.com")).toBe("j***@company.com");
    expect(maskEmail("  Rajat@x.in ")).toBe("R***@x.in");
    for (const bad of ["", "nobody", "@x.com", "a@", null, undefined, 42]) expect([String(bad), maskEmail(bad)]).toEqual([String(bad), ""]);
  });
});

describe("the payment-link page gets the same game block", () => {
  test("GET /api/paylink/<token> carries the game ID and the masked organizer, and still the price and status as before; no full address, no discount word", async () => {
    const k = await organizer();
    raw.prepare("INSERT INTO kv(k,v) VALUES(?,?)").run("contact/GAME-ONE", JSON.stringify({ name: "Jaya Menon", email: "jaya.menon@company.com" }));
    const l = await j(await call("POST", "/api/z/GAME-ONE/paylink", {}, k));
    const token = new URL(l.url).searchParams.get("t")!;
    const r = await call("GET", `/api/paylink/${token}`);
    const b = await j(r); expect(r.status, JSON.stringify(b)).toBe(200);
    expect(b.game).toMatchObject({ id: "GAME-ONE", name: "Diwali Bingo", organizer: { name: "Jaya Menon", email: "j***@company.com" } });
    expect(b.status).toBe("open"); expect(b.price.total).toBeGreaterThan(0);
    const text = JSON.stringify(b);
    expect(text).not.toContain("jaya.menon@company.com"); expect(text).not.toMatch(/coupon|discount|reduced/i);
  });
  test("the same link priced for another country: ?currency=USD gives the US-dollar price and no GST (the page asks again when the country changes)", async () => {
    const k = await organizer();
    const l = await j(await call("POST", "/api/z/GAME-ONE/paylink", {}, k));
    const token = new URL(l.url).searchParams.get("t")!;
    const inr = await j(await call("GET", `/api/paylink/${token}`)), usd = await j(await call("GET", `/api/paylink/${token}?currency=USD`));
    expect(inr.price.currency).toBe("INR"); expect(usd.price).toMatchObject({ currency: "USD", total: 67, base: 67, gst: 0 }); // a 300-person game is the 500 pack: US$ 67
    expect(usd.game.id).toBe("GAME-ONE"); expect(usd.status).toBe("open");
  });
});
