// Review finding 4 of the join-redesign WIP: the people CSV put a formula-guard apostrophe before every foreign number (+44...),
// so a re-upload of the exported list read a different number. A plain international number is not a formula and must come out exactly as stored;
// a real formula in a name is still guarded.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200;
let env: PayEnv; let ipN = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;

async function setup() {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `8.8.8.${++ipN}` }, body: JSON.stringify({ email: `o${ipN}@acme.com` }) }), env as Env, T));
  const master = st.token as string;
  await call("POST", "/api/z", { id: "CSV-1", startRound: START, callSeconds: 6, cap: 100, whoCanJoin: "list" }, master);
  await call("POST", "/api/z/CSV-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, master);
  return master;
}
beforeEach(() => { const d = makeD1(); env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://tictactoe.test", PHONE_SALT: "salt" } as any; (globalThis as any).fetch = async () => new Response("{}"); });
afterEach(() => { globalThis.fetch = realFetch; });

describe("people CSV", () => {
  test("a foreign number comes out as +<code><number>, not with a formula apostrophe; a formula-looking name never starts a cell with a formula sign", async () => {
    const master = await setup();
    const add = await call("POST", "/api/z/CSV-1/people", { people: [{ name: "Tom", phone: "+447911123456" }, { name: "=HYPERLINK(1)", phone: "9100000002" }] }, master);
    expect(add.status).toBe(200);
    const csv = await (await call("GET", "/api/z/CSV-1/people/export", undefined, master)).text();
    expect(csv).toContain(",+447911123456,");
    expect(csv).not.toContain("'+447911123456");
    expect(csv).not.toMatch(/(^|\r\n|,)=/); // the name is cleaned of the leading "=" before it is stored; either way no cell starts with a formula sign
  });
});
