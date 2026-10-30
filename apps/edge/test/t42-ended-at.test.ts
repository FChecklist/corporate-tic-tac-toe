// TEST AUTHOR v3 (31 Oct 2026). OWNER RULE for the field `endedAtMs` (the real end of the game), written from the rule, not from the product:
//  - phones-confirmed end, or the Organizer ending the game: returned whatever the clock says;
//  - a scheduled end is recomputed at read time (the end bound) and returned only once now >= that bound;
//  - absent while the game can still be live; once returned it never moves;
//  - purging / erasing the people's data is not an end; cancelling is not an end.
// The field is looked for (by name, at any depth) in the public tournament view and in the Organizer's summary. Fake data only.
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import { endBoundMs } from "../src/lifecycle";
import { TttConsole } from "../../../packages/ttt/src/phone";
import { apiFor } from "../../../tools/sim2/phones";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200, START_MS = (GEN + (START - 1) * 3) * 1000;
let env: Env; let raw: ReturnType<typeof makeD1>["raw"]; let n = 0;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => (i.toString(16).padStart(4, "0")).repeat(8);
const sql = (q: string, ...a: unknown[]) => raw.query(q).all(...(a as any[])) as any[];
const find = (o: any, key: string): unknown => { if (o && typeof o === "object") { if (key in o) return o[key]; for (const v of Object.values(o)) { const f = find(v, key); if (f !== undefined) return f; } } return undefined; };

async function game(id: string) {
  const r = await j(await call("POST", "/api/start", { email: `o${++n}@acme.com` }, { "cf-connecting-ip": `10.0.0.${n}` }));
  const org = { "x-organizer": r.token as string };
  expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, org)).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, org)).status).toBe(200);
  raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]);
  return { org };
}
async function joinAll(id: string, count: number) { for (let i = 1; i <= count; i++) expect((await call("POST", `/api/z/${id}/join`, { name: `Player ${i}`, device: dev(i) })).status).toBe(200); }
async function begin(id: string, org: Record<string, string>) {
  expect((await call("POST", `/api/z/${id}/ttt/start`, {}, org)).status).toBe(200);
  const clock = { t: T }; expect((await new TttConsole(apiFor(call, clock, org), id).tick()).sentPlan).toBe(true); return { clock };
}
/** what the two readers say at `now`: the public tournament view and the Organizer's summary */
const readEnded = async (id: string, org: Record<string, string>, now: number) => [
  find(await j(await call("GET", `/api/z/${id}/ttt/view`, undefined, {}, now)), "endedAtMs"),
  find(await j(await call("GET", `/api/z/${id}/summary`, undefined, org, now)), "endedAtMs"),
];
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000000", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k" } as Env; n = 0; });

describe("endedAtMs (OWNER RULE)", () => {
  test("OWNER RULE: absent while the game can still be live (not started, and running)", async () => {
    const h = await game("EA-1"); await joinAll("EA-1", 4);
    expect(await readEnded("EA-1", h.org, T)).toEqual([undefined, undefined]);
    const { clock } = await begin("EA-1", h.org); clock.t += 5000;
    expect(await readEnded("EA-1", h.org, clock.t)).toEqual([undefined, undefined]);
  });
  test("OWNER RULE: the Organizer ends the game at 11:00:05 -> endedAtMs is that instant, whatever the clock, and it does not move on later reads", async () => {
    const h = await game("EA-2"); await joinAll("EA-2", 4); const { clock } = await begin("EA-2", h.org); clock.t += 5000;
    expect((await call("POST", "/api/z/EA-2/ttt/end", {}, h.org, clock.t)).status).toBe(200);
    const endAt = clock.t;
    for (const later of [endAt, endAt + 1, endAt + 59_999, endAt + 60_000, endAt + 3_600_000, endAt + 30 * 86_400_000]) expect([later - endAt, await readEnded("EA-2", h.org, later)]).toEqual([later - endAt, [endAt, endAt]]);
    const again = await call("POST", "/api/z/EA-2/ttt/end", {}, h.org, endAt + 9000); expect((await j(again)).again).toBe(true); expect(await readEnded("EA-2", h.org, endAt + 9000)).toEqual([endAt, endAt]); // ending twice does not move it
  });
  test("OWNER RULE: the phones confirm the end (tournament finished) -> endedAtMs is the moment it finished, returned at once", async () => {
    const h = await game("EA-3"); await joinAll("EA-3", 4); const { clock } = await begin("EA-3", h.org);
    const done = T + 17 * 60_000; raw.run("UPDATE ttt_t SET state='done', ended_ms=? WHERE eid=?", [done, "EA-3"]);
    expect(sql("SELECT ended_ms FROM ttt_t WHERE eid='EA-3'")[0].ended_ms).toBe(done);
    for (const now of [done, done + 1, done + 59_999, done + 60_000, done + 86_400_000]) expect([now - done, await readEnded("EA-3", h.org, now)]).toEqual([now - done, [done, done]]);
    expect(clock.t).toBe(T);
  });
  test("OWNER RULE: a scheduled end (the game ran out its time, nobody ended it) is recomputed at read time and returned only once now >= the bound; then it never moves", async () => {
    const h = await game("EA-4"); await joinAll("EA-4", 4);
    const e = raw.query("SELECT * FROM engagement WHERE id=?").get("EA-4"); const bound = await endBoundMs(env as any, e);
    expect(bound).toBeGreaterThan(START_MS);
    expect(await readEnded("EA-4", h.org, bound - 1)).toEqual([undefined, undefined]);
    for (const now of [bound, bound + 1, bound + 3_600_000, bound + 20 * 86_400_000]) expect([now - bound, await readEnded("EA-4", h.org, now)]).toEqual([now - bound, [bound, bound]]);
  });
  test("OWNER RULE: erasing the people's data before the game is not an end; the field stays absent", async () => {
    const h = await game("EA-5"); await joinAll("EA-5", 3);
    expect((await call("POST", "/api/z/EA-5/erase", {}, h.org, T)).status).toBe(200);
    expect(await readEnded("EA-5", h.org, T)).toEqual([undefined, undefined]); expect(await readEnded("EA-5", h.org, T + 1000)).toEqual([undefined, undefined]);
  });
  test("OWNER RULE: cancelling is not an end; the field stays absent", async () => {
    const h = await game("EA-6"); await joinAll("EA-6", 3);
    const r = await call("POST", "/api/z/EA-6/cancel", { confirmations: 3 }, h.org, T); expect(r.status).toBe(200);
    expect(await readEnded("EA-6", h.org, T)).toEqual([undefined, undefined]); expect(await readEnded("EA-6", h.org, T + 86_400_000)).toEqual([undefined, undefined]);
  });
});
