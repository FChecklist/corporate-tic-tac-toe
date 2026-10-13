// docs/RULES.md sections D to G: R16 to R30 (formats, byes, teams, crowd, ranking, the sealed seed, the spectator view).
import { describe, expect, test } from "bun:test";
import { boardOf, layout, moveInTournament, publicView, rankings, startTournament, tieLine, advanceTournament, type Tournament } from "../src/bracket";
import { commitOf, newSecret, seedOf, verifyReveal } from "../src/seal";
import { drive, lcg } from "./drive";

const T0 = 5_000_000;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ pid: `p${String(i + 1).padStart(4, "0")}`, name: `Player ${i + 1}` }));
const start = (n: number, seed = "seed-1", extra: Record<string, unknown> = {}) => startTournament({ eid: "E1", seed, players: people(n), startAt: T0, moveMs: 10_000, readyMs: 15_000, ...extra });
const real = (t: Tournament) => Object.values(t.matches).filter((m) => !m.bye);

describe("R16-R18, R22 the knockout", () => {
  test("R16/R18: for every crowd size from 2 to 40 the bracket finishes with one champion and N-1 played matches", async () => {
    for (let n = 2; n <= 40; n++) {
      const t = await start(n, `seed-${n}`); await drive(t, T0, { rng: lcg(n) });
      expect([n, t.done]).toEqual([n, true]);
      expect([n, real(t).length]).toEqual([n, n - 1]);
      expect(t.entrants.some((e) => e.id === t.champion)).toBe(true);
      expect(t.matches[`r${t.rounds}m0`]!.winner).toBe(t.champion!);
    }
  });
  test("R16: one player is champion at once; zero players is refused", async () => {
    const t = await start(1); expect(t.done).toBe(true); expect(t.champion).toBe("p0001");
    await expect(start(0)).rejects.toThrow();
  });
  test("R17: byes - only in round 1, never two empty places in one pair, as many byes as empty places", async () => {
    for (const n of [3, 5, 6, 7, 9, 11, 13, 17, 31, 33, 100]) {
      const t = await start(n);
      const byes = Object.values(t.matches).filter((m) => m.bye);
      expect([n, byes.length]).toEqual([n, t.size - n]);
      expect(byes.every((m) => m.round === 1 && m.status === "done" && m.winner && (!!m.a !== !!m.b))).toBe(true);
      expect(Object.values(t.matches).filter((m) => m.round === 1).every((m) => m.a || m.b)).toBe(true);
    }
  });
  test("R17: layout puts the first half in even places and the rest in odd places", () => {
    expect(layout(["a", "b", "c", "d", "e"], 8)).toEqual(["a", "e", "b", null, "c", null, "d", null]);
  });
  test("R22: a later match opens the moment both of its feeders are finished, not later", async () => {
    const t = await start(8); // 4 matches in round 1
    await drive(t, T0, { rng: lcg(3) });
    for (const m of real(t).filter((x) => x.round > 1)) {
      const f1 = t.matches[`r${m.round - 1}m${2 * m.idx}`]!, f2 = t.matches[`r${m.round - 1}m${2 * m.idx + 1}`]!;
      expect(m.startedAt).toBe(Math.max(t.startAt, f1.doneAt!, f2.doneAt!));
      expect([f1.winner, f2.winner]).toContain(m.a!);
    }
  });
  test("R18: the roster order does not matter, the same people and seed give the same bracket", async () => {
    const a = await startTournament({ eid: "E1", seed: "S", players: people(20), startAt: T0 });
    const b = await startTournament({ eid: "E1", seed: "S", players: [...people(20)].reverse(), startAt: T0 });
    expect(JSON.stringify(a.matches)).toBe(JSON.stringify(b.matches));
    const c = await startTournament({ eid: "E1", seed: "S2", players: people(20), startAt: T0 });
    expect(JSON.stringify(c.matches)).not.toBe(JSON.stringify(a.matches));
  });
  test("a player listed twice is refused", async () => { await expect(startTournament({ eid: "E", seed: "s", players: [{ pid: "a", name: "A" }, { pid: "a", name: "B" }], startAt: T0 })).rejects.toThrow("twice"); });
});

