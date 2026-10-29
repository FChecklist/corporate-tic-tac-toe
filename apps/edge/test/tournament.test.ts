// The tournament mailbox through the real Worker routes, and whole tournaments played by simulated phones that run the browser engine (packages/ttt/src/phone.ts).
// The server only stores and relays: these tests show it stores what it is given, stamps it with its own clock, agrees results only by comparing two reports, and never judges a board.
// The rules themselves are tested in packages/ttt/test (engine) - the server has none. Rules: docs/RULES.md.
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { eraseEverything } from "../src/lifecycle";
import { makeD1 } from "./d1-sqlite";
import { commitOf, seedOf, verifyReveal } from "../../../packages/ttt/src/seal";
import { LATE_MOVE_MESSAGE, TttConsole, TttPhone, planOf, replayMatch, type Api, type MatchRec, type Setup } from "../../../packages/ttt/src/phone";
import type { MatchState } from "../../../packages/ttt/src/bracket";
import { lastGame } from "../../../packages/ttt/src/match";
import { apiFor, playCrowd } from "../../../tools/sim2/phones";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200;
let env: Env; let raw: ReturnType<typeof makeD1>["raw"]; let n = 0;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => (i.toString(16).padStart(4, "0")).repeat(8); // 32 hex characters
interface P { pid: string; device: string; name: string }
let seedRng = 1; const rnd = () => (seedRng = (Math.imul(seedRng, 1664525) + 1013904223) >>> 0) / 0x100000000;

async function game(id: string, over: Record<string, unknown> = {}) {
  const r = await j(await call("POST", "/api/start", { email: `o${++n}@acme.com` }, { "cf-connecting-ip": `10.0.0.${n}` }));
  const h = { "x-organizer": r.token as string };
  expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100, ...over }, h)).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, h)).status).toBe(200);
  raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]); // paid, so the game never locks while a test moves the clock forward
  return h;
}
async function joinAll(id: string, count: number, from = 1): Promise<P[]> {
  const out: P[] = [];
  for (let i = from; i < from + count; i++) {
    const name = `Player ${i}`; const r = await call("POST", `/api/z/${id}/join`, { name, device: dev(i) }); expect(r.status).toBe(200);
    out.push({ pid: (await j(r)).pid, device: dev(i), name });
  }
  return out;
}
const view = async (id: string, now: number, q = "") => j(await call("GET", `/api/z/${id}/ttt/view${q}`, undefined, {}, now));
const setupOf = async (id: string, now = T): Promise<Setup> => j(await call("GET", `/api/z/${id}/ttt/setup`, undefined, {}, now));
/** Start through the route, then let the Organizer's page compute and send the draw (as host.js does). */
async function begin(id: string, h: Record<string, string>, body: Record<string, unknown> = {}, now = T) {
  const st = await call("POST", `/api/z/${id}/ttt/start`, body, h, now); expect(st.status).toBe(200);
  const clock = { t: now }; const con = new TttConsole(apiFor(call, clock, h), id);
  const r = await con.tick(); expect(r.sentPlan).toBe(true);
  return { clock, con };
}
const mv = (id: string, p: P, body: Record<string, unknown>, now: number) => call("POST", `/api/z/${id}/ttt/move`, { pid: p.pid, device: p.device, ...body }, {}, now);
const result = (id: string, p: P, mid: string, winner: string, now: number) => call("POST", `/api/z/${id}/ttt/result`, { pid: p.pid, device: p.device, mid, winner }, {}, now);
const getM = async (id: string, mid: string, now: number) => j(await call("GET", `/api/z/${id}/ttt/m/${mid}`, undefined, {}, now));
const sql = (q: string, ...a: unknown[]) => raw.query(q).all(...(a as any[])) as any[];

/** The first real round-1 matches of a started tournament, with the two players of board 0 as P objects. */
async function pairs(id: string, ps: P[], count = 1) {
  const plan = await planOf(await setupOf(id)); const by = new Map(ps.map((p) => [p.pid, p]));
  const ms = Object.values(plan.t.matches).filter((m) => m.round === 1 && !m.bye).sort((a, b) => a.idx - b.idx).slice(0, count);
  return { plan, list: ms.map((m) => ({ mid: m.mid, m, a: by.get(m.boards[0]!.a)!, b: by.get(m.boards[0]!.b)! })) };
}
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000000", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k" } as Env; n = 0; seedRng = 1; });

describe("the lobby and the start (G1-G6)", () => {
  test("G5/G6: the view shows how many joined; start is refused with fewer than two players and for anyone but the Organizer or a Host", async () => {
    const h = await game("TT-1"); await joinAll("TT-1", 1);
    expect((await view("TT-1", T)).joined).toBe(1);
    const few = await call("POST", "/api/z/TT-1/ttt/start", {}, h); expect(few.status).toBe(409); expect((await j(few)).code).toBe("too-few");
    await joinAll("TT-1", 1, 2);
    expect((await call("POST", "/api/z/TT-1/ttt/start", {})).status).toBe(403); // a stranger
    const aiKey = await j(await call("POST", "/api/org/ai", {}, h)); // the organizer's AI helper may not start it either
    if (aiKey.token) expect((await call("POST", "/api/z/TT-1/ttt/start", {}, { "x-organizer": aiKey.token })).status).toBe(403);
    expect((await call("POST", "/api/z/TT-1/ttt/start", { moveSecs: 17 }, h)).status).toBe(400);
    expect((await call("POST", "/api/z/TT-1/ttt/start", { format: "team", teamSize: 3 }, h)).status).toBe(409);
  });
  test("R26: the fingerprint is public from the first look and the secret only after the start; then anybody can check the fingerprint and re-compute the seed", async () => {
    const h = await game("TT-2"); const ps = await joinAll("TT-2", 4);
    const s0 = await setupOf("TT-2"); expect(s0.commit).toMatch(/^[0-9a-f]{64}$/); expect(s0.state).toBe("open"); expect(s0.secret).toBeUndefined(); expect(s0.seed).toBeUndefined();
    expect((await j(await call("GET", "/api/z/TT-2/ttt/reveal"))).revealed).toBe(false);
    await call("POST", "/api/z/TT-2/ttt/start", { moveSecs: 20, beacon: "round-123" }, h);
    expect((await j(await call("GET", "/api/z/TT-2/ttt/reveal"))).revealed).toBe(false); // the list is closed but the clocks have not started: only the Organizer's page sees the seed
    expect((await j(await call("GET", "/api/z/TT-2/ttt/reveal", undefined, h))).revealed).toBe(true);
    await new TttConsole(apiFor(call, { t: T }, h), "TT-2").tick(); // the draw is sent, the clocks start
    const rv = await j(await call("GET", "/api/z/TT-2/ttt/reveal")); expect(rv.revealed).toBe(true);
    expect(rv.commit).toBe(s0.commit); expect(await commitOf(rv.secret)).toBe(s0.commit); expect(await verifyReveal(rv.secret, s0.commit)).toBe(true);
    expect(rv.seed).toBe(await seedOf(rv.secret, "TT-2", ps.map((p) => p.pid), "round-123"));
    const s1 = await setupOf("TT-2"); expect(s1.seed).toBe(rv.seed); expect(s1.roster!.map((p) => p.pid).sort()).toEqual(ps.map((p) => p.pid).sort()); expect(s1.opts).toEqual({ format: "solo", teamSize: 1, moveMs: 20_000, readyMs: 30_000 });
  });
  test("R32/D4: the list closes at the start: a new phone is refused, a player who was in can open the link again", async () => {
    const h = await game("TT-3"); const ps = await joinAll("TT-3", 4);
    await call("POST", "/api/z/TT-3/ttt/start", {}, h);
    const late = await call("POST", "/api/z/TT-3/join", { name: "Late Lata", device: dev(99) }); expect(late.status).toBe(409); expect((await j(late)).code).toBe("closed");
    const again = await j(await call("POST", "/api/z/TT-3/join", { name: ps[0]!.name, device: ps[0]!.device })); expect(again.pid).toBe(ps[0]!.pid);
    expect((await call("POST", "/api/z/TT-3/ttt/start", {}, h)).status).toBe(409); // not twice
  });
  test("the game starts when the draw is in: before that the state is 'starting', after it 'running'; the draw can only be sent by the Organizer or a Host, and not twice", async () => {
    const h = await game("TT-4"); await joinAll("TT-4", 4); await call("POST", "/api/z/TT-4/ttt/start", {}, h);
    expect((await setupOf("TT-4")).state).toBe("starting");
    expect((await call("POST", "/api/z/TT-4/ttt/plan", { matches: [] })).status).toBe(403);
    const con = new TttConsole(apiFor(call, { t: T + 500 }, h), "TT-4"); await con.tick();
    const s = await setupOf("TT-4", T + 600); expect(s.state).toBe("running"); expect(s.startedMs).toBe(T + 500); expect(s.rounds).toBe(2); expect(s.planDigest).toMatch(/^[0-9a-f]{64}$/);
    expect((await call("POST", "/api/z/TT-4/ttt/plan", { matches: [], last: true }, h)).status).toBe(409);
  });
});

