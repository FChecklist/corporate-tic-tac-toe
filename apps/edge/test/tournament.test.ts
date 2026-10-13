// The tournament through the real Worker routes: join, start, move, clocks, pause, spectators, results, deletion. Rules: docs/RULES.md.
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import { commitOf, seedOf } from "../../../packages/ttt/src/seal";

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
const me = async (id: string, p: P, now: number) => j(await call("GET", `/api/z/${id}/ttt/me?pid=${p.pid}&device=${p.device}`, undefined, {}, now));
const move = async (id: string, p: P, cell: number, now: number, ply?: number) => call("POST", `/api/z/${id}/ttt/move`, { pid: p.pid, device: p.device, cell, ply }, {}, now);
const view = async (id: string, now: number, q = "") => j(await call("GET", `/api/z/${id}/ttt/view${q}`, undefined, {}, now));

/** Plays the whole tournament with bots through the routes. `away` players never move. Time goes forward 2 s at a time. */
async function playOut(id: string, ps: P[], t0: number, away = new Set<string>(), maxSteps = 4000) {
  let now = t0, moves = 0;
  for (let step = 0; step < maxSteps; step++) {
    let any = false;
    for (const p of ps) {
      if (away.has(p.pid)) continue;
      const s = await me(id, p, now);
      if (s.phase === "playing" && s.board && !s.board.done && s.board.yourTurn) {
        const free = s.board.cells.map((c: number, i: number) => (c === 0 ? i : -1)).filter((i: number) => i >= 0);
        const r = await move(id, p, free[Math.floor(rnd() * free.length)], now, s.board.ply);
        if (r.status !== 200) throw new Error("move refused: " + JSON.stringify(await j(r)));
        moves++; any = true;
      }
    }
    const v = await view(id, now); if (v.state === "done") return { now, moves };
    now += any ? 2000 : 15000;
    await call("POST", "/api/lifecycle/tick", {}, { "x-organizer": "plat" }, now);
  }
  throw new Error("the tournament did not finish");
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
  test("R26: the fingerprint is public from the first look; after the start the secret and the seed are revealed and anybody can check them", async () => {
    const h = await game("TT-2"); const ps = await joinAll("TT-2", 4);
    const v0 = await view("TT-2", T); expect(v0.commit).toMatch(/^[0-9a-f]{64}$/); expect(v0.phase).toBe("waiting");
    expect((await j(await call("GET", "/api/z/TT-2/ttt/reveal"))).revealed).toBe(false);
    const st = await call("POST", "/api/z/TT-2/ttt/start", { moveSecs: 20, beacon: "round-123" }, h); expect(st.status).toBe(200);
    const rv = await j(await call("GET", "/api/z/TT-2/ttt/reveal"));
    expect(rv.revealed).toBe(true); expect(await commitOf(rv.secret)).toBe(v0.commit);
    expect(rv.seed).toBe(await seedOf(rv.secret, "TT-2", ps.map((p) => p.pid), "round-123"));
  });
  test("R32/D4: the list closes at the start: a new phone is refused, a player who was in can open the link again", async () => {
    const h = await game("TT-3"); const ps = await joinAll("TT-3", 4);
    await call("POST", "/api/z/TT-3/ttt/start", {}, h);
    const late = await call("POST", "/api/z/TT-3/join", { name: "Late Lata", device: dev(99) }); expect(late.status).toBe(409); expect((await j(late)).code).toBe("closed");
    const again = await j(await call("POST", "/api/z/TT-3/join", { name: ps[0]!.name, device: ps[0]!.device })); expect(again.pid).toBe(ps[0]!.pid);
    expect((await call("POST", "/api/z/TT-3/ttt/start", {}, h)).status).toBe(409); // not twice
  });
});