describe("R19-R20 teams", () => {
  test("R19: teams of 3 are cut from the shuffled roster; players beyond a full team are held in reserve", async () => {
    const t = await start(14, "team-seed", { format: "team", teamSize: 3 });
    expect(t.entrants.length).toBe(4); expect(t.reserve.length).toBe(2);
    expect(t.entrants.every((e) => e.members.length === 3)).toBe(true);
    const all = [...t.entrants.flatMap((e) => e.members), ...t.reserve]; expect(new Set(all).size).toBe(14);
  });
  test("R19: a team has 3 or 5 players; fewer players than one team is refused", async () => {
    await expect(start(10, "s", { format: "team", teamSize: 4 })).rejects.toThrow("3 or 5");
    await expect(start(2, "s", { format: "team", teamSize: 3 })).rejects.toThrow("Not enough");
  });
  test("R20: a team match has one board per seat, all open at once; the team that wins more boards wins", async () => {
    const t = await start(15, "team-2", { format: "team", teamSize: 5 }); // 3 teams -> 1 bye, 1 match
    const live = real(t).filter((m) => m.status === "live"); expect(live.length).toBe(1); expect(live[0]!.boards.length).toBe(5);
    await drive(t, T0, { rng: lcg(11) });
    for (const m of real(t)) {
      const A = t.entrants.find((e) => e.id === m.a)!, wins = m.boards.filter((b) => b.winner === A.members[b.j]).length;
      expect(m.winner).toBe(wins >= 3 ? m.a! : m.b!);
    }
    expect(t.done).toBe(true);
  });
  test("R20: a team whose members are all away loses its boards by forfeit and the other team goes through", async () => {
    const t = await start(6, "team-3", { format: "team", teamSize: 3 }); // 2 teams, 1 final
    const away = new Set(t.entrants[0]!.members);
    await drive(t, T0, { absent: away, rng: lcg(2) });
    expect(t.done).toBe(true); expect(t.champion).toBe(t.entrants[1]!.id);
  });
});

describe("R21 a crowd", () => {
  test("R21: 1,000 simulated players finish one knockout with no stuck match (10 rounds)", async () => {
    const t = await start(1000, "crowd"); expect(t.rounds).toBe(10);
    const r = await drive(t, T0, { rng: lcg(99), stepMs: 3000 });
    expect(t.done).toBe(true); expect(real(t).length).toBe(999);
    expect(real(t).every((m) => m.status === "done" && m.winner)).toBe(true);
    expect(r.moves).toBeGreaterThan(999 * 5 - 1);
  }, 120_000);
  test("R21: a crowd where a tenth of the players never show up still finishes (clock-outs and forfeits)", async () => {
    const ps = people(200), away = new Set(ps.filter((_, i) => i % 10 === 0).map((p) => p.pid));
    const t = await startTournament({ eid: "E2", seed: "s200", players: ps, startAt: T0, moveMs: 10_000, readyMs: 15_000 });
    await drive(t, T0, { absent: away, rng: lcg(5) });
    expect(t.done).toBe(true); expect(away.has(t.champion!)).toBe(false);
  }, 120_000);
});

describe("R23-R25 the strict ranking", () => {
  test("R24: every rank is unique, the champion is 1st, the runner-up 2nd, the two semi-final losers 3rd and 4th", async () => {
    const t = await start(37, "rank-1"); await drive(t, T0, { rng: lcg(8) });
    const r = await rankings(t);
    expect(r.map((x) => x.rank)).toEqual(r.map((_, i) => i + 1));
    expect(r[0]!.id).toBe(t.champion!);
    const fin = t.matches[`r${t.rounds}m0`]!; expect(r[1]!.id).toBe(fin.loser!);
    const semis = [t.matches[`r${t.rounds - 1}m0`]!, t.matches[`r${t.rounds - 1}m1`]!].map((m) => m.loser!);
    expect(new Set(r.slice(2, 4).map((x) => x.id))).toEqual(new Set(semis));
    expect(new Set(r.map((x) => x.id)).size).toBe(37);
  });
  test("R24: the order is round reached, then total points, then points in the last match, then fate", async () => {
    const t = await start(29, "rank-2"); await drive(t, T0, { rng: lcg(21) });
    const r = await rankings(t);
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1]!, b = r[i]!;
      const key = (x: typeof a) => [x.roundReached, x.points, x.lastMatchPoints];
      const ka = key(a), kb = key(b);
      let cmp = 0; for (let k = 0; k < 3 && !cmp; k++) cmp = ka[k]! - kb[k]!;
      expect(cmp > 0 || (cmp === 0 && a.fate < b.fate)).toBe(true);
    }
  });
  test("R23: points are 2 for a game won and 1 for a game drawn; the champion played every round so has points from each", async () => {
    const t = await start(16, "rank-3"); await drive(t, T0, { rng: lcg(4) });
    const r = await rankings(t); const ch = r[0]!;
    expect(ch.points).toBeGreaterThanOrEqual(2 * t.rounds);
  });
  test("R25: every row that was separated by a tie-break says so in one line", async () => {
    const t = await start(33, "rank-4"); await drive(t, T0, { rng: lcg(13) });
    const r = await rankings(t); const lines = r.map((x, i) => (i ? tieLine(x, r[i - 1]!.name) : ""));
    expect(r.every((x, i) => !i || ["round reached", "total points", "points in the last match", "fate"].includes(x.decidedBy))).toBe(true);
    expect(lines.filter(Boolean).length).toBeGreaterThan(0);
    for (const [i, l] of lines.entries()) if (l) expect(l).toContain(r[i - 1]!.name);
  });
  test("the ranking is the same when computed twice (deterministic)", async () => {
    const t = await start(21, "rank-5"); await drive(t, T0, { rng: lcg(17) });
    expect(JSON.stringify(await rankings(t))).toBe(JSON.stringify(await rankings(t)));
  });
});