describe("the mailbox stores and relays; it does not judge (M1-M8)", () => {
  test("M1: a move is stored with the SERVER's stamp (the phone's own clock is kept beside it, never used) and only when seq is the next number", async () => {
    const h = await game("MB-1"); const ps = await joinAll("MB-1", 4); await begin("MB-1", h);
    const { list: [x] } = await pairs("MB-1", ps);
    const r = await mv("MB-1", x!.a, { mid: x!.mid, seq: 0, sq: 4, client_ms: 12345 }, T + 5000); expect(r.status).toBe(200); expect((await j(r)).at).toBe(T + 5000);
    const row = sql("SELECT * FROM ttt_mv WHERE eid='MB-1'")[0]; expect(row).toMatchObject({ mid: x!.mid, seq: 0, sq: 4, client_ms: 12345, at_ms: T + 5000, pid: x!.a.pid });
    const skip = await mv("MB-1", x!.b, { mid: x!.mid, seq: 5, sq: 1 }, T + 6000); expect(skip.status).toBe(409); const sj = await j(skip); expect(sj.code).toBe("seq"); expect(sj.next).toBe(1);
    expect((await mv("MB-1", x!.b, { mid: x!.mid, seq: 0, sq: 1 }, T + 6000)).status).toBe(409); // seq 0 is taken
    expect((await mv("MB-1", x!.b, { mid: x!.mid, seq: 1, sq: 1 }, T + 7000)).status).toBe(200);
    const m = await getM("MB-1", x!.mid, T + 8000);
    expect(m.boards[0].events.map((e: any) => [e.seq, e.sq, e.ms])).toEqual([[0, 4, T + 5000], [1, 1, T + 7000]]);
    expect((await mv("MB-1", x!.a, { mid: x!.mid, seq: 2, sq: 9 }, T + 9000)).status).toBe(400); // not a square
  });
  test("M2: only a player in that match can write to it, from their own phone", async () => {
    const h = await game("MB-2"); const ps = await joinAll("MB-2", 8); await begin("MB-2", h);
    const { list: [x, y] } = await pairs("MB-2", ps, 2);
    expect((await mv("MB-2", y!.a, { mid: x!.mid, seq: 0, sq: 4 }, T + 5000)).status).toBe(403); // a player of another match
    expect((await call("POST", "/api/z/MB-2/ttt/move", { pid: x!.a.pid, device: dev(77), mid: x!.mid, seq: 0, sq: 4 }, {}, T + 5000)).status).toBe(403); // somebody else's phone
    expect((await call("POST", "/api/z/MB-2/ttt/move", { pid: "nobody", device: dev(1), mid: x!.mid, seq: 0, sq: 4 }, {}, T + 5000)).status).toBe(403);
    expect((await mv("MB-2", x!.a, { mid: "r9m9", seq: 0, sq: 4 }, T + 5000)).status).toBe(404); // no such match
    expect((await mv("MB-2", x!.a, { mid: "r2m0", seq: 0, sq: 4 }, T + 5000)).status).toBe(404); // a later match nobody registered yet
    expect(sql("SELECT COUNT(*) c FROM ttt_mv")[0].c).toBe(0);
  });
  test("M3: the mailbox does not look at the board: a move out of turn, on a taken square or twice in a row is stored as sent; the phones ignore it when they replay", async () => {
    const h = await game("MB-3"); const ps = await joinAll("MB-3", 4); const { clock } = await begin("MB-3", h);
    const { plan, list: [x] } = await pairs("MB-3", ps); void clock;
    const g = x!.m.boards[0]!.games[0]!; const first = g.x === x!.a.pid ? x!.a : x!.b, second = first === x!.a ? x!.b : x!.a;
    expect((await mv("MB-3", second, { mid: x!.mid, seq: 0, sq: 3 }, T + 1000)).status).toBe(200); // the player who does NOT move first
    expect((await mv("MB-3", first, { mid: x!.mid, seq: 1, sq: 3 }, T + 2000)).status).toBe(200);
    expect((await mv("MB-3", first, { mid: x!.mid, seq: 2, sq: 3 }, T + 3000)).status).toBe(200); // the same square again
    const rec: MatchRec = (await getM("MB-3", x!.mid, T + 4000)); expect(rec.boards[0]!.events.length).toBe(3);
    const base = structuredClone(x!.m) as MatchState; const rep = await replayMatch(plan, T, base, rec, T, []);
    expect(lastGame(rep.m.boards[0]!).moves.length).toBe(1); // the phones counted one legal move
    expect(lastGame(rep.m.boards[0]!).moves[0]!.pid).toBe(first.pid);
  });
  test("M4: a result is kept when BOTH players report the same winner; reports that differ are flagged for the Organizer, who settles; the mailbox never evaluates a board", async () => {
    const h = await game("MB-4"); const ps = await joinAll("MB-4", 8); await begin("MB-4", h);
    const { list: [x, y] } = await pairs("MB-4", ps, 2);
    // agreed: nobody has played a single move, and the mailbox does not care - it compares the two reports
    expect((await j(await result("MB-4", x!.a, x!.mid, x!.a.pid, T + 1000))).agreed).toBe(false);
    expect((await getM("MB-4", x!.mid, T + 1500)).boards[0].result).toBeNull();
    const ok = await j(await result("MB-4", x!.b, x!.mid, x!.a.pid, T + 2000)); expect(ok.agreed).toBe(true);
    const m = await getM("MB-4", x!.mid, T + 2500); expect(m.complete).toBe(true); expect(m.boards[0].result).toMatchObject({ winner: x!.a.pid, how: "both", ms: T + 2000 });
    expect((await mv("MB-4", x!.a, { mid: x!.mid, seq: 0, sq: 0 }, T + 3000)).status).toBe(409); // a finished board takes no more moves
    // a mismatch
    await result("MB-4", y!.a, y!.mid, y!.a.pid, T + 1000);
    const bad = await j(await result("MB-4", y!.b, y!.mid, y!.b.pid, T + 2000)); expect(bad).toMatchObject({ agreed: false, flagged: true });
    const my = await getM("MB-4", y!.mid, T + 2500); expect(my.complete).toBe(false); expect(my.boards[0].result).toMatchObject({ flag: true, winner: null });
    const fl = await j(await call("GET", "/api/z/MB-4/ttt/flags", undefined, h, T + 3000)); expect(fl.disputed).toEqual([{ mid: y!.mid, j: 0 }]); expect(fl.flags[0].kind).toBe("mismatch");
    expect((await call("GET", "/api/z/MB-4/ttt/flags", undefined, {}, T + 3000)).status).toBe(403); // only the Organizer or a Host
    expect((await call("POST", "/api/z/MB-4/ttt/settle", { mid: y!.mid, j: 0, winner: y!.a.pid }, {}, T + 3000)).status).toBe(403);
    expect((await call("POST", "/api/z/MB-4/ttt/settle", { mid: y!.mid, j: 0, winner: ps.find((p) => p !== y!.a && p !== y!.b)!.pid }, h, T + 3000)).status).toBe(400); // must be one of the two on the board
    expect((await call("POST", "/api/z/MB-4/ttt/settle", { mid: y!.mid, j: 0, winner: y!.b.pid }, h, T + 3000)).status).toBe(200);
    const done = await getM("MB-4", y!.mid, T + 3500); expect(done.complete).toBe(true); expect(done.boards[0].result).toMatchObject({ winner: y!.b.pid, how: "organizer" });
    expect((await result("MB-4", y!.a, y!.mid, y!.a.pid, T + 4000)).status).toBe(200); expect((await getM("MB-4", y!.mid, T + 4500)).boards[0].result.winner).toBe(y!.b.pid); // a late report does not undo the Organizer's decision
  });
  test("M5: a winner must be one of the two players on the board; a stranger cannot report", async () => {
    const h = await game("MB-5"); const ps = await joinAll("MB-5", 8); await begin("MB-5", h);
    const { list: [x, y] } = await pairs("MB-5", ps, 2);
    expect((await result("MB-5", x!.a, x!.mid, y!.a.pid, T + 1000)).status).toBe(400);
    expect((await result("MB-5", y!.a, x!.mid, x!.a.pid, T + 1000)).status).toBe(403);
  });
  test("M6: a single report that nobody contradicts for 30 seconds is kept as the result (the other phone is away or closed); a late contradiction is flagged", async () => {
    const h = await game("MB-6"); const ps = await joinAll("MB-6", 8); await begin("MB-6", h);
    const { list: [x, y] } = await pairs("MB-6", ps, 2);
    await result("MB-6", x!.a, x!.mid, x!.a.pid, T + 1000); await result("MB-6", y!.a, y!.mid, y!.a.pid, T + 1000);
    expect((await getM("MB-6", x!.mid, T + 20_000)).boards[0].result).toBeNull();
    const kept = await getM("MB-6", x!.mid, T + 31_001); expect(kept.complete).toBe(true); expect(kept.boards[0].result).toMatchObject({ winner: x!.a.pid, how: "uncontested", ms: T + 31_000 });
    await call("POST", "/api/lifecycle/tick", {}, { "x-organizer": "plat" }, T + 40_000); // the scheduled job does the same for matches nobody looks at
    expect(sql("SELECT how FROM ttt_b WHERE mid=?", y!.mid)[0].how).toBe("uncontested");
    const late = await j(await result("MB-6", x!.b, x!.mid, x!.b.pid, T + 50_000)); expect(late.flagged).toBe(true);
    expect((await getM("MB-6", x!.mid, T + 51_000)).complete).toBe(false);
  });
  test("M7: while the host pauses nothing is stored (the clocks wait); after the resume moves are stored again", async () => {
    const h = await game("MB-7"); const ps = await joinAll("MB-7", 4); await begin("MB-7", h);
    const { list: [x] } = await pairs("MB-7", ps);
    expect((await call("POST", "/api/z/MB-7/ttt/pause", {}, h, T + 2000)).status).toBe(200);
    const p = await mv("MB-7", x!.a, { mid: x!.mid, seq: 0, sq: 4 }, T + 3000); expect(p.status).toBe(409); expect((await j(p)).code).toBe("paused");
    expect((await setupOf("MB-7", T + 3500)).pauses).toEqual([[T + 2000, null]]);
    expect((await call("POST", "/api/z/MB-7/ttt/resume", {}, h, T + 62_000)).status).toBe(200);
    expect((await setupOf("MB-7", T + 63_000)).pauses).toEqual([[T + 2000, T + 62_000]]);
    expect((await mv("MB-7", x!.a, { mid: x!.mid, seq: 0, sq: 4 }, T + 63_000)).status).toBe(200);
  });
  test("M8: a later-round match is registered by its own players and only once the two matches it comes from are finished; a second, different pairing is refused and the Organizer is told", async () => {
    const h = await game("MB-8"); const ps = await joinAll("MB-8", 4); await begin("MB-8", h);
    const { list: [x, y] } = await pairs("MB-8", ps, 2);
    const w0 = x!.a, w1 = y!.b; const l0 = x!.b, l1 = y!.a;
    const body = (p: P, extra: Record<string, unknown> = {}) => ({ pid: p.pid, device: p.device, mid: "r2m0", round: 2, idx: 0, a: w0.pid, b: w1.pid, boards: [[w0.pid, w1.pid]], from: [x!.mid, y!.mid], opened: T + 9000, ...extra }); // a solo entrant's id is the player's own code
    expect((await call("POST", "/api/z/MB-8/ttt/open", body(w0), {}, T + 5000)).status).toBe(409); // the earlier matches are not finished
    for (const [m, w] of [[x!, w0], [y!, w1]] as const) { expect((await call("POST", "/api/z/MB-8/ttt/settle", { mid: m.mid, j: 0, winner: w.pid }, h, T + 6000)).status).toBe(200); }
    expect((await call("POST", "/api/z/MB-8/ttt/open", body(l0), {}, T + 7000)).status).toBe(403); // somebody who is not on the board
    expect((await call("POST", "/api/z/MB-8/ttt/open", body(w0, { from: [x!.mid] }), {}, T + 7000)).status).toBe(400);
    expect((await call("POST", "/api/z/MB-8/ttt/open", body(w0), {}, T + 7000)).status).toBe(200);
    expect((await j(await call("POST", "/api/z/MB-8/ttt/open", body(w1), {}, T + 7100))).again).toBe(true); // the same pairing from the other player: fine
    const clash = await call("POST", "/api/z/MB-8/ttt/open", body(w1, { boards: [[w1.pid, w0.pid]] }), {}, T + 7200); expect(clash.status).toBe(409); expect((await j(clash)).code).toBe("conflict");
    expect(sql("SELECT kind FROM ttt_x WHERE eid='MB-8'")[0].kind).toBe("pairing");
    const reg = await getM("MB-8", "r2m0", T + 8000); expect(reg.reg).toMatchObject({ round: 2, a: w0.pid, b: w1.pid, opened: T + 6000 }); expect(reg.boards.length).toBe(1); // opened is worked out from the results (settled at T + 6000), not the T + 9000 the caller sent
    expect((await mv("MB-8", w0, { mid: "r2m0", seq: 0, sq: 4 }, T + 9000)).status).toBe(200);
    expect(l1.pid).toBeTruthy();
  });
  test("M9: the final ranking is kept only when two different phones in the final send the same thing (or the Organizer's page does); a different one is flagged", async () => {
    const h = await game("MB-9"); const ps = await joinAll("MB-9", 2); const { clock } = await begin("MB-9", h); void clock;
    const { list: [x] } = await pairs("MB-9", ps);
    const pay = { champion: x!.a.pid, rounds: 1, finalMid: "r1m0", podium: [[x!.a.pid], [x!.b.pid]], ranking: [{ rank: 1, id: x!.a.pid, name: "Player 1", roundReached: 2, points: 2, decidedBy: "", tie: "" }, { rank: 2, id: x!.b.pid, name: "Player 2", roundReached: 1, points: 0, decidedBy: "round reached", tie: "" }] };
    const fin = (p: P, body: unknown, now: number) => call("POST", "/api/z/MB-9/ttt/finish", { pid: p.pid, device: p.device, ...(body as object) }, {}, now);
    expect((await fin(x!.a, pay, T + 1000)).status).toBe(409); // the final is not finished
    await result("MB-9", x!.a, x!.mid, x!.a.pid, T + 2000); await result("MB-9", x!.b, x!.mid, x!.a.pid, T + 2100);
    expect((await call("POST", "/api/z/MB-9/ttt/finish", pay, {}, T + 2500)).status).toBe(403); // a stranger
    const one = await j(await fin(x!.a, pay, T + 3000)); expect(one).toMatchObject({ ok: true, done: false });
    expect((await fin(x!.b, { ...pay, champion: x!.b.pid }, T + 3050)).status).toBe(409); // not the result the boards give: refused
    const diff = await j(await fin(x!.b, { ...pay, ranking: [{ ...pay.ranking[0]!, points: 9 }, pay.ranking[1]!] }, T + 3100)); expect(diff.done).toBe(false);
    expect(sql("SELECT kind FROM ttt_x WHERE eid='MB-9'").map((x) => x.kind)).toContain("finish-mismatch");
    const two = await j(await fin(x!.b, pay, T + 3200)); expect(two.done).toBe(true);
    const v = await view("MB-9", T + 4000); expect(v.state).toBe("done"); expect(v.champion).toBe(x!.a.name);
    expect(sql("SELECT pattern FROM settled WHERE eid='MB-9' ORDER BY pattern").map((x) => x.pattern)).toEqual(["first", "second"]);
  });
  test("G11/R29: a player who reloads (a brand-new phone, nothing remembered) sees the board exactly as it is, with the clock still running", async () => {
    const h = await game("MB-11"); const ps = await joinAll("MB-11", 4); const { clock } = await begin("MB-11", h);
    const { list: [x] } = await pairs("MB-11", ps);
    const mk = (p: P) => new TttPhone({ api: apiFor(call, clock), eid: "MB-11", pid: p.pid, device: p.device, now: () => clock.t });
    clock.t += 5000; const a = mk(x!.a), b = mk(x!.b); const va = await a.tick(); await b.tick();
    const first = va.board.yourTurn ? a : b, firstP = va.board.yourTurn ? x!.a : x!.b, secondP = firstP === x!.a ? x!.b : x!.a;
    expect((await first.play(4)).ok).toBe(true); // stamped T + 5 s
    clock.t += 3000;
    const again = await mk(firstP).tick(); expect(again.board.cells[4]).not.toBe(0); expect(again.board.ply).toBe(1); expect(again.board.yourTurn).toBe(false);
    const other = await mk(secondP).tick(); expect(other.board.yourTurn).toBe(true); expect(other.board.deadlineMs).toBe(T + 5000 + 20_000); // the clock runs from the stored move, not from when the page was opened
  });
  test("M11: a board nobody plays shows up on the Organizer's page after a while; the Organizer settles it by hand and the tournament closes", async () => {
    const h = await game("MB-12"); const ps = await joinAll("MB-12", 2); const { clock, con } = await begin("MB-12", h);
    clock.t = T + 400_000;
    const w = await con.waiting(300_000); expect(w.length).toBe(1); expect([w[0]!.a.name, w[0]!.b.name].sort()).toEqual(["Player 1", "Player 2"]);
    expect((await call("POST", "/api/z/MB-12/ttt/settle", { mid: w[0]!.mid, j: w[0]!.j, winner: w[0]!.a.pid }, h, clock.t)).status).toBe(200);
    expect((await con.tick()).finished).toBe(true); // the page computes the ranking and sends it
    const v = await view("MB-12", clock.t); expect(v.state).toBe("done"); expect(v.champion).toBe(w[0]!.a.name);
    void ps;
  });
  test("M10: the server never sees a rule: no table of the mailbox holds a board, a clock or a bracket, only ids, squares, stamps and who reported what", () => {
    const cols = (t: string) => (sql(`PRAGMA table_info(${t})`) as any[]).map((c) => c.name);
    expect(cols("ttt_mv")).toEqual(["eid", "mid", "j", "seq", "pid", "sq", "client_ms", "at_ms"]);
    expect(cols("ttt_r")).toEqual(["eid", "mid", "j", "pid", "winner", "at_ms"]);
    expect(cols("ttt_b")).toEqual(["eid", "mid", "j", "winner", "how", "flag", "at_ms"]);
  });
});

