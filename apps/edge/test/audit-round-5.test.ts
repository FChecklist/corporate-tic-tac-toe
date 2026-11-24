// v1.6.2, third audit round of PR 9 (23 Nov 2026, head 776e5ee6), the SECURITY audit: M-A (Host key tied to one game), M-B (a report wins only with proof the other side is away),
// M-C (bracket and podium cannot be forged), M-D (the per-game ID allowance also covers the join route), M-E (full names only for people who may see them).
// Every test here fails if the fix it protects is taken out (each was broken once, the test failed, the fix was put back).
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle, consentFor } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import { mintDeviceKey } from "../src/hostsetup";
import { TttConsole, planOf, type Setup } from "../../../packages/ttt/src/phone";
import { apiFor } from "../../../tools/sim2/phones";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const START = Math.floor((T / 1000 - GEN) / 3) + 1 + 1200;
let env: Env; let raw: ReturnType<typeof makeD1>["raw"]; let n = 0;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => (i.toString(16).padStart(4, "0")).repeat(8);
interface P { pid: string; device: string; name: string }
const sql = (q: string, ...a: unknown[]) => raw.query(q).all(...(a as any[])) as any[];
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", RUNNER_KEY: "test-runner-key-test-runner-key-test0000", DAILY_WRITE_BUDGET: "100000000", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k" } as Env; n = 0; });

async function account() {
  const r = await j(await call("POST", "/api/start", { email: `o${++n}@acme.com` }, { "cf-connecting-ip": `10.1.0.${n}` }));
  return { "x-organizer": r.token as string };
}
async function game(id: string, h: Record<string, string>, over: Record<string, unknown> = {}) {
  expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100, ...over }, h)).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, h)).status).toBe(200);
  raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]);
}
async function joinAll(id: string, names: string[]): Promise<P[]> {
  const out: P[] = [];
  for (const [i, name] of names.entries()) { const r = await call("POST", `/api/z/${id}/join`, { name, device: dev(i + 1) }); expect(r.status).toBe(200); out.push({ pid: (await j(r)).pid, device: dev(i + 1), name }); }
  return out;
}
const players = (count: number) => Array.from({ length: count }, (_, i) => `Player ${i + 1}`);
async function begin(id: string, h: Record<string, string>, body: Record<string, unknown> = {}) {
  expect((await call("POST", `/api/z/${id}/ttt/start`, body, h, T)).status).toBe(200);
  const clock = { t: T }; expect((await new TttConsole(apiFor(call, clock, h), id).tick()).sentPlan).toBe(true);
}
const setupOf = async (id: string): Promise<Setup> => j(await call("GET", `/api/z/${id}/ttt/setup`, undefined, {}, T));
async function pairs(id: string, ps: P[], count = 1) {
  const plan = await planOf(await setupOf(id)); const by = new Map(ps.map((p) => [p.pid, p]));
  return Object.values(plan.t.matches).filter((m) => m.round === 1 && !m.bye).sort((a, b) => a.idx - b.idx).slice(0, count).map((m) => ({ mid: m.mid, a: by.get(m.boards[0]!.a)!, b: by.get(m.boards[0]!.b)! }));
}
const mv = (id: string, p: P, body: Record<string, unknown>, now: number) => call("POST", `/api/z/${id}/ttt/move`, { pid: p.pid, device: p.device, ...body }, {}, now);
const report = (id: string, p: P, mid: string, winner: string, now: number) => call("POST", `/api/z/${id}/ttt/result`, { pid: p.pid, device: p.device, mid, winner }, {}, now);
const boardOf = async (id: string, mid: string, now: number) => j(await call("GET", `/api/z/${id}/ttt/m/${mid}`, undefined, {}, now));
const settle = (id: string, h: Record<string, string>, mid: string, winner: string) => call("POST", `/api/z/${id}/ttt/settle`, { mid, j: 0, winner }, h, T + 6000);