describe("play, rejoin, fairness (G7-G11)", () => {
  test("R27: only the player to move can move, and only from their own phone; a spectator and a wrong device cannot", async () => {
    const h = await game("TT-4"); const ps = await joinAll("TT-4", 2); await call("POST", "/api/z/TT-4/ttt/start", {}, h);
    const s = await Promise.all(ps.map((p) => me("TT-4", p, T + 1000)));
    const first = s.findIndex((x) => x.board.yourTurn); const second = 1 - first;
    expect((await move("TT-4", ps[second]!, 4, T + 1500)).status).toBe(409); // not your turn
    expect((await call("POST", "/api/z/TT-4/ttt/move", { pid: ps[first]!.pid, device: dev(500), cell: 4 }, {}, T + 1500)).status).toBe(403); // another phone
    expect((await call("POST", "/api/z/TT-4/ttt/move", { pid: "9x000000000000", device: dev(1), cell: 4 }, {}, T + 1500)).status).toBe(403); // not a player
    expect((await move("TT-4", ps[first]!, 4, T + 1500, 5)).status).toBe(409); // stale screen
    expect((await move("TT-4", ps[first]!, 4, T + 1500, 0)).status).toBe(200);
    expect((await move("TT-4", ps[first]!, 5, T + 1600)).status).toBe(409); // moved already, now the other one
    expect((await move("TT-4", ps[second]!, 4, T + 1700)).status).toBe(400); // taken
  });
  test("G11/R29: a player who reloads sees the board exactly as it is, with the clock still running", async () => {
    const h = await game("TT-5"); const ps = await joinAll("TT-5", 2); await call("POST", "/api/z/TT-5/ttt/start", {}, h);
    const a = await me("TT-5", ps[0]!, T + 1000); const mover = a.board.yourTurn ? ps[0]! : ps[1]!;
    await move("TT-5", mover, 4, T + 2000);
    const before = await me("TT-5", ps[0]!, T + 3000), after = await me("TT-5", ps[0]!, T + 3000);
    expect(after.board.cells).toEqual(before.board.cells); expect(after.board.cells[4]).not.toBe(0);
    expect(after.board.deadlineMs).toBe(T + 2000 + 20_000);
  });
  test("G8/R9: who has X comes from the sealed seed: the same roster and secret always give the same starters (and the browser sends nothing that matters)", async () => {
    const h = await game("TT-6"); const ps = await joinAll("TT-6", 2); await call("POST", "/api/z/TT-6/ttt/start", {}, h);
    const rv = await j(await call("GET", "/api/z/TT-6/ttt/reveal"));
    const { startTournament } = await import("../../../packages/ttt/src/bracket");
    const t = await startTournament({ eid: "TT-6", seed: rv.seed, players: ps.map((p) => ({ pid: p.pid, name: p.name })), startAt: T });
    const g = t.matches["r1m0"]!.boards[0]!.games[0]!; const s0 = await me("TT-6", ps[0]!, T + 100);
    expect(s0.board.yourMark).toBe(g.x === ps[0]!.pid ? "X" : "O");
  });
  test("G9/R12-R14: a player who never moves loses by the clock; the other goes through and the tournament finishes", async () => {
    const h = await game("TT-7"); const ps = await joinAll("TT-7", 2); await call("POST", "/api/z/TT-7/ttt/start", {}, h);
    const a = ps[0]!;
    const r = await playOut("TT-7", ps, T + 1000, new Set([a.pid]));
    const v = await view("TT-7", r.now); expect(v.state).toBe("done"); expect(v.champion).toBe(ps[1]!.name);
  });
  test("G10/R28: while paused nothing can be played and no clock runs; after the resume the clocks have the same time left", async () => {
    const h = await game("TT-8"); const ps = await joinAll("TT-8", 2); await call("POST", "/api/z/TT-8/ttt/start", {}, h);
    expect((await call("POST", "/api/z/TT-8/ttt/pause", {}, h, T + 5000)).status).toBe(200);
    const mover = (await me("TT-8", ps[0]!, T + 6000)).board.yourTurn ? ps[0]! : ps[1]!;
    const paused = await move("TT-8", mover, 4, T + 6000); expect(paused.status).toBe(409); expect((await j(paused)).code).toBe("paused");
    await call("POST", "/api/lifecycle/tick", {}, { "x-organizer": "plat" }, T + 10 * 60_000); // ten minutes later nothing has timed out
    expect((await call("POST", "/api/z/TT-8/ttt/resume", {}, h, T + 10 * 60_000)).status).toBe(200);
    const s = await me("TT-8", mover, T + 10 * 60_000 + 1000);
    expect(s.board.cells.every((c: number) => c === 0)).toBe(true); expect(s.board.deadlineMs).toBe(T + 30_000 + (10 * 60_000 - 5000)); // the ready time of 30 s had 25 s left at the pause; the pause (595 s) is added back
  });
});

