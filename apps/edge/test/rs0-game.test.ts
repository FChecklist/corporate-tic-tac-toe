// The Rs 0 game: a real game for up to 10 people, published without a payment (worker.ts publish, FREE_GAME_CAP in pay.ts).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { normEmp, empHashOf } from "../src/people";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200; // one hour after T
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ipN = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const mob = (i: number) => "9" + String(100000000 + i);
const dev = (i: number) => (String(i).padStart(2, "0") + "b".repeat(32)).slice(0, 32);
const join = (id: string, body: Record<string, unknown>, now = T) => call("POST", `/api/z/${id}/join`, body, undefined, now);
const joinAs = (id: string, i: number, extra: Record<string, unknown> = {}, now = T) => join(id, { phone: mob(i), name: "G" + i, device: dev(i), ...extra }, now);
const rowsOf = (sql: string, ...v: unknown[]) => raw.prepare(sql).all(...(v as any[])) as any[];

const mk = async (id: string, cap: number) => {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.8.${++ipN}` }, body: JSON.stringify({ email: `r${ipN}@acme.com` }) }), env as Env, T));
  await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap }, st.token);
  return st.token as string;
};

beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://tictactoe.test", PHONE_SALT: "salt" }; (globalThis as any).fetch = async () => new Response("{}", { status: 200 }); });
afterEach(() => { globalThis.fetch = realFetch; });

describe("the Rs 0 game (up to 10 people)", () => {
  test("publishes with no payment and no purchase, shows as paid with nothing marking it as a demo, and is not held at its start time", async () => {
    const key = await mk("RS0-1", 10);
    const pub = await j(await call("POST", "/api/z/RS0-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, key));
    expect(pub.published).toBe(true); expect(pub.paid).toBe(true);
    const s = await j(await call("GET", "/api/z/RS0-1/summary", undefined, key));
    expect(s.paid).toBe(true); expect(s.rs0).toBe(true); expect(s.status).toBe("published and paid"); expect(s.demo).toBeUndefined();
    const info = await j(await call("GET", "/api/z/RS0-1/info", undefined, undefined, START * 3000 + Date.UTC(2023, 7, 23)));
    expect(info.locked).toBeFalsy(); expect(info.unpaid).toBeFalsy();
  });
  test("it never uses up a bought pack, and a bigger game still has to be paid for", async () => {
    const key = await mk("RS0-2", 11);
    await call("POST", "/api/z/RS0-2/publish", { email: "boss@acme.com", phone: "98765 43210" }, key);
    const s = await j(await call("GET", "/api/z/RS0-2/summary", undefined, key));
    expect(s.paid).toBe(false); expect(s.rs0).toBeUndefined();
    const small = await mk("RS0-3", 10); await call("POST", "/api/z/RS0-3/publish", { email: "boss@acme.com", phone: "98765 43210" }, small);
    const up = await call("PATCH", "/api/z/RS0-3/settings", { cap: 50 }, small);
    expect(up.status).toBe(402); expect((await j(up)).error).toContain("Rs 0");
  });
});