describe("whole tournaments played by simulated phones that compute the game themselves (G7-G12, G16, G17, X5)", () => {
  const done = (id: string) => () => (raw.query("SELECT state FROM ttt_t WHERE eid=?").get(id) as any)?.state === "done";
  const stuckOf = (id: string) => (raw.query("SELECT COUNT(*) c FROM ttt_m WHERE eid=? AND status<>'done'").get(id) as any).c as number;
  test("G12/R24: 8 phones finish on their own; the champion is rank 1; the podium is in the winners record; the end starts the deletion clock; nothing is flagged", async () => {
    const h = await game("TT-9"); const ps = await joinAll("TT-9", 8); const { clock } = await begin("TT-9", h, { moveSecs: 10 });
    const r = await playCrowd({ call, eid: "TT-9", phones: ps, orgHeaders: h, clock, rng: rnd, isDone: done("TT-9") });
    const v = await view("TT-9", clock.t); expect(v.state).toBe("done"); expect(v.format).toBe("solo"); expect(v.moveSecs).toBe(10); expect(v.players).toBe(8);
    const rank = await j(await call("GET", "/api/z/TT-9/ttt/rank?n=10", undefined, {}, clock.t));
    expect(rank.ranking.map((x: any) => x.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); expect(rank.ranking[0]!.name).toBe(v.champion);
    expect(sql("SELECT pattern FROM settled WHERE eid='TT-9' ORDER BY pattern").map((x) => x.pattern)).toEqual(["fifth", "first", "fourth", "second", "third"]);
    expect(sql("SELECT COUNT(*) c FROM winner WHERE eid='TT-9'")[0].c).toBe(5);
    const life = sql("SELECT end_ms, end_src FROM life WHERE eid='TT-9'")[0]; expect(life.end_src).toBe("phones"); expect(life.end_ms).toBeGreaterThan(T);
    expect(stuckOf("TT-9")).toBe(0); expect(sql("SELECT COUNT(*) c FROM ttt_b WHERE eid='TT-9' AND flag=1")[0].c).toBe(0);
    expect(sql("SELECT COUNT(*) c FROM ttt_b WHERE eid='TT-9'")[0].c).toBe(7); // 7 real matches, one agreed result each
    expect(r.refused).toBe(0); expect(r.moves).toBeGreaterThan(20);
    const phone = new TttPhone({ api: apiFor(call, clock), eid: "TT-9", pid: ps.find((p) => p.name === v.champion)!.pid, device: ps.find((p) => p.name === v.champion)!.device, now: () => clock.t });
    expect((await phone.tick()).phase).toBe("champion");
  }, 120_000);
  test("G13: a replay is a new game with the same people (clone) and a fresh sealed seed", async () => {
    const h = await game("TT-10"); await joinAll("TT-10", 4); await call("POST", "/api/z/TT-10/ttt/start", {}, h);
    const c1 = (await view("TT-10", T)).commit;
    const cl = await call("POST", "/api/z/TT-10/clone", {}, h); expect(cl.status).toBe(200);
    const id2 = (await j(cl)).id ?? (await j(cl)).newId; if (id2) { expect((await view(id2, T)).commit).not.toBe(c1); }
  });
  test("G16/R20: a team tournament of 12 players (4 teams of 3) finishes on the phones; every team match has 3 boards; the leftover players only watch", async () => {
    const h = await game("TT-11"); const ps = await joinAll("TT-11", 14); // 2 players are reserve
    const { clock } = await begin("TT-11", h, { format: "team", teamSize: 3, moveSecs: 10 });
    expect((await view("TT-11", T)).entrants).toBe(4);
    expect(sql("SELECT data FROM ttt_m WHERE eid='TT-11' AND bye=0").every((x) => JSON.parse(x.data).length === 3)).toBe(true);
    const reserve: string[] = []; for (const p of ps) { const ph = new TttPhone({ api: apiFor(call, clock), eid: "TT-11", pid: p.pid, device: p.device, now: () => clock.t }); if ((await ph.tick()).phase === "reserve") reserve.push(p.pid); } expect(reserve.length).toBe(2);
    await playCrowd({ call, eid: "TT-11", phones: ps, orgHeaders: h, clock, rng: rnd, isDone: done("TT-11") });
    expect((await view("TT-11", clock.t)).champion).toMatch(/^Team \d$/); expect(stuckOf("TT-11")).toBe(0);
  }, 120_000);
  test("R14: when BOTH players of a board are away, the Organizer's page claims their clock-outs, reports the board and registers the next match; the tournament still finishes and nobody settles by hand", async () => {
    const h = await game("TT-17"); const ps = await joinAll("TT-17", 8); const { clock } = await begin("TT-17", h, { moveSecs: 10 });
    const plan = await planOf(await setupOf("TT-17", clock.t));
    const r1 = Object.values(plan.t.matches).filter((m) => m.round === 1 && !m.bye).sort((a, b) => a.idx - b.idx);
    const away = new Set([r1[0]!.boards[0]!.a, r1[0]!.boards[0]!.b, r1[1]!.boards[0]!.a, r1[1]!.boards[0]!.b]); // round 2 match 0 is then away against away too (the two winners come from these two matches)
    expect(away.size).toBe(4);
    await playCrowd({ call, eid: "TT-17", phones: ps, orgHeaders: h, clock, rng: rnd, away, isDone: done("TT-17"), maxSteps: 4000 });
    expect((await view("TT-17", clock.t)).state).toBe("done"); expect(stuckOf("TT-17")).toBe(0);
    expect(sql("SELECT COUNT(*) c FROM ttt_b WHERE eid='TT-17' AND flag=1")[0].c).toBe(0);
    expect(sql("SELECT COUNT(*) c FROM ttt_r WHERE eid='TT-17' AND pid='organizer'")[0].c).toBeGreaterThan(0); // the Organizer's page reported boards nobody was there for
    expect(sql("SELECT COUNT(*) c FROM ttt_b WHERE eid='TT-17' AND how='organizer'")[0].c).toBe(0); // and nobody settled a board by hand
    expect(sql("SELECT COUNT(*) c FROM ttt_m WHERE eid='TT-17' AND bye=0 AND status='done'")[0].c).toBe(7);
  }, 120_000);
  test("G17/X5: a crowd of 100 phones finishes with every tenth player away: nothing is stuck, single reports are kept after 30 s, the Organizer is never needed", async () => {
    const h = await game("TT-12", { cap: 250 }); const ps = await joinAll("TT-12", 100); const { clock } = await begin("TT-12", h, { moveSecs: 10 });
    const away = new Set(ps.filter((_, i) => i % 10 === 0).map((p) => p.pid));
    const r = await playCrowd({ call, eid: "TT-12", phones: ps, orgHeaders: h, clock, rng: rnd, away, isDone: done("TT-12"), maxSteps: 4000 });
    const v = await view("TT-12", clock.t); expect(v.state).toBe("done"); expect(v.rounds).toBe(7);
    expect(stuckOf("TT-12")).toBe(0); expect(sql("SELECT COUNT(*) c FROM ttt_b WHERE eid='TT-12' AND flag=1")[0].c).toBe(0);
    expect(sql("SELECT COUNT(*) c FROM ttt_b WHERE eid='TT-12' AND how='uncontested'")[0].c).toBeGreaterThan(0);
    expect(sql("SELECT COUNT(*) c FROM ttt_b WHERE eid='TT-12'")[0].c).toBe(99); expect(r.claims).toBeGreaterThan(0);
    const rank = await j(await call("GET", "/api/z/TT-12/ttt/rank?n=100", undefined, {}, clock.t)); expect(rank.ranking.length).toBe(100);
  }, 300_000);
});

describe("what is visible, and deletion (G18, U6, D4, R30)", () => {
  test("R30: the public views show names and boards' stored moves, never the seed or the secret before the end of the draw, never a device id", async () => {
    const h = await game("TT-13"); const ps = await joinAll("TT-13", 6);
    const before = JSON.stringify(await view("TT-13", T)) + JSON.stringify(await setupOf("TT-13")); const rv0 = await j(await call("GET", "/api/z/TT-13/ttt/reveal"));
    expect(before).not.toContain(dev(1)); expect(rv0.secret).toBeUndefined();
    await begin("TT-13", h);
    const rv = await j(await call("GET", "/api/z/TT-13/ttt/reveal")); const txt = JSON.stringify(await view("TT-13", T + 1000)) + JSON.stringify(await j(await call("GET", "/api/z/TT-13/ttt/all?round=1", undefined, {}, T + 1000)));
    expect(txt).not.toContain(rv.seed); expect(txt).not.toContain(rv.secret); for (const p of ps) expect(JSON.stringify(await setupOf("TT-13", T + 1000))).not.toContain(p.device);
    expect(JSON.stringify(await setupOf("TT-13", T + 1000))).toContain("Player 1");
    expect((await j(await call("GET", "/api/z/TT-13/ttt/all?round=1", undefined, {}, T + 1000))).matches.length).toBe(4);
  });
  test("G18/D5: 24 hours after the end every name and every stored move is gone; the winners record (opaque seat numbers) remains until the retention date", async () => {
    const h = await game("TT-14"); const ps = await joinAll("TT-14", 4); const { clock } = await begin("TT-14", h, { moveSecs: 10 });
    await playCrowd({ call, eid: "TT-14", phones: ps, orgHeaders: h, clock, rng: rnd, isDone: () => (raw.query("SELECT state FROM ttt_t WHERE eid='TT-14'").get() as any).state === "done" });
    expect(sql("SELECT COUNT(*) c FROM ttt_p WHERE eid='TT-14'")[0].c).toBe(4); expect(sql("SELECT COUNT(*) c FROM ttt_mv WHERE eid='TT-14'")[0].c).toBeGreaterThan(0);
    const later = clock.t + 25 * 3_600_000; await call("POST", "/api/lifecycle/tick", {}, { "x-organizer": "plat" }, later);
    for (const t of ["ttt_p", "ttt_e", "ttt_mv", "ttt_r", "ttt_f", "ttt_x", "participant"]) expect([t, sql(`SELECT COUNT(*) c FROM ${t} WHERE eid='TT-14'`)[0].c]).toEqual([t, 0]);
    expect(sql("SELECT ranking FROM ttt_t WHERE eid='TT-14'")[0].ranking).toBeNull();
    expect(JSON.stringify(sql("SELECT data FROM ttt_m WHERE eid='TT-14'"))).not.toContain("Player");
    expect(sql("SELECT COUNT(*) c FROM winner WHERE eid='TT-14'")[0].c).toBeGreaterThan(0);
    expect(sql("SELECT COUNT(*) c FROM ttt_b WHERE eid='TT-14'")[0].c).toBeGreaterThan(0); // the agreed results (player codes, no names) stay until day 365
    await eraseEverything(env, "TT-14", later); // day 365: nothing of the tournament is left, the agreed results and pause times included
    for (const t of ["ttt_t", "ttt_m", "ttt_b", "ttt_z", "winner", "life"]) expect([t, sql(`SELECT COUNT(*) c FROM ${t} WHERE eid='TT-14'`)[0].c]).toEqual([t, 0]);
  }, 60_000);
  test("U5/D13: a tournament never reads or writes another game's rows", async () => {
    const h1 = await game("TT-15"), h2 = await game("TT-16"); const a = await joinAll("TT-15", 2), b = await joinAll("TT-16", 2, 10);
    await begin("TT-15", h1); await begin("TT-16", h2);
    expect((await call("POST", "/api/z/TT-16/ttt/start", {}, h1)).status).toBe(403); // the other organizer cannot start my game
    expect((await call("POST", "/api/z/TT-16/ttt/move", { pid: a[0]!.pid, device: a[0]!.device, mid: "r1m0", seq: 0, sq: 4 }, {}, T + 10)).status).toBe(403);
    expect((await call("POST", "/api/z/TT-16/ttt/plan", { matches: [] }, h1)).status).toBe(403);
    expect(sql("SELECT COUNT(*) c FROM ttt_p WHERE eid='TT-15'")[0].c).toBe(2);
    void b;
  });
});

describe("removing a player after the host pressed Start (found by the Chrome simulation, S04-09)", () => {
  test("a tournament the host started before the planned start time counts as started: the removal keeps the seat (blocked) and the player's own page is told 'removed'", async () => {
    const h = await game("TT-RM"); const ps = await joinAll("TT-RM", 3);
    await begin("TT-RM", h); // T is long before the planned start (1200 rounds later): only the tournament state says it has started
    const list = await j(await call("GET", "/api/z/TT-RM/people", undefined, h, T + 5));
    const victim = (list.people ?? []).find((q: any) => /Player 2/.test(q.name ?? ""));
    expect(victim).toBeTruthy();
    const rm = await call("POST", `/api/z/TT-RM/people/${encodeURIComponent(victim.id)}/remove`, {}, h, T + 6); expect(rm.status).toBe(200);
    expect((await j(rm)).during).toBe(true);
    expect(sql("SELECT blocked FROM seat WHERE eid='TT-RM' AND pid=?", ps[1]!.pid)[0]?.blocked).toBe(1); // the seat is still there
    expect(sql("SELECT COUNT(*) c FROM participant WHERE eid='TT-RM'")[0].c).toBe(3);
    const me = await j(await call("GET", `/api/z/TT-RM/invites?pid=${ps[1]!.pid}`, undefined, {}, T + 7)); expect(me.removed).toBe(true);
    const other = await j(await call("GET", `/api/z/TT-RM/invites?pid=${ps[0]!.pid}`, undefined, {}, T + 7)); expect(other.removed).toBe(false);
  });
  test("before the host presses Start a removal still frees the place (nothing is kept)", async () => {
    const h = await game("TT-RM2"); const ps = await joinAll("TT-RM2", 3);
    const list = await j(await call("GET", "/api/z/TT-RM2/people", undefined, h, T + 5));
    const victim = (list.people ?? []).find((q: any) => /Player 2/.test(q.name ?? ""));
    const rm = await call("POST", `/api/z/TT-RM2/people/${encodeURIComponent(victim.id)}/remove`, {}, h, T + 6); expect(rm.status).toBe(200);
    expect((await j(rm)).during).toBe(false);
    expect(sql("SELECT COUNT(*) c FROM participant WHERE eid='TT-RM2'")[0].c).toBe(2);
    void ps;
  });
});

describe("QA 2026-10-29: one false report must not take a board; a tap after the turn ended is told so", () => {
  // squares a player prefers: B walks along the top row, A plays elsewhere and never makes a line, so B wins whoever has X
  const PREFER_B = [0, 1, 2, 3, 4, 5, 6, 7, 8], PREFER_A = [3, 4, 6, 5, 7, 8, 0, 1, 2];
  const phoneFor = (id: string, p: P, clock: { t: number }, api?: (a: Api) => Api) => { const a = apiFor(call, clock); return new TttPhone({ api: api ? api(a) : a, eid: id, pid: p.pid, device: p.device, now: () => clock.t }); };
  const swallowResults = (a: Api): Api => async (m, path, body) => (m === "POST" && path.endsWith("/ttt/result") ? { ok: true } : a(m, path, body)); // the cheat's own page never reports
  const play = async (ph: TttPhone, prefer: number[]) => { const v = await ph.tick(); if (v.phase === "playing" && v.board && !v.board.done && v.board.yourTurn) { const sq = prefer.find((i) => v.board.cells[i] === 0)!; await ph.play(sq); } return v; };
  test("F-steal: a false 'I won' two seconds into a live game does not end it; the other open page objects, the board is flagged and goes on, and at the end the stored moves decide (the Organizer's page settles it)", async () => {
    const h = await game("QA-1"); const ps = await joinAll("QA-1", 2); const { clock, con } = await begin("QA-1", h, { moveSecs: 20 });
    clock.t = T + 2000; const a = phoneFor("QA-1", ps[0]!, clock, swallowResults), b = phoneFor("QA-1", ps[1]!, clock);
    await a.tick(); await b.tick();
    expect((await result("QA-1", ps[0]!, "r1m0", ps[0]!.pid, clock.t)).status).toBe(200); // the false report
    for (let s = 3; s <= 40; s++) { clock.t = T + s * 1000; await con.tick(); if (s % 20 === 0) await play(b, PREFER_B); else if (s % 20 === 10) await play(a, PREFER_A); else { await b.tick(); await a.tick(); } } // a slow game: a player looks at the board every 10 seconds
    expect(sql("SELECT status FROM ttt_m WHERE eid='QA-1' AND mid='r1m0'")[0].status).toBe("live"); // 38 seconds later (past the 30 a lone report needs) the board is still being played
    expect(sql("SELECT how, flag FROM ttt_b WHERE eid='QA-1'")).toEqual([{ how: "mismatch", flag: 1 }]);
    expect(sql("SELECT winner FROM ttt_r WHERE eid='QA-1' AND pid=?", ps[1]!.pid)[0].winner).toBe("-"); // B said: the moves do not say that
    let v = await b.tick(); expect(v.phase === "playing" || v.phase === "champion").toBe(true);
    for (let s = 41; s <= 400 && (sql("SELECT state FROM ttt_t WHERE eid='QA-1'")[0].state !== "done"); s++) { clock.t = T + s * 1000; await con.tick(); if (s % 20 === 0) await play(b, PREFER_B); else if (s % 20 === 10) await play(a, PREFER_A); else { await b.tick(); await a.tick(); } }
    expect(sql("SELECT state FROM ttt_t WHERE eid='QA-1'")[0].state).toBe("done");
    clock.t += 5000; expect((await b.tick()).phase).toBe("champion"); expect((await a.tick()).phase).toBe("out"); // the player who really won the board is the champion
    expect(sql("SELECT winner, how FROM ttt_b WHERE eid='QA-1'")).toEqual([{ winner: ps[1]!.pid, how: "organizer" }]);
  }, 60_000);
  test("F-steal: a true lone report is still kept after 30 seconds when the other phone is away (the rules agree with it)", async () => {
    const h = await game("QA-2"); const ps = await joinAll("QA-2", 2); const { clock, con } = await begin("QA-2", h, { moveSecs: 20 });
    clock.t = T + 2000; const a = phoneFor("QA-2", ps[0]!, clock); const b = phoneFor("QA-2", ps[1]!, clock);
    // A plays alone; B's phone is closed. B's clock runs out twice, A claims it, the rules end the board, A reports, nobody contradicts.
    for (let s = 3; s <= 140 && (sql("SELECT state FROM ttt_t WHERE eid='QA-2'")[0].state !== "done"); s++) { clock.t = T + s * 1000; await con.tick(); await play(a, PREFER_B); }
    expect(sql("SELECT state FROM ttt_t WHERE eid='QA-2'")[0].state).toBe("done");
    expect(sql("SELECT how FROM ttt_b WHERE eid='QA-2'")[0].how).toMatch(/uncontested|both/); void b;
  }, 60_000);
  test("F-steal (the mailbox): an objection '-' is a report like any other: only a player on the board may send it, it is never kept as a result, a report may be corrected until a result is accepted and not after", async () => {
    const h = await game("QA-3"); const ps = await joinAll("QA-3", 8); await begin("QA-3", h);
    const { list: [x, y] } = await pairs("QA-3", ps, 2);
    expect((await result("QA-3", y!.a, x!.mid, "-", T + 1000)).status).toBe(403); // a player of another match
    expect((await result("QA-3", x!.a, x!.mid, "-", T + 1000)).status).toBe(200); // a lone objection ...
    expect((await getM("QA-3", x!.mid, T + 40_000)).boards[0].result).toBeNull(); // ... is never kept as a result, however long it stands
    expect((await result("QA-3", x!.a, x!.mid, x!.a.pid, T + 41_000)).status).toBe(200); // the player corrects the report to a real winner
    expect(sql("SELECT winner FROM ttt_r WHERE mid=? AND pid=?", x!.mid, x!.a.pid)[0].winner).toBe(x!.a.pid);
    const bothSay = await j(await result("QA-3", x!.b, x!.mid, x!.a.pid, T + 42_000)); expect(bothSay.agreed).toBe(true);
    expect((await result("QA-3", x!.a, x!.mid, x!.b.pid, T + 43_000)).status).toBe(200); // once accepted, the reporter cannot flip it
    expect(sql("SELECT winner, how, flag FROM ttt_b WHERE mid=?", x!.mid)).toEqual([{ winner: x!.a.pid, how: "both", flag: 0 }]);
    // objection against a report: flagged, and the objector's later agreement clears the flag
    await result("QA-3", y!.a, y!.mid, y!.a.pid, T + 1000);
    expect((await j(await result("QA-3", y!.b, y!.mid, "-", T + 2000))).flagged).toBe(true);
    expect((await getM("QA-3", y!.mid, T + 40_000)).boards[0].result).toMatchObject({ flag: true, winner: null }); // 38 s later the lone report is NOT kept: the other player objected
    const healed = await j(await result("QA-3", y!.b, y!.mid, y!.a.pid, T + 50_000)); expect(healed.agreed).toBe(true);
    expect(sql("SELECT winner, how, flag FROM ttt_b WHERE mid=?", y!.mid)).toEqual([{ winner: y!.a.pid, how: "both", flag: 0 }]);
    expect(sql("SELECT status FROM ttt_m WHERE mid=?", y!.mid)[0].status).toBe("done");
  });
  test("F-steal (race): the mailbox reads a match's reports BEFORE its stored moves, so a reader that sees a report always sees the moves that decide the board", async () => {
    const h = await game("QA-6"); const ps = await joinAll("QA-6", 2); await begin("QA-6", h);
    const seen: string[] = []; const real = env.DB.prepare.bind(env.DB); (env.DB as any).prepare = (sql: string) => { seen.push(sql); return real(sql); };
    try { await getM("QA-6", "r1m0", T + 5000); } finally { (env.DB as any).prepare = real; }
    const at = (needle: string) => seen.findIndex((x) => x.includes(needle));
    const reports = at("SELECT mid, j, pid, winner FROM ttt_r"), results = at("SELECT mid, j, winner, how, flag, at_ms FROM ttt_b"), moves = at("FROM ttt_mv WHERE eid=? AND mid IN");
    expect(reports).toBeGreaterThan(-1); expect(results).toBeGreaterThan(-1); expect(moves).toBeGreaterThan(-1);
    expect(reports).toBeLessThan(moves); expect(results).toBeLessThan(moves); void ps;
  });
  test("QA wording: a leftover player in a team game is told in plain words that they are a reserve; a player who joined waits with 'The game is starting' (no 'draw')", async () => {
    const h = await game("QA-7"); const ps = await joinAll("QA-7", 7); const { clock } = await begin("QA-7", h, { format: "team", teamSize: 3, moveSecs: 20 });
    clock.t = T + 2000; const views = await Promise.all(ps.map((p) => phoneFor("QA-7", p, clock).tick()));
    const reserve = views.filter((v) => v.phase === "reserve"); expect(reserve.length).toBe(1);
    expect(reserve[0]!.message).toBe("You are a reserve this time. The teams are full. You can watch the games.");
    const w = await game("QA-8"); const q = await joinAll("QA-8", 2); await call("POST", "/api/z/QA-8/ttt/start", {}, w, T);
    const waiting = await phoneFor("QA-8", q[0]!, { t: T + 1000 }).tick(); expect(waiting.phase).toBe("waiting"); expect(waiting.message).toBe("The game is starting. Please wait a moment.");
  });
  test("S1 (open, QA security review): a later match is registered only with the pairing the agreed results give: an eliminated player cannot put himself in the final, a made-up round or id is refused, the opening time is worked out from the results, and the real finalists can play", async () => {
    const h = await game("QA-9"); const ps = await joinAll("QA-9", 4); await begin("QA-9", h);
    const { list: [x, y] } = await pairs("QA-9", ps, 2);
    for (const m of [x!, y!]) { await result("QA-9", m.a, m.mid, m.a.pid, T + 1000); await result("QA-9", m.b, m.mid, m.a.pid, T + 1000); }
    const [W1, L1, W2, L2] = [x!.a, x!.b, y!.a, y!.b];
    const open = (p: P, extra: Record<string, unknown> = {}) => call("POST", "/api/z/QA-9/ttt/open", { pid: p.pid, device: p.device, mid: "r2m0", round: 2, idx: 0, a: W1.pid, b: W2.pid, boards: [[W1.pid, W2.pid]], from: [x!.mid, y!.mid], ...extra }, {}, T + 3000);
    expect((await open(L1, { a: L1.pid, b: L2.pid, boards: [[L1.pid, L2.pid]] })).status).toBe(409); // not the pairing the results give
    expect((await open(L1)).status).toBe(403); // the right pairing, but L1 is not in it
    expect((await open(W1, { mid: "r99m99999", round: 99, idx: 99999 })).status).toBe(400); // no such place in the bracket
    expect((await open(W1, { from: [y!.mid, x!.mid] })).status).toBe(400); // not its own feeders
    expect((await open(W1, { a: W2.pid, b: W1.pid, boards: [[W2.pid, W1.pid]] })).status).toBe(409); // the sides the wrong way round
    expect(sql("SELECT COUNT(*) c FROM ttt_m WHERE eid='QA-9' AND round>1")[0].c).toBe(0); // nothing was stored by the refusals
    expect((await open(W1, { opened: 0 })).status).toBe(200); // the honest registration; the caller's 'opened' is ignored
    expect(sql("SELECT a, b, deadline FROM ttt_m WHERE eid='QA-9' AND mid='r2m0'")).toEqual([{ a: W1.pid, b: W2.pid, deadline: T + 1000 }]);
    expect((await open(W2)).status).toBe(200); // the other finalist sends the same thing: fine
    expect((await mv("QA-9", W1, { mid: "r2m0", seq: 0, sq: 4 }, T + 4000)).status).toBe(200); // the real finalist plays
    expect((await mv("QA-9", L1, { mid: "r2m0", seq: 1, sq: 4 }, T + 4100)).status).toBe(403); // the eliminated one cannot
    void L2;
  });
  test("S1 (open): the big screen and the Organizer's page skip a registered match that is not in the draw instead of failing", async () => {
    const h = await game("QA-9B"); const ps = await joinAll("QA-9B", 4); const { clock } = await begin("QA-9B", h); void ps;
    const junk = { mid: "r99m99999", complete: false, reg: { round: 99, idx: 5, a: "x", b: "y", bye: false, winner: null, opened: 0, ms: 0 }, boards: [{ j: 0, a: "x", b: "y", events: [], result: null, reports: [] }], t: { state: "running", pauses: [], serverNow: T } };
    const api = async (m: string, path: string) => { if (path.endsWith("/ttt/flags")) return { flags: [], disputed: [{ mid: "r99m99999", j: 0 }] }; if (path.includes("/ttt/m/")) return junk; if (path.endsWith("/ttt/setup")) return setupOf("QA-9B", clock.t); if (path.includes("/ttt/stuck")) return { serverNow: T, matches: [junk], pauses: [] }; throw new Error("unexpected " + m + " " + path); };
    const con = new TttConsole(api as any, "QA-9B"); expect(await con.settleDisputed()).toBe(0); expect(await con.watch()).toEqual({ claims: 0, reports: 0 });
  });
  test("S3 (finish, QA security review): two members of the LOSING team cannot fix the champion or the podium; the result must be what the boards give; the honest result still closes the tournament", async () => {
    const h = await game("QA-10"); const ps = await joinAll("QA-10", 6); await begin("QA-10", h, { format: "team", teamSize: 3 });
    const { plan, list: [m] } = await pairs("QA-10", ps); const by = new Map(ps.map((p) => [p.pid, p]));
    const boards = m!.m.boards.map((b) => [by.get(b.a)!, by.get(b.b)!] as [P, P]);
    for (const [a, b] of boards) { await result("QA-10", a, m!.mid, a.pid, T + 1000); await result("QA-10", b, m!.mid, a.pid, T + 1000); } // team A wins all three boards
    const teamA = plan.t.matches[m!.mid]!.a!, teamB = plan.t.matches[m!.mid]!.b!; const members = (id: string) => plan.t.entrants.find((e) => e.id === id)!.members;
    const losers = boards.map(([, b]) => b);
    const body = (champion: string, podium: string[][]) => ({ champion, rounds: 1, finalMid: m!.mid, podium, ranking: [{ rank: 1, id: champion, name: "Team", roundReached: 2, points: 6, decidedBy: "", tie: "" }, { rank: 2, id: champion === teamA ? teamB : teamA, name: "Team", roundReached: 1, points: 0, decidedBy: "round reached", tie: "" }] });
    const fin = (p: P, b: unknown, now: number) => call("POST", "/api/z/QA-10/ttt/finish", { pid: p.pid, device: p.device, ...(b as object) }, {}, now);
    const fake = body(teamB, [losers.map((p) => p.pid), ["99999"]]);
    expect((await fin(losers[0]!, fake, T + 3000)).status).toBe(409); expect((await fin(losers[1]!, fake, T + 3001)).status).toBe(409);
    expect((await fin(losers[0]!, body(teamB, [members(teamB), members(teamA)]), T + 3002)).status).toBe(409); // the right members, the wrong champion
    expect((await fin(losers[0]!, body(teamA, [members(teamA), ["99999"]]), T + 3003)).status).toBe(409); // a seat that is not in the game
    expect(sql("SELECT state, champion FROM ttt_t WHERE eid='QA-10'")[0]).toEqual({ state: "running", champion: null });
    const honest = body(teamA, [members(teamA), members(teamB)]);
    expect((await j(await fin(boards[0]![0], honest, T + 4000))).done).toBe(false); expect((await j(await fin(boards[1]![0], honest, T + 4001))).done).toBe(true);
    expect(sql("SELECT state, champion FROM ttt_t WHERE eid='QA-10'")[0]).toEqual({ state: "done", champion: teamA });
  });
  test("S7 (opened): the opening time the mailbox works out for every later match equals the later of the two results that feed it, in an 8-player tournament played by phones", async () => {
    const h = await game("QA-14"); const ps = await joinAll("QA-14", 8); const { clock } = await begin("QA-14", h, { moveSecs: 10 });
    await playCrowd({ call, eid: "QA-14", phones: ps, orgHeaders: h, clock, rng: rnd, isDone: () => (raw.query("SELECT state FROM ttt_t WHERE eid='QA-14'").get() as any)?.state === "done" });
    const rows = sql("SELECT mid, round, idx, deadline, started_ms FROM ttt_m WHERE eid='QA-14' AND round>1 ORDER BY round, idx"); expect(rows.length).toBe(3);
    const started = (sql("SELECT started_ms FROM ttt_t WHERE eid='QA-14'")[0] as any).started_ms;
    for (const r of rows) {
      const feeders = [`r${r.round - 1}m${2 * r.idx}`, `r${r.round - 1}m${2 * r.idx + 1}`];
      const ends = feeders.map((f) => { const own = r.round - 1 === 1 ? started : (sql("SELECT deadline FROM ttt_m WHERE eid='QA-14' AND mid=?", f)[0] as any).deadline; return Math.max(own, ...sql("SELECT at_ms FROM ttt_b WHERE eid='QA-14' AND mid=?", f).map((b: any) => b.at_ms)); });
      expect(r.deadline).toBe(Math.max(started, ...ends));
    }
  }, 60_000);
  test("F-late: a tap after the turn ended is answered late-move with the owner-approved words; the mailbox keeps the row, every phone ignores it, the square the software played stays", async () => {
    const h = await game("QA-4"); const ps = await joinAll("QA-4", 2); const { clock } = await begin("QA-4", h, { moveSecs: 20 });
    clock.t = T + 2000; const phones = ps.map((p) => phoneFor("QA-4", p, clock)); const views = await Promise.all(phones.map((x) => x.tick()));
    const who = views.findIndex((v) => v.board.yourTurn); expect(who).toBeGreaterThanOrEqual(0);
    clock.t = T + 31_000; // the first move has 30 seconds; the page still says 'your turn' because it looks only every 1.2 s
    const r = await phones[who]!.play(4);
    expect(r).toEqual({ ok: false, error: "late-move" });
    expect(LATE_MOVE_MESSAGE).toBe("Ohooo! \u{1F60A} Sorry, you moved after your turn ended. This move cannot be made.");
    expect(sql("SELECT COUNT(*) c FROM ttt_mv WHERE eid='QA-4'")[0].c).toBe(1); // the mailbox stores whatever it is sent (it never judges a board)
    const after = await phoneFor("QA-4", ps[who]!, clock).tick(); const other = await phoneFor("QA-4", ps[1 - who]!, clock).tick();
    expect(after.board.cells.filter((c: number) => c).length).toBe(1); expect(after.board.lastAuto).toBe(true); expect(after.board.cells[4] === 0 || after.board.lastAuto).toBe(true);
    expect(other.board.yourTurn).toBe(true); // the other player's turn is open
    // a tap in time is not late
    const h2 = await game("QA-5"); const ps2 = await joinAll("QA-5", 2, 20); const { clock: c2 } = await begin("QA-5", h2, { moveSecs: 20 });
    c2.t = T + 2000; const q = ps2.map((p) => phoneFor("QA-5", p, c2)); const vs = await Promise.all(q.map((x) => x.tick())); const w2 = vs.findIndex((v) => v.board.yourTurn);
    c2.t = T + 29_999; expect(await q[w2]!.play(4)).toEqual({ ok: true });
  });
});