// ---------------------------------------------------------------------------------------------------------------- M-A
describe("M-A: a Host added inside one game belongs to that game only", () => {
  async function twoGames() {
    const h = await account();
    for (const id of ["AP-1", "AP-2"]) {
      expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100, whoCanJoin: "list" }, h)).status).toBe(200);
      expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, h)).status).toBe(200);
    }
    const ask = await call("POST", "/api/z/AP-2/join", { name: "Carol Guest", email: "carol@x.com", device: dev(9), consent: consentFor("K4") }); expect(ask.status).toBe(403); // a request waits in AP-2: name and e-mail only the organizer and Hosts may see
    const host = await j(await call("POST", "/api/org/host", { label: "Priya", email: "priya@acme.com", mobile: "9876500001", e: "AP-1" }, h));
    return { h, hostKey: host.hostKey as string, hostId: host.id as string };
  }
  test("the audit's probe: a Host key made inside AP-1 reads AP-1 but gets 403 on the waiting list and on cancel-preview of AP-2", async () => {
    const { hostKey } = await twoGames(); const k = { "x-organizer": hostKey };
    expect((await call("GET", "/api/z/AP-1/waiting", undefined, k)).status).toBe(200);
    const w = await call("GET", "/api/z/AP-2/waiting", undefined, k); expect(w.status).toBe(403); expect(JSON.stringify(await j(w))).not.toContain("Carol");
    expect((await call("GET", "/api/z/AP-2/cancel-preview", undefined, k)).status).toBe(403);
    expect((await call("GET", "/api/z/AP-2/people", undefined, k)).status).toBe(403);
  });
  test("every route for the people who run a game is shut to a Host of another game (read and write), whether or not the route checks the game itself", async () => {
    const { hostKey } = await twoGames(); const k = { "x-organizer": hostKey };
    for (const a of ["participants", "summary", "life", "seats", "names", "invites", "prizes", "reportlink", "cancel-preview"]) { const r = await call("GET", `/api/z/AP-2/${a}`, undefined, k); expect([a, r.status]).toEqual([a, 403]); }
    for (const [m, a, b] of [["PATCH", "settings", { name: "x" }], ["POST", "announce", { text: "hi" }], ["POST", "roster", { people: [] }], ["POST", "mark", { seat: 1, role: "none" }], ["POST", "cancel", {}], ["POST", "clone", {}], ["POST", "publish", {}], ["POST", "erase", {}], ["POST", "unbind", {}], ["POST", "prizegiven", {}], ["POST", "override", {}]] as const) { const r = await call(m, `/api/z/AP-2/${a}`, b, k); expect([a, r.status]).toEqual([a, 403]); expect((await j(r)).code).toBe("other-game"); }
    expect((await call("GET", "/api/z/AP-1/summary", undefined, k)).status).toBe(200); // the Host's own game is open to them
  });
  test("the Organizer's own key still reaches both games, and the Host's game is stored on the key", async () => {
    const { h, hostId } = await twoGames();
    for (const id of ["AP-1", "AP-2"]) expect((await call("GET", `/api/z/${id}/waiting`, undefined, h)).status).toBe(200);
    expect(sql("SELECT eid FROM organizer_key WHERE kind='host' AND substr(hash,1,10)=?", hostId)[0].eid).toBe("AP-1");
  });
  test("every device key of that Host (the e-mail sign-in makes one) carries the same game", async () => {
    const { hostId } = await twoGames();
    const hid = sql("SELECT hash FROM organizer_key WHERE kind='host' AND substr(hash,1,10)=?", hostId)[0].hash as string;
    const key = "cbh_" + "d".repeat(48); await mintDeviceKey(env, hid, key, T);
    const me = sql("SELECT eid, host_id FROM organizer_key WHERE kind='host' AND host_id=? AND hash<>?", hid, hid)[0]; expect(me.eid).toBe("AP-1");
    expect((await call("GET", "/api/z/AP-2/waiting", undefined, { "x-organizer": key })).status).toBe(403);
  });
  test("a Host of AP-1 cannot add a Co-host to AP-2 (the Organizer can)", async () => {
    const { h, hostKey } = await twoGames();
    const no = await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500002", e: "AP-2" }, { "x-organizer": hostKey }); expect(no.status).toBe(403);
    expect((await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500002", e: "AP-1" }, { "x-organizer": hostKey })).status).toBe(200);
    expect((await call("POST", "/api/org/cohost", { label: "Ravi", phone: "9876500003", e: "AP-2" }, h)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------- M-B
describe("M-B: a single report wins only when the board shows the other side is away", () => {
  async function board(id = "RB-1", extra: Record<string, unknown> = {}) {
    const h = await account(); await game(id, h); const ps = await joinAll(id, players(8)); await begin(id, h, extra);
    const [x, y] = await pairs(id, ps, 2); return { h, ps, x: x!, y: y! };
  }
  test("the audit's probe: nobody has moved, player A reports a win at +1 s: the board is NOT decided at +31 s, nor 400 s later", async () => {
    const { x } = await board("RB-1", { moveSecs: 60 });
    expect((await report("RB-1", x.a, x.mid, x.a.pid, T + 1000)).status).toBe(200);
    for (const at of [20_000, 31_001, 400_000]) { const b = await boardOf("RB-1", x.mid, T + at); expect([at, b.boards[0].result]).toEqual([at, null]); expect(b.complete).toBe(false); }
    expect(sql("SELECT COUNT(*) c FROM ttt_b WHERE eid='RB-1'")[0].c).toBe(0);
  });
  test("a clock-out claim is stored only after the clock: the ready time (30 s) for the first move, the move clock after that", async () => {
    const { x } = await board("RB-2", { moveSecs: 60 });
    const early = await mv("RB-2", x.a, { mid: x.mid, seq: 0, absent: true }, T + 2000); expect(early.status).toBe(409); expect((await j(early)).code).toBe("too-early");
    expect((await mv("RB-2", x.a, { mid: x.mid, seq: 0, absent: true }, T + 28_600)).status).toBe(200); // 30 s of ready time, less the small slack for a phone's clock
    const again = await mv("RB-2", x.a, { mid: x.mid, seq: 1, absent: true }, T + 40_000); expect(again.status).toBe(409); // the next one waits for the 60 s move clock
    expect((await mv("RB-2", x.a, { mid: x.mid, seq: 1, absent: true }, T + 28_600 + 58_500)).status).toBe(200);
  });
  test("a player who writes their own claim at once and then reports still does not win: the claim is refused, so the report has no proof", async () => {
    const { x } = await board("RB-3", { moveSecs: 60 });
    expect((await mv("RB-3", x.a, { mid: x.mid, seq: 0, absent: true }, T + 1000)).status).toBe(409);
    await report("RB-3", x.a, x.mid, x.a.pid, T + 1500);
    expect((await boardOf("RB-3", x.mid, T + 200_000)).boards[0].result).toBeNull();
  });
  test("when the other player really did not come: claim after the ready time, then the report: kept 30 s later (the walkover still works)", async () => {
    const { x } = await board("RB-4", { moveSecs: 60 });
    expect((await mv("RB-4", x.a, { mid: x.mid, seq: 0, absent: true }, T + 31_000)).status).toBe(200);
    await report("RB-4", x.a, x.mid, x.a.pid, T + 31_500);
    expect((await boardOf("RB-4", x.mid, T + 60_000)).boards[0].result).toBeNull();
    expect((await boardOf("RB-4", x.mid, T + 61_501)).boards[0].result).toMatchObject({ winner: x.a.pid, how: "uncontested" });
  });
  test("the Organizer's page may claim and report for a board nobody is on (it is not held to the player's clock)", async () => {
    const { h, x } = await board("RB-5", { moveSecs: 60 });
    expect((await call("POST", "/api/z/RB-5/ttt/move", { mid: x.mid, j: 0, seq: 0, absent: true }, h, T + 1000)).status).toBe(200);
  });
  test("one player cannot flood a board: at most 5 writes in a second, and a board holds at most 120 entries", async () => {
    const { x } = await board("RB-6");
    const codes: number[] = []; for (let i = 0; i < 7; i++) codes.push((await mv("RB-6", x.a, { mid: x.mid, seq: Math.min(i, 5), sq: 4 }, T + 5000 + i * 10)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    let seq = 5, at = T + 7000; for (; seq < 120; seq++, at += 1000) expect([seq, (await mv("RB-6", x.a, { mid: x.mid, seq, sq: 4 }, at)).status]).toEqual([seq, 200]);
    const full = await mv("RB-6", x.a, { mid: x.mid, seq: 120, sq: 4 }, at); expect(full.status).toBe(409); expect((await j(full)).code).toBe("board-full");
    expect(sql("SELECT COUNT(*) c FROM ttt_mv WHERE mid=?", x.mid)[0].c).toBe(120);
  }, 30_000);
});

// ---------------------------------------------------------------------------------------------------------------- M-C
describe("M-C: bracket and podium cannot be forged", () => {
  /** 4 players: r1m0, r1m1 and the final r2m0. The Organizer settles both first-round matches. */
  async function semis(id: string) {
    const h = await account(); await game(id, h); const ps = await joinAll(id, ["Asha Rao", "Ravi Kumar Singh", "Mei Chen", "Dev Nair"]); await begin(id, h);
    const [x, y] = await pairs(id, ps, 2);
    for (const [m, w] of [[x!, x!.a], [y!, y!.b]] as const) expect((await settle(id, h, m.mid, w.pid)).status).toBe(200);
    const open = (p: P, o: Record<string, unknown>) => call("POST", `/api/z/${id}/ttt/open`, { pid: p.pid, device: p.device, mid: "r2m0", round: 2, idx: 0, a: x!.a.pid, b: y!.b.pid, boards: [[x!.a.pid, y!.b.pid]], from: [x!.mid, y!.mid], opened: T + 9000, ...o }, {}, T + 7000);
    return { h, ps, x: x!, y: y!, open };
  }
  test("the audit's probe 1: the LOSER of a first-round match cannot register the next match against the other winner (400 not-from-feeders), and nothing is stored", async () => {
    const { x, y, open } = await semis("RC-1");
    const forged = await open(x.b, { a: x.b.pid, boards: [[x.b.pid, y.b.pid]] }); expect(forged.status).toBe(400); expect((await j(forged)).code).toBe("not-from-feeders");
    expect((await open(x.b, { boards: [[x.b.pid, y.b.pid]] })).status).toBe(400); // right sides in the header, a loser on the board
    const headerOnly = await open(x.a, { a: x.b.pid }); expect(headerOnly.status).toBe(400); expect((await j(headerOnly)).code).toBe("not-from-feeders"); // right board, the loser named as a side in the header
    expect((await open(x.a, { b: y.a.pid })).status).toBe(400);
    expect(sql("SELECT COUNT(*) c FROM ttt_m WHERE eid='RC-1' AND mid='r2m0'")[0].c).toBe(0);
    expect((await open(x.a, {})).status).toBe(200); // the two real winners: fine
    expect((await j(await open(y.b, {}))).again).toBe(true);
  });
  test("the audit's probe 2: winners of r1m0 and r1m1 cannot register r2m1 (whose feeders are r1m2 and r1m3), and the round and place must fit the match id", async () => {
    const { x, y, open } = await semis("RC-2");
    const other = await open(x.a, { mid: "r2m1", idx: 1 }); expect(other.status).toBe(400); expect((await j(other)).code).toBe("not-from-feeders");
    const wrongPlace = await open(x.a, { idx: 1 }); expect(wrongPlace.status).toBe(400); // r2m0 is place 0
    const wrongRound = await open(x.a, { round: 3 }); expect(wrongRound.status).toBe(400);
    const swapped = await open(x.a, { from: [y.mid, x.mid] }); expect(swapped.status).toBe(400); // the feeders are r1m0 then r1m1, in that order
    expect(sql("SELECT COUNT(*) c FROM ttt_m WHERE eid='RC-2' AND round=2")[0].c).toBe(0);
  });
  test("the audit's probe 3: both finalists send a podium that names a first-round loser as champion: refused (400), nothing is written to the winners record", async () => {
    const { h, x, y, open } = await semis("RC-3");
    expect((await open(x.a, {})).status).toBe(200);
    expect((await settle("RC-3", h, "r2m0", x.a.pid)).status).toBe(200); // x.a wins the final
    const rank = (ids: string[], names: string[]) => ids.map((id, i) => ({ rank: i + 1, id, name: names[i], roundReached: 3 - Math.min(i, 2), points: 4 - i, decidedBy: "", tie: "" }));
    const names = ["Asha Rao", "Mei Chen", "Ravi Kumar Singh", "Dev Nair"];
    const forged = { champion: x.b.pid, rounds: 2, finalMid: "r2m0", podium: [[x.b.pid], [x.a.pid]], ranking: rank([x.b.pid, x.a.pid, y.b.pid, y.a.pid], names) };
    const fin = (p: P, body: unknown) => call("POST", "/api/z/RC-3/ttt/finish", { pid: p.pid, device: p.device, ...(body as object) }, {}, T + 8000);
    for (const p of [x.a, y.b]) { const r = await fin(p, forged); expect(r.status).toBe(400); expect((await j(r)).code).toBe("not-the-winner"); }
    expect((await j(await call("GET", "/api/z/RC-3/ttt/view", undefined, h, T + 9000))).state).toBe("running");
    expect(sql("SELECT COUNT(*) c FROM settled WHERE eid='RC-3'")[0].c).toBe(0); expect(sql("SELECT COUNT(*) c FROM winner WHERE eid='RC-3'")[0].c).toBe(0);
    // the true result is accepted: champion = winner of the final, then the other finalist, then the two first-round losers; a podium of other people is not
    const ok = { champion: x.a.pid, rounds: 2, finalMid: "r2m0", podium: [[x.a.pid], [y.b.pid], [x.b.pid], [y.a.pid]], ranking: rank([x.a.pid, y.b.pid, x.b.pid, y.a.pid], ["Asha Rao", "Dev Nair", "Ravi Kumar Singh", "Mei Chen"]) };
    const onlyChampion = await fin(x.a, { ...ok, champion: x.b.pid }); expect(onlyChampion.status).toBe(400); expect((await j(onlyChampion)).code).toBe("not-the-winner"); // a loser named as champion, everything else as it should be
    const wrongPodium = await fin(x.a, { ...ok, podium: [[x.b.pid], [y.b.pid], [x.a.pid], [y.a.pid]] }); expect(wrongPodium.status).toBe(400);
    const swappedRunner = await fin(x.a, { ...ok, ranking: rank([x.a.pid, x.b.pid, y.b.pid, y.a.pid], names) }); expect(swappedRunner.status).toBe(400); // the runner-up is the other side of the final
    const consistentButWrong = await fin(x.a, { ...ok, podium: [[x.a.pid], [x.b.pid], [y.b.pid], [y.a.pid]], ranking: rank([x.a.pid, x.b.pid, y.b.pid, y.a.pid], names) }); expect(consistentButWrong.status).toBe(400); // podium and ranking agree with each other, but the second place is a first-round loser
    expect((await fin(x.a, ok)).status).toBe(200); expect((await j(await fin(y.b, ok))).done).toBe(true);
    expect(sql("SELECT COUNT(*) c FROM settled WHERE eid='RC-3'")[0].c).toBeGreaterThan(0);
  });
});

describe("M-C: third and fourth place are people who reached the semi-finals", () => {
  test("8 players: a podium that puts a first-round loser in third place is refused; the real semi-final losers are accepted", async () => {
    const h = await account(); await game("RC-4", h); const ps = await joinAll("RC-4", players(8)); await begin("RC-4", h);
    const r1 = await pairs("RC-4", ps, 4);
    for (const m of r1) expect((await settle("RC-4", h, m.mid, m.a.pid)).status).toBe(200); // every first-round match is won by its first player
    const open = (p: P, mid: string, idx: number, round: number, a: P, b: P, from: string[]) => call("POST", "/api/z/RC-4/ttt/open", { pid: p.pid, device: p.device, mid, round, idx, a: a.pid, b: b.pid, boards: [[a.pid, b.pid]], from, opened: T + 9000 }, {}, T + 7000);
    expect((await open(r1[0]!.a, "r2m0", 0, 2, r1[0]!.a, r1[1]!.a, [r1[0]!.mid, r1[1]!.mid])).status).toBe(200);
    expect((await open(r1[2]!.a, "r2m1", 1, 2, r1[2]!.a, r1[3]!.a, [r1[2]!.mid, r1[3]!.mid])).status).toBe(200);
    for (const [mid, w] of [["r2m0", r1[0]!.a], ["r2m1", r1[2]!.a]] as const) expect((await settle("RC-4", h, mid, w.pid)).status).toBe(200);
    expect((await open(r1[0]!.a, "r3m0", 0, 3, r1[0]!.a, r1[2]!.a, ["r2m0", "r2m1"])).status).toBe(200);
    expect((await settle("RC-4", h, "r3m0", r1[0]!.a.pid)).status).toBe(200);
    const row = (p: P, rank: number) => ({ rank, id: p.pid, name: p.name, roundReached: 1, points: 8 - rank, decidedBy: "", tie: "" });
    const pay = (order: P[]) => ({ champion: order[0]!.pid, rounds: 3, finalMid: "r3m0", podium: order.slice(0, 5).map((p) => [p.pid]), ranking: order.map((p, i) => row(p, i + 1)) });
    const rest = [r1[0]!.b, r1[1]!.b, r1[2]!.b, r1[3]!.b];
    const forged = pay([r1[0]!.a, r1[2]!.a, r1[0]!.b, r1[1]!.a, r1[3]!.a, ...rest.slice(1)]); // third place: the loser of the very first match
    const fin = (p: P, body: unknown) => call("POST", "/api/z/RC-4/ttt/finish", { pid: p.pid, device: p.device, ...(body as object) }, {}, T + 8000);
    const bad = await fin(r1[0]!.a, forged); expect(bad.status).toBe(400); expect((await j(bad)).code).toBe("not-in-game");
    expect((await fin(r1[0]!.a, pay([r1[0]!.a, r1[2]!.a, r1[1]!.a, r1[3]!.a, ...rest]))).status).toBe(200);
  }, 30_000);
});

// ---------------------------------------------------------------------------------------------------------------- M-D
describe("M-D: the per-game ID allowance also covers the route where an ID is used (join)", () => {
  async function listGame(id = "RD-1") {
    const h = await account();
    expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100, whoCanJoin: "list" }, h)).status).toBe(200);
    expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, h)).status).toBe(200);
    expect((await call("POST", `/api/z/${id}/people`, { people: [{ name: "Asha Rao", empId: "A-1101" }, { name: "Dev Nair", empId: "B-2202" }] }, h)).status).toBe(200);
    return h;
  }
  const tryJoin = (id: string, i: number, empId: string, ip: string, now = T) => handle(new Request(`http://x/api/z/${id}/join`, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ name: "Guest " + i, empId, device: dev(i), consent: consentFor("K4") }) }), env, now);
  test("the audit's probe: 600 tries from 600 different networks use up the game's allowance; a RIGHT ID after that is refused (429) like a wrong one, so a guesser learns nothing", async () => {
    await listGame();
    const early = await tryJoin("RD-1", 5000, "A1101", "9.0.0.1"); expect(early.status).toBe(200); // a real guest early in the window comes straight in
    for (let i = 1; i < 600; i++) { const r = await tryJoin("RD-1", i, "ZZ" + i, `9.${i % 250}.${Math.floor(i / 250)}.7`); expect([i, [403, 429].includes(r.status)]).toEqual([i, true]); }
    for (const empId of ["B2202", "ZZ9999"]) { const r = await tryJoin("RD-1", 6000, empId, "9.99.99.99"); expect([empId, r.status]).toEqual([empId, 429]); expect((await j(r)).code).toBe("too-many-tries"); }
    expect((await tryJoin("RD-1", 6001, "B2202", "9.99.99.100", T + 11 * 60_000)).status).toBe(200); // ten minutes later the allowance is fresh
  }, 120_000);
  test("the allowance is shared with 'Is this you?': tries on the preview and on the join come off the same budget", async () => {
    await listGame();
    for (let i = 0; i < 300; i++) await handle(new Request("http://x/api/z/RD-1/who", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `8.${i % 250}.${Math.floor(i / 250)}.3` }, body: JSON.stringify({ empId: "ZZ" + i, consent: consentFor("K4") }) }), env, T);
    const used = sql("SELECT v FROM kv WHERE k LIKE 'idlookg/RD-1/%'")[0].v; expect(Number(used)).toBe(300);
    await tryJoin("RD-1", 1, "ZZ1", "9.1.1.1"); expect(Number(sql("SELECT v FROM kv WHERE k LIKE 'idlookg/RD-1/%'")[0].v)).toBe(301);
  }, 60_000);
  test("a game with a large cap keeps room for its own guests: the allowance is 3 tries for every place", async () => {
    const h = await account(); await call("POST", "/api/z", { id: "RD-2", startRound: START, callSeconds: 6, cap: 2000, whoCanJoin: "list" }, h);
    await call("POST", "/api/z/RD-2/publish", { email: "boss@acme.com", phone: "98765 43210" }, h);
    await call("POST", "/api/z/RD-2/people", { people: [{ name: "Asha Rao", empId: "A-1101" }] }, h);
    raw.run("INSERT INTO kv(k,v) VALUES(?,?)", [`idlookg/RD-2/${new Date(T).toISOString().slice(0, 15)}`, "1500"]);
    expect((await tryJoin("RD-2", 1, "A1101", "9.2.2.2")).status).toBe(200); // 1,500 of 6,000 used
    raw.run("UPDATE kv SET v='6000' WHERE k LIKE 'idlookg/RD-2/%'");
    expect((await tryJoin("RD-2", 2, "A1101", "9.2.2.3")).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------------------------------------------- M-E
describe("M-E: the ranking and the view show full names only to people who may see them", () => {
  test("after the final: a stranger gets 'Asha R.' style names from rank and view, a seated player (with proof) and the Organizer get the full names", async () => {
    const h = await account(); await game("RE-1", h); const ps = await joinAll("RE-1", ["Asha Rao", "Ravi Kumar Singh"]); await begin("RE-1", h);
    const [x] = await pairs("RE-1", ps);
    await report("RE-1", x!.a, x!.mid, x!.a.pid, T + 2000); await report("RE-1", x!.b, x!.mid, x!.a.pid, T + 2100);
    const pay = { champion: x!.a.pid, rounds: 1, finalMid: "r1m0", podium: [[x!.a.pid], [x!.b.pid]], ranking: [{ rank: 1, id: x!.a.pid, name: x!.a.name, roundReached: 2, points: 2, decidedBy: "", tie: "" }, { rank: 2, id: x!.b.pid, name: x!.b.name, roundReached: 1, points: 0, decidedBy: "", tie: "" }] };
    for (const p of [x!.a, x!.b]) expect((await call("POST", "/api/z/RE-1/ttt/finish", { pid: p.pid, device: p.device, ...pay }, {}, T + 3000)).status).toBe(200);
    const get = async (path: string, q = "", headers: Record<string, string> = {}) => j(await call("GET", `/api/z/RE-1/ttt/${path}${q}`, undefined, headers, T + 4000));
    const names = (r: any) => r.ranking.map((x: any) => x.name);
    const SHORT: Record<string, string> = { "Asha Rao": "Asha R.", "Ravi Kumar Singh": "Ravi S." }; // who is first or second depends on the draw: expect by name
    const fullOrder = [x!.a.name, x!.b.name], shortOrder = fullOrder.map((n) => SHORT[n]!);
    const mine = `${"pid=" + x!.a.pid}&device=${x!.a.device}`;
    for (const stranger of [await get("rank", "?n=100"), await get("rank", `?n=100&pid=${x!.a.pid}&device=${dev(999)}`), await get("view"), await get("view", `?pid=nobody&device=${x!.a.device}`)]) {
      expect(names(stranger)).toEqual(shortOrder); expect(JSON.stringify(stranger)).not.toContain("Kumar"); expect(JSON.stringify(stranger)).not.toContain("Rao");
    }
    expect((await get("view")).champion).toBe(shortOrder[0]);
    for (const full of [await get("rank", `?n=100&${mine}`), await get("rank", "?n=100", h), await get("view", `?${mine}`), await get("view", "", h)]) expect(names(full)).toEqual(fullOrder);
    expect((await get("view", `?${mine}`)).champion).toBe(fullOrder[0]); expect((await get("view", "", h)).champion).toBe(fullOrder[0]);
    expect((await get("rank", "?n=100")).ranking.map((x: any) => x.rank)).toEqual([1, 2]); // the order and the ids are the same for everybody
  });
  test("the pages send the proof: the phone adds its seat and device to rank and view, and the Organizer's pages send their key", async () => {
    const ttt = await Bun.file(new URL("../../web/public/ttt.js", import.meta.url)).text(), host = await Bun.file(new URL("../../web/public/host.js", import.meta.url)).text(), zc = await Bun.file(new URL("../../web/public/zc.js", import.meta.url)).text();
    expect(ttt).toMatch(/\\\/ttt\\\/\(setup\|rank\|view\)/);
    expect(host).toMatch(/call\("GET", `\/api\/z\/\$\{EID\}\/ttt\/view`\)/);
    expect(zc).toMatch(/ttt\/view`, \{ headers: \{ "x-organizer": secret \}/);
  });
});