describe("R26-R30 fairness, pause, rejoin, spectators", () => {
  test("R26: the commit matches the secret; a wrong secret does not; the seed depends on the closed roster", async () => {
    const secret = newSecret(), commit = await commitOf(secret);
    expect(await verifyReveal(secret, commit)).toBe(true); expect(await verifyReveal(newSecret(), commit)).toBe(false);
    const s1 = await seedOf(secret, "E1", ["a", "b", "c"]), s2 = await seedOf(secret, "E1", ["a", "b", "c", "d"]), s3 = await seedOf(secret, "E1", ["c", "b", "a"]);
    expect(s1).not.toBe(s2); expect(s1).toBe(s3); // the order of the list does not matter, who is in it does
    expect(await seedOf(secret, "E1", ["a", "b", "c"], "beacon-123")).not.toBe(s1);
  });
  test("R27: a spectator, an outsider, or a player who is not to move cannot move", async () => {
    const t = await start(4, "fair"); const g = boardOf(t, "p0001")!.board.games[0]!;
    const mover = g.moves.length % 2 === 0 ? g.x : g.o, notMover = mover === g.x ? g.o : g.x;
    expect(await moveInTournament(t, "spectator", 4, T0 + 1)).toMatchObject({ ok: false, error: "no-live-board" });
    expect(await moveInTournament(t, notMover, 4, T0 + 1)).toMatchObject({ ok: false, error: "not-your-turn" });
    expect(await moveInTournament(t, mover, 4, T0 + 1)).toMatchObject({ ok: true });
  });
  test("R28: while the host pauses nothing times out; the clocks continue with the same time left afterwards", async () => {
    const { shiftTournament } = await import("../src/bracket");
    const t = await start(4, "pause"); const before = Object.values(t.matches).filter((m) => m.status === "live").map((m) => m.boards[0]!.games[0]!.deadline);
    shiftTournament(t, 90_000);
    await advanceTournament(t, T0 + 15_000 + 90_000 - 1000);
    expect(Object.values(t.matches).filter((m) => m.status === "live").every((m) => m.boards[0]!.games[0]!.moves.length === 0)).toBe(true);
    expect(Object.values(t.matches).filter((m) => m.status === "live").map((m) => m.boards[0]!.games[0]!.deadline)).toEqual(before.map((d) => d + 90_000));
  });
  test("R29: a player who left and came back sees the board exactly as it is (state is rebuilt from the saved tournament)", async () => {
    const t = await start(4, "rejoin"); const pid = "p0002";
    await drive(t, T0, { rng: lcg(1), maxMs: 4000 });
    const copy: Tournament = JSON.parse(JSON.stringify(t)); // what the store gives back after a page reload
    expect(boardOf(copy, pid)?.board.games.at(-1)?.cells).toEqual(boardOf(t, pid)?.board.games.at(-1)?.cells);
    expect(JSON.stringify(publicView(copy))).toBe(JSON.stringify(publicView(t)));
  });
  test("R30: the spectator view has names, boards and results only: no seed, no ids beyond the player ids", async () => {
    const t = await start(8, "spy"); const v = JSON.stringify(publicView(t));
    expect(v).not.toContain("spy"); expect(v).not.toContain("seed"); expect(v).toContain("Player 1");
    await drive(t, T0, { rng: lcg(6) });
    const done = publicView(t); expect(done.done).toBe(true); expect(done.champion).toBeTruthy();
    expect(done.matches.filter((m) => m.status === "done" && !m.bye).every((m) => m.boards.every((b) => b.how.length > 10))).toBe(true);
  });
  test("the same tournament, played twice with the same seed and the same bots, gives byte-identical results", async () => {
    const run = async () => { const t = await start(25, "repeat"); await drive(t, T0, { rng: lcg(42) }); return JSON.stringify([t.matches, await rankings(t)]); };
    expect(await run()).toBe(await run());
  });
});
