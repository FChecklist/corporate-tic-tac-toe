// The new flow's stage log (table ttt_sl, migration 0030) must never get in the way of deleting participant data, whether or not the table exists in the database yet.
// (1) a database WITHOUT ttt_sl: the 24-hour deletion (erasePersonal, here through the Organizer's delete button after the game) still deletes all participant data;
// (2) a database WITH ttt_sl: it also clears the log of that game and leaves the log of another game alone;
// (3) with the table missing and the new flow never switched on, switching it on answers quietly and the log routes say it is off (nothing throws).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200, AFTER = T + 8 * 3_600_000; // one hour after T; and well after the game
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"]; let ipN = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env as any, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => (String(i).padStart(2, "0") + "b".repeat(32)).slice(0, 32);
const count = (sql: string, ...v: unknown[]) => (raw.prepare(sql).get(...(v as any[])) as { c: number }).c;

async function game(id: string) {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `7.8.8.${++ipN}` }, body: JSON.stringify({ email: `o${ipN}@acme.com` }) }), env as any, T));
  const master = st.token as string;
  expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, master)).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, master)).status).toBe(200);
  const r = await call("POST", `/api/z/${id}/join`, { phone: "9100000001", name: "Pat", device: dev(1) }); expect(r.status).toBe(200);
  return master;
}
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", RUNNER_KEY: "test-runner-key-test-runner-key-test0000", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", PHONE_SALT: "salt" }; (globalThis as any).fetch = async () => new Response("{}", { status: 404 }); });
afterEach(() => { globalThis.fetch = realFetch; });

describe("deleting participant data with and without the stage log table", () => {
  test("(1) a database WITHOUT ttt_sl: the participant data is still deleted, and the answer is 200", async () => {
    const master = await game("SLE-1");
    raw.exec("DROP TABLE IF EXISTS ttt_sl");
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name='ttt_sl'").get()).toBeNull();
    expect(count("SELECT COUNT(*) c FROM participant WHERE eid=?", "SLE-1")).toBe(1);
    const r = await call("POST", "/api/z/SLE-1/erase", {}, master, AFTER); expect(r.status).toBe(200);
    expect(count("SELECT COUNT(*) c FROM participant WHERE eid=?", "SLE-1")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM person WHERE eid=?", "SLE-1")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM seat WHERE eid=?", "SLE-1")).toBe(0);
  });
  test("(2) a database WITH ttt_sl: the log of that game is cleared too, the log of another game stays", async () => {
    const master = await game("SLE-2");
    const ins = raw.prepare("INSERT INTO ttt_sl(eid,slot,kind,pid,seq,body,at_ms) VALUES(?,?,?,?,?,?,?)");
    ins.run("SLE-2", "1-1-aaaa-bbbb", "move", "aaaa", 0, "4", T); ins.run("SLE-2", "1-1-aaaa-bbbb", "result", "aaaa", 0, "a", T); ins.run("SLE-OTHER", "1-1-cccc-dddd", "move", "cccc", 0, "0", T);
    expect(count("SELECT COUNT(*) c FROM ttt_sl WHERE eid=?", "SLE-2")).toBe(2);
    const r = await call("POST", "/api/z/SLE-2/erase", {}, master, AFTER); expect(r.status).toBe(200);
    expect(count("SELECT COUNT(*) c FROM participant WHERE eid=?", "SLE-2")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM ttt_sl WHERE eid=?", "SLE-2")).toBe(0);
    expect(count("SELECT COUNT(*) c FROM ttt_sl WHERE eid=?", "SLE-OTHER")).toBe(1);
  });
  test("(3) without the table: switching the new flow on answers quietly (409), and the log routes say it is off", async () => {
    const master = await game("SLE-3");
    raw.exec("DROP TABLE IF EXISTS ttt_sl");
    const on = await call("POST", "/api/z/SLE-3/ttt/stageon", {}, master); expect(on.status).toBe(409); expect((await j(on)).code).toBe("no-stages");
    expect((await call("GET", "/api/z/SLE-3/ttt/stagelog")).status).toBe(404);
    expect((await call("POST", "/api/z/SLE-3/ttt/stagelog", { pid: "x", device: dev(1) })).status).toBe(404);
  });
});
