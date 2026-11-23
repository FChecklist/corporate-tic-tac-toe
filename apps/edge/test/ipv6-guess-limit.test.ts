// The wrong-employee-ID limit (30 per network per 10 minutes) counts an IPv6 visitor by the first 64 bits of the address (their /64),
// so changing the address inside their own /64 does not give a fresh allowance. IPv4 behaves as before.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle, consentFor } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200;
let env: PayEnv; let ipN = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, key?: string, h: Record<string, string> = {}) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}), ...h }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, T);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => (String(i).padStart(2, "0") + "b".repeat(32)).slice(0, 32);
const tryId = (i: number, ip: string) => call("POST", "/api/z/IPV-1/join", { empId: "X" + (900 + i), name: "G" + i, device: dev(i) }, undefined, { "cf-connecting-ip": ip });
const whoId = (i: number, ip: string) => call("POST", "/api/z/IPV-1/who", { empId: "Y" + (500 + i), consent: consentFor("K4") }, undefined, { "cf-connecting-ip": ip });

async function setup() {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.7.${++ipN}` }, body: JSON.stringify({ email: `o${ipN}@acme.com` }) }), env as Env, T));
  const master = st.token as string;
  await call("POST", "/api/z", { id: "IPV-1", startRound: START, callSeconds: 6, cap: 100 }, master);
  await call("POST", "/api/z/IPV-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, master);
  expect((await call("PATCH", "/api/z/IPV-1/settings", { verify: "id", employeesOnly: true }, master)).status).toBe(200);
  expect((await call("POST", "/api/z/IPV-1/people", { people: [{ name: "Asha", empId: "E101" }] }, master)).status).toBe(200);
}
beforeEach(async () => { const d = makeD1(); env = { DB: d.db, ORGANIZER_SECRET: "plat", RUNNER_KEY: "test-runner-key-test-runner-key-test0000", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://tictactoe.test", PHONE_SALT: "salt" }; (globalThis as any).fetch = async () => new Response("{}", { status: 404 }); await setup(); });
afterEach(() => { globalThis.fetch = realFetch; });

describe("wrong employee IDs are limited per network, IPv6 by its /64", () => {
  test("join: 30 wrong IDs from 30 different addresses in one /64 close the door for that /64; another /64 and an IPv4 address are not affected", async () => {
    for (let i = 0; i < 30; i++) expect((await tryId(i, `2001:db8:1:2:${(i + 1).toString(16)}:ab:cd:ef`)).status).toBe(403);
    const next = await tryId(31, "2001:db8:1:2:ffff:1:2:3"); expect(next.status).toBe(429); expect((await j(next)).code).toBe("too-many-tries");
    expect((await tryId(32, "2001:db8:1:3:1:1:1:1")).status).toBe(403); // a different /64
    expect((await tryId(33, "203.0.113.7")).status).toBe(403); // IPv4 has its own counter
  });
  test("join: IPv4 still counts per address (31st wrong ID from one address is refused, another address is not)", async () => {
    for (let i = 0; i < 30; i++) expect((await tryId(i, "198.51.100.4")).status).toBe(403);
    expect((await tryId(40, "198.51.100.4")).status).toBe(429);
    expect((await tryId(41, "198.51.100.5")).status).toBe(403);
  });
  test("\"Is this you?\": the same /64 shares one counter, so addresses cannot be rotated to walk through IDs", async () => {
    for (let i = 0; i < 30; i++) { const r = await whoId(i, `2001:db8:9:9:${(i + 1).toString(16)}::1`); expect(r.status).toBe(200); expect((await j(r)).known).toBe(false); }
    expect((await whoId(31, "2001:db8:9:9:aaaa::2")).status).toBe(429);
    expect((await whoId(32, "2001:db8:9:8::2")).status).toBe(200);
  });
});
