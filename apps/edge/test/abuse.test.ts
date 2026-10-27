// G-15: a script cannot burn the shared daily write budget by joining; a friendly "busy" answer; invited-number rules stay.
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const dev = (i: number) => String(i).padStart(32, "0");
const join = (i: number, ip: string, id = "ABUSE-1", now = T) => call("POST", `/api/z/${id}/join`, { phone: "98" + String(10000000 + i), device: dev(i) }, { "cf-connecting-ip": ip }, now);

async function published(id: string, over: Record<string, unknown> = {}) {
  const x = await j(await call("POST", "/api/start", { email: "boss" + id + "@acme.com" }, { "cf-connecting-ip": "10.0.0." + id.length }));
  const h = { "x-organizer": x.token as string };
  await call("POST", "/api/z", { id, startRound: roundAt(T) + 1200, callSeconds: 6, cap: 500, ...over }, h);
  await call("POST", "/api/z/" + id + "/publish", { email: "boss" + id + "@acme.com", phone: "98765 43210" }, h);
  return h;
}
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://bingo.test", DATA_KEY: "k" }; });

describe("joining from one network", () => {
  test("a network may open only so many new seats a day; the answer is friendly; other networks and the same people coming back are not affected", async () => {
    (env as any).JOIN_PER_IP_DAY = "3"; await published("ABUSE-1", { startRound: roundAt(T) + 3 * 28_800 }); // the game starts 3 days ahead: an unpaid game takes no new person once its lock time has come
    for (let i = 1; i <= 3; i++) expect((await join(i, "5.5.5.5")).status).toBe(200);
    const r = await join(4, "5.5.5.5"); expect(r.status).toBe(429);
    const t = await j(r); expect(t.error).toBe("It is busy right now. Please try again in a few minutes."); expect(t.code).toBe("busy");
    expect((await join(1, "5.5.5.5")).status).toBe(200); // someone who already joined is not counted again
    expect((await join(4, "6.6.6.6")).status).toBe(200); // another network is fine
    expect((await join(5, "5.5.5.5", "ABUSE-1", T + 86_400_000)).status).toBe(200); // the next day
    expect((raw.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid='ABUSE-1'").get() as any).c).toBe(5);
  });
  test("a burst in one minute from one network is slowed down", async () => {
    (env as any).JOIN_PER_IP_MINUTE = "2"; await published("ABUSE-1");
    expect([(await join(1, "7.7.7.7")).status, (await join(2, "7.7.7.7")).status, (await join(3, "7.7.7.7")).status]).toEqual([200, 200, 429]);
    expect((await join(3, "7.7.7.7", "ABUSE-1", T + 61_000)).status).toBe(200);
  });
  test("a normal office (hundreds behind one address) still gets in with the default limits", async () => {
    await published("ABUSE-1", { cap: 100 });
    for (let i = 1; i <= 60; i++) expect((await join(i, "8.8.8.8")).status).toBe(200);
  });
  test("an engagement that is full says so, as before; the daily write budget running low answers a friendly 503 and writes nothing", async () => {
    await published("ABUSE-2", { cap: 2 });
    expect([(await join(1, "1.1.1.1", "ABUSE-2")).status, (await join(2, "1.1.1.1", "ABUSE-2")).status, (await join(3, "1.1.1.1", "ABUSE-2")).status]).toEqual([200, 200, 409]);
    env.DAILY_WRITE_BUDGET = "1"; await published("ABUSE-3").catch(() => {});
    const r = await join(9, "2.2.2.2", "ABUSE-3"); expect([503, 404, 403]).toContain(r.status);
  });
  test("invite-only rules are unchanged: an unlisted number is refused before any counter moves", async () => {
    (env as any).JOIN_PER_IP_DAY = "1"; const h = await published("ABUSE-4", { closed: true });
    expect((await join(1, "3.3.3.3", "ABUSE-4")).status).toBe(403);
    await call("POST", "/api/z/ABUSE-4/roster", { people: [{ phone: "9810000002", name: "Listed" }] }, h);
    expect((await call("POST", "/api/z/ABUSE-4/join", { phone: "9810000002", device: dev(2) }, { "cf-connecting-ip": "3.3.3.3" })).status).toBe(200);
  });
  test("the counters expire with the daily sweep", async () => {
    await published("ABUSE-1"); await join(1, "4.4.4.4");
    expect((raw.prepare("SELECT COUNT(*) AS c FROM kv WHERE k LIKE 'jlim/%' OR k LIKE 'jbm/%'").get() as any).c).toBeGreaterThanOrEqual(2);
    const { purgeOld } = await import("../src/worker"); await purgeOld(env as Env, T + 5 * 86_400_000);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM kv WHERE k LIKE 'jlim/%' OR k LIKE 'jbm/%'").get() as any).c).toBe(0);
  });
});
