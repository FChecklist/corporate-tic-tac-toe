// O7: the Organizer or a Host can End the tournament. The server only stores that it is over (no champion, no ranking, any pause closed, the deletion clock started);
// every phone reads "ended" and stops, the big screen says so, and nobody else can end it. Real Worker routes, real phone engine (packages/ttt/src/phone.ts).
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import { ENDED_MESSAGE, TttConsole, TttPhone } from "../../../packages/ttt/src/phone";
import { apiFor } from "../../../tools/sim2/phones";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200;
let env: Env; let raw: ReturnType<typeof makeD1>["raw"]; let n = 0;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => (i.toString(16).padStart(4, "0")).repeat(8);
interface P { pid: string; device: string; name: string }
const sql = (q: string, ...a: unknown[]) => raw.query(q).all(...(a as any[])) as any[];

async function game(id: string) {
  const r = await j(await call("POST", "/api/start", { email: `o${++n}@acme.com` }, { "cf-connecting-ip": `10.0.0.${n}` }));
  const org = { "x-organizer": r.token as string };
  expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, org)).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, org)).status).toBe(200);
  raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]);
  return { org, ai: r.aiKey as string };
}
async function joinAll(id: string, count: number): Promise<P[]> {
  const out: P[] = [];
  for (let i = 1; i <= count; i++) { const name = `Player ${i}`; const r = await call("POST", `/api/z/${id}/join`, { name, device: dev(i) }); expect(r.status).toBe(200); out.push({ pid: (await j(r)).pid, device: dev(i), name }); }
  return out;
}
async function begin(id: string, org: Record<string, string>) {
  expect((await call("POST", `/api/z/${id}/ttt/start`, {}, org)).status).toBe(200);
  const clock = { t: T }; const con = new TttConsole(apiFor(call, clock, org), id);
  expect((await con.tick()).sentPlan).toBe(true);
  return { clock };
}
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000000", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k" } as Env; n = 0; });