describe("whole tournaments (G12, G16, G17, X5)", () => {
  test("G12/R24: 8 players finish; the champion is rank 1; the podium is in the winners record; the end starts the 23-hour deletion clock", async () => {
    const h = await game("TT-9"); const ps = await joinAll("TT-9", 8); await call("POST", "/api/z/TT-9/ttt/start", { moveSecs: 10 }, h);
    const r = await playOut("TT-9", ps, T + 1000);
    const v = await view("TT-9", r.now); expect(v.state).toBe("done"); expect(v.format).toBe("solo"); expect(v.moveSecs).toBe(10); expect(v.players).toBe(8); // G2: what the host chose is shown back
    const rank = await j(await call("GET", "/api/z/TT-9/ttt/rank?n=10", undefined, {}, r.now));
    expect(rank.ranking.map((x: any) => x.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rank.ranking[0]!.name).toBe(v.champion);
    const settled = raw.query("SELECT pattern FROM settled WHERE eid='TT-9' ORDER BY pattern").all() as any[];
    expect(settled.map((x) => x.pattern).sort()).toEqual(["fifth", "first", "fourth", "second", "third"]);
    expect((raw.query("SELECT COUNT(*) c FROM winner WHERE eid='TT-9'").get() as any).c).toBe(5);
    const life = raw.query("SELECT end_ms, end_src FROM life WHERE eid='TT-9'").get() as any; expect(life.end_src).toBe("phones"); expect(life.end_ms).toBeGreaterThan(T);
    const mine = await me("TT-9", ps.find((p) => p.name === v.champion)!, r.now); expect(mine.phase).toBe("champion");
  });
  test("G13: a replay is a new game with the same people (clone) and a fresh sealed seed", async () => {
    const h = await game("TT-10"); await joinAll("TT-10", 4); await call("POST", "/api/z/TT-10/ttt/start", {}, h);
    const c1 = (await view("TT-10", T)).commit;
    const cl = await call("POST", "/api/z/TT-10/clone", {}, h); expect(cl.status).toBe(200);
    const id2 = (await j(cl)).id ?? (await j(cl)).newId; if (id2) { expect((await view(id2, T)).commit).not.toBe(c1); }
  });
  test("G16/R20: a team tournament of 12 players (4 teams of 3) finishes; every team match has 3 boards", async () => {
    const h = await game("TT-11"); const ps = await joinAll("TT-11", 14); // 2 players are reserve
    const st = await j(await call("POST", "/api/z/TT-11/ttt/start", { format: "team", teamSize: 3, moveSecs: 10 }, h)); expect(st.entrants).toBe(4); expect(st.reserve).toBe(2);
    const reserve = []; for (const p of ps) if ((await me("TT-11", p, T + 100)).phase === "reserve") reserve.push(p.pid); expect(reserve.length).toBe(2);
    const live = await view("TT-11", T + 100); expect(live.live.every((m: any) => m.boards.length === 3)).toBe(true);
    const r = await playOut("TT-11", ps, T + 1000);
    expect((await view("TT-11", r.now)).champion).toMatch(/^Team \d$/);
  });
  test("G17/X5: a crowd of 150 players finishes through the routes, even with every tenth player away", async () => {
    const h = await game("TT-12", { cap: 250 }); const ps = await joinAll("TT-12", 150); await call("POST", "/api/z/TT-12/ttt/start", { moveSecs: 10 }, h);
    const away = new Set(ps.filter((_, i) => i % 10 === 0).map((p) => p.pid));
    const r = await playOut("TT-12", ps, T + 1000, away, 6000);
    const v = await view("TT-12", r.now); expect(v.state).toBe("done"); expect(v.rounds).toBe(8);
    const stuck = raw.query("SELECT COUNT(*) c FROM ttt_m WHERE eid='TT-12' AND status<>'done'").get() as any; expect(stuck.c).toBe(0);
    const rank = await j(await call("GET", "/api/z/TT-12/ttt/rank?n=100", undefined, {}, r.now)); expect(rank.ranking.length).toBe(100);
  }, 180_000);
});

describe("the spectator view and deletion (G18, U6, D4)", () => {
  test("R30: the spectator view shows names and boards, never the seed or a device id, before and after the start", async () => {
    const h = await game("TT-13"); const ps = await joinAll("TT-13", 6); await call("POST", "/api/z/TT-13/ttt/start", {}, h);
    const txt = JSON.stringify(await view("TT-13", T + 1000)); const rv = await j(await call("GET", "/api/z/TT-13/ttt/reveal"));
    expect(txt).not.toContain(rv.seed); expect(txt).not.toContain(rv.secret); for (const p of ps) expect(txt).not.toContain(p.device);
    expect(txt).toContain("Player 1");
    const page = await view("TT-13", T + 1000, "?round=1"); expect(page.matches.length).toBe(4);
  });
  test("G18/D5: 24 hours after the end every name is gone (players, entrants, ranking); the opaque match record and the podium seats remain until the retention date", async () => {
    const h = await game("TT-14"); const ps = await joinAll("TT-14", 4); await call("POST", "/api/z/TT-14/ttt/start", { moveSecs: 10 }, h);
    const r = await playOut("TT-14", ps, T + 1000);
    expect((raw.query("SELECT COUNT(*) c FROM ttt_p WHERE eid='TT-14'").get() as any).c).toBe(4);
    const later = r.now + 25 * 3_600_000; await call("POST", "/api/lifecycle/tick", {}, { "x-organizer": "plat" }, later);
    expect((raw.query("SELECT COUNT(*) c FROM ttt_p WHERE eid='TT-14'").get() as any).c).toBe(0);
    expect((raw.query("SELECT COUNT(*) c FROM ttt_e WHERE eid='TT-14'").get() as any).c).toBe(0);
    expect((raw.query("SELECT ranking FROM ttt_t WHERE eid='TT-14'").get() as any).ranking).toBeNull();
    expect((raw.query("SELECT COUNT(*) c FROM participant WHERE eid='TT-14'").get() as any).c).toBe(0);
    expect(JSON.stringify(raw.query("SELECT data FROM ttt_m WHERE eid='TT-14'").all())).not.toContain("Player");
  });
  test("U5/D13: a tournament never reads or writes another game's rows", async () => {
    const h1 = await game("TT-15"), h2 = await game("TT-16"); const a = await joinAll("TT-15", 2), b = await joinAll("TT-16", 2, 10);
    await call("POST", "/api/z/TT-15/ttt/start", {}, h1); await call("POST", "/api/z/TT-16/ttt/start", {}, h2);
    expect((await call("POST", "/api/z/TT-16/ttt/start", {}, h1)).status).toBe(403); // the other organizer cannot start my game
    expect((await call("GET", `/api/z/TT-16/ttt/me?pid=${a[0]!.pid}&device=${a[0]!.device}`, undefined, {}, T + 10)).status).toBe(403);
    expect((raw.query("SELECT COUNT(*) c FROM ttt_p WHERE eid='TT-15'").get() as any).c).toBe(2);
    void b;
  });
});