describe("O7: End the tournament", () => {
  test("the Organizer ends a running tournament: it is over for everybody, with no champion and no ranking, and every phone says so", async () => {
    const h = await game("EN-1"); const ps = await joinAll("EN-1", 4); const { clock } = await begin("EN-1", h.org);
    const mk = (p: P) => new TttPhone({ api: apiFor(call, clock), eid: "EN-1", pid: p.pid, device: p.device, now: () => clock.t });
    const phones = ps.map(mk); clock.t += 5000;
    for (const p of phones) expect((await p.tick()).phase).toBe("playing"); // the games are on
    const r = await call("POST", "/api/z/EN-1/ttt/end", {}, h.org, clock.t); expect(r.status).toBe(200); expect(await j(r)).toEqual({ ok: true, ended: true });
    const v = await j(await call("GET", "/api/z/EN-1/ttt/view", undefined, {}, clock.t));
    expect(v.state).toBe("done"); expect(v.endedEarly).toBe(true); expect(v.champion).toBeFalsy(); expect(v.paused).toBe(false);
    clock.t += 3000;
    for (const p of phones) { const t = await p.tick(); expect(t.phase).toBe("ended"); expect(t.message).toBe(ENDED_MESSAGE); } // every phone stops at once
    const fresh = await mk(ps[0]!).tick(); expect(fresh.phase).toBe("ended"); // and a phone that is opened now
    expect((await j(await call("GET", "/api/z/EN-1/ttt/rank", undefined, {}, clock.t))).ranking).toEqual([]); // nobody was ranked
    expect(sql("SELECT COUNT(*) c FROM winner WHERE eid='EN-1'")[0].c).toBe(0);
  });
  test("a move sent after the end is refused; the deletion clock starts from the moment of the end", async () => {
    const h = await game("EN-2"); const ps = await joinAll("EN-2", 4); const { clock } = await begin("EN-2", h.org);
    clock.t += 5000;
    const p0 = new TttPhone({ api: apiFor(call, clock), eid: "EN-2", pid: ps[0]!.pid, device: ps[0]!.device, now: () => clock.t }); const view0 = await p0.tick();
    expect((await call("POST", "/api/z/EN-2/ttt/end", {}, h.org, clock.t)).status).toBe(200);
    const mid = view0.board?.mid ?? "r1m0";
    const mv = await call("POST", "/api/z/EN-2/ttt/move", { pid: ps[0]!.pid, device: ps[0]!.device, mid, seq: 1, sq: 4, client_ms: 1 }, {}, clock.t + 1000);
    expect(mv.status).toBe(409); expect((await j(mv)).code).toBe("done");
    expect(sql("SELECT end_ms, end_src FROM life WHERE eid='EN-2'")).toEqual([{ end_ms: T + 5000, end_src: "phones" }]);
    expect(sql("SELECT state, ended_ms FROM ttt_t WHERE eid='EN-2'")).toEqual([{ state: "done", ended_ms: T + 5000 }]);
  });
  test("ending while paused closes the pause", async () => {
    const h = await game("EN-3"); await joinAll("EN-3", 4); const { clock } = await begin("EN-3", h.org);
    clock.t += 4000; expect((await call("POST", "/api/z/EN-3/ttt/pause", {}, h.org, clock.t)).status).toBe(200);
    clock.t += 9000; expect((await call("POST", "/api/z/EN-3/ttt/end", {}, h.org, clock.t)).status).toBe(200);
    expect(sql("SELECT from_ms, to_ms FROM ttt_z WHERE eid='EN-3'")).toEqual([{ from_ms: T + 4000, to_ms: T + 13_000 }]);
    expect(sql("SELECT pause_at FROM ttt_t WHERE eid='EN-3'")[0].pause_at).toBeNull();
  });
  test("only the Organizer or a Host can end it: a stranger, a player, the AI key and a wrong key are refused and the tournament goes on", async () => {
    const h = await game("EN-4"); const ps = await joinAll("EN-4", 4); const { clock } = await begin("EN-4", h.org);
    for (const hdr of [{}, { "x-organizer": h.ai }, { "x-organizer": "cbk_" + "0".repeat(48) }, { "x-organizer": "wrong" }] as Record<string, string>[]) { const r = await call("POST", "/api/z/EN-4/ttt/end", {}, hdr, clock.t); expect([hdr, r.status >= 400]).toEqual([hdr, true]); }
    const asPlayer = await call("POST", "/api/z/EN-4/ttt/end", { pid: ps[0]!.pid, device: ps[0]!.device }, {}, clock.t); expect(asPlayer.status).toBeGreaterThanOrEqual(400);
    expect((await j(await call("GET", "/api/z/EN-4/ttt/view", undefined, {}, clock.t))).state).toBe("running");
  });
  test("before the start there is nothing to end; ending twice changes nothing", async () => {
    const h = await game("EN-5"); await joinAll("EN-5", 4);
    const early = await call("POST", "/api/z/EN-5/ttt/end", {}, h.org); expect(early.status).toBe(409);
    const { clock } = await begin("EN-5", h.org); clock.t += 2000;
    expect((await call("POST", "/api/z/EN-5/ttt/end", {}, h.org, clock.t)).status).toBe(200);
    const again = await call("POST", "/api/z/EN-5/ttt/end", {}, h.org, clock.t + 9000); expect(await j(again)).toEqual({ ok: true, ended: true, again: true });
    expect(sql("SELECT ended_ms FROM ttt_t WHERE eid='EN-5'")[0].ended_ms).toBe(T + 2000);
  });
  test("a tournament that is still running is not 'ended early'", async () => {
    const h = await game("EN-6"); await joinAll("EN-6", 2); const { clock } = await begin("EN-6", h.org);
    const v = await j(await call("GET", "/api/z/EN-6/ttt/view", undefined, {}, clock.t)); expect(v.endedEarly).toBe(false);
  });
});
