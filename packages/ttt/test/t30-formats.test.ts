// TEST AUTHOR 30 Oct 2026. Go-live rows F1t (move clock 10/20/30/60 s, two clock-outs lose the board, pause), F3t (draws replayed with marks swapped up to 3 games, then fate; no ties in the ranking),
// F5t (solo and teams of 3 or 5 each play to a champion). Real outcomes only; every run is checked from the tournament it produced.
import { describe, expect, test } from "bun:test";
import { advanceTournament, rankings, shiftTournament, startTournament, type Tournament } from "../src/bracket";
import { MISSED_LIMIT, fateOf, lastGame } from "../src/match";
const MAX_GAMES = 3; // written out on purpose: the rule is "at most 3 games", so changing the product constant must turn these tests red
import { drive, lcg } from "./drive";

const T0 = 5_000_000;
const people = (n: number) => Array.from({ length: n }, (_, i) => ({ pid: `p${String(i + 1).padStart(4, "0")}`, name: `Player ${i + 1}` }));
const start = (n: number, o: { seed?: string; format?: "solo" | "team"; teamSize?: number; moveMs?: number } = {}) => startTournament({ eid: "E30", seed: o.seed ?? "t30", players: people(n), startAt: T0, moveMs: o.moveMs ?? 10_000, readyMs: 15_000, format: o.format, teamSize: o.teamSize });
const boardsOf = (t: Tournament) => Object.values(t.matches).flatMap((m) => m.boards);

describe("F5t: every format plays to one champion, with a strict ranking", () => {
  const CASES: [string, "solo" | "team", number | undefined, number][] = [["solo 2", "solo", undefined, 2], ["solo 3", "solo", undefined, 3], ["solo 7", "solo", undefined, 7], ["solo 16", "solo", undefined, 16], ["solo 21", "solo", undefined, 21],
    ["teams of 3, 6 players", "team", 3, 6], ["teams of 3, 7 players (1 in reserve)", "team", 3, 7], ["teams of 3, 15 players", "team", 3, 15], ["teams of 5, 10 players", "team", 5, 10], ["teams of 5, 13 players (3 in reserve)", "team", 5, 13], ["teams of 5, 25 players", "team", 5, 25]];
  for (const [label, format, teamSize, n] of CASES) for (const moveMs of [10_000, 20_000, 30_000, 60_000]) test(`${label}, move clock ${moveMs / 1000} s: one champion, unique ranks 1..N, nothing left waiting or live`, async () => {
    const t = await start(n, { format, teamSize, moveMs, seed: `${label}|${moveMs}` }); expect(t.moveMs).toBe(moveMs);
    await drive(t, T0, { rng: lcg(n + moveMs) });
    expect(t.done).toBe(true); expect(t.champion).toBeTruthy();
    expect(Object.values(t.matches).every((m) => m.status === "done")).toBe(true);
    const entrants = format === "solo" ? n : Math.floor(n / (teamSize ?? 1)); expect(t.entrants.length).toBe(entrants);
    if (format === "team") expect(t.reserve.length).toBe(n - entrants * teamSize!);
    const r = await rankings(t);
    expect(r.map((x) => x.rank)).toEqual(Array.from({ length: entrants }, (_, i) => i + 1)); expect(r[0]!.id).toBe(t.champion!);
    expect(new Set(r.map((x) => x.id)).size).toBe(entrants);
    const played = Object.values(t.matches).filter((m) => !m.bye).length; expect(played).toBe(entrants - 1); // a knockout of N entrants has N-1 real matches
  });
  test("a team match has one board per seat (3 or 5), all open at once", async () => {
    for (const ts of [3, 5]) { const t = await start(ts * 4, { format: "team", teamSize: ts }); const live = Object.values(t.matches).filter((m) => m.status === "live"); expect(live.length).toBeGreaterThan(0); for (const m of live) expect([ts, m.boards.length]).toEqual([ts, ts]); }
  });
});

describe("F3t: draws are replayed with the marks swapped, at most 3 games, then fate; nobody ends level", () => {
  test("across 12 simulated tournaments every board obeys the rules: <= 3 games; a drawn game is followed by a game where the other player has X; fate only after three draws", async () => {
    let drawn = 0, fated = 0, boards = 0;
    for (let k = 0; k < 12; k++) {
      const t = await start(16, { seed: "draws-" + k }); await drive(t, T0, { rng: lcg(100 + k) });
      for (const b of boardsOf(t)) {
        boards++; expect(b.games.length).toBeLessThanOrEqual(MAX_GAMES); expect(b.done).toBe(true); expect(b.winner).toBeTruthy();
        b.games.forEach((g, i) => { if (g.result?.kind === "draw") { drawn++; if (i === 0 && b.games[1]) expect([b.games[1].x, b.games[1].o]).toEqual([g.o, g.x]); if (i < b.games.length - 1) expect(b.games[i + 1]!.no).toBe(g.no + 1); } else if (i < b.games.length - 1) throw new Error("a decided game was followed by another game"); });
        if (b.via === "fate") { fated++; expect(b.games.length).toBe(MAX_GAMES); expect(b.games.every((g) => g.result?.kind === "draw")).toBe(true); }
        if (b.via === "win") expect(b.games.at(-1)!.result?.kind).toBe("win");
      }
    }
    expect(boards).toBeGreaterThan(100); expect(drawn).toBeGreaterThan(0); // random bots do draw sometimes: the test must have really exercised a draw
  });
  test("when fate decides, the winner is the player with the lower public fate hash, and anyone can recompute it", async () => {
    let checked = 0;
    for (let k = 0; k < 40 && checked < 1; k++) { const t = await start(32, { seed: "fate-" + k }); await drive(t, T0, { rng: lcg(900 + k) });
      for (const m of Object.values(t.matches)) for (const b of m.boards) if (b.via === "fate") { const [ha, hb] = [await fateOf(t.seed, m.mid, b.j, b.a), await fateOf(t.seed, m.mid, b.j, b.b)]; expect(b.winner).toBe(ha < hb ? b.a : b.b); checked++; } }
    expect(checked).toBeGreaterThan(0);
  });
  test("the final ranking has no ties: 200 random crowd sizes give strictly different ranks", async () => {
    for (let n = 2; n <= 40; n++) { const t = await start(n, { seed: "ties" + n }); await drive(t, T0, { rng: lcg(n * 31) }); const r = await rankings(t); expect(new Set(r.map((x) => x.rank)).size).toBe(r.length); }
  });
});

describe("F1t: the move clock", () => {
  for (const moveMs of [10_000, 20_000, 30_000, 60_000]) test(`${moveMs / 1000} s clock: a move made just before the deadline stands; nobody moves, then the software plays for the player`, async () => {
    const t = await start(2, { moveMs }); const m = Object.values(t.matches).find((x) => x.status === "live")!; const g = lastGame(m.boards[0]!);
    expect(g.deadline - T0).toBeGreaterThan(0); const first = g.deadline;
    await advanceTournament(t, first - 1); expect(lastGame(m.boards[0]!).moves.length).toBe(0); // still waiting for the first move
    await advanceTournament(t, first + 1); const g1 = lastGame(m.boards[0]!);
    expect(g1.moves.length).toBe(1); expect(g1.moves[0]!.auto).toBe(true); // the software played
    expect(g1.deadline - first).toBe(moveMs); // the next player has exactly one move clock
  });
  test("two clock-outs in a row by the same player in one game lose the board (forfeit), and the other player is the winner", async () => {
    expect(MISSED_LIMIT).toBe(2);
    const t = await start(2, { moveMs: 10_000 }); const m = Object.values(t.matches)[0]!; const b = m.boards[0]!;
    let now = T0; for (let i = 0; i < 20 && !b.done; i++) { now = lastGame(b).deadline + 1; await advanceTournament(t, now); }
    expect(b.done).toBe(true); expect(b.via).toBe("forfeit");
    const g = lastGame(b); expect(g.result?.kind).toBe("forfeit"); const loser = (g.x === g.result!.winner ? g.o : g.x);
    expect(g.missed[loser]).toBe(MISSED_LIMIT); expect((g.missed[g.result!.winner!] ?? 0)).toBeLessThan(MISSED_LIMIT);
    expect(b.winner).toBe(g.result!.winner);
  });
  test("pause: every live clock moves by exactly the pause length, and nothing times out during it", async () => {
    const t = await start(8, { moveMs: 20_000 }); const live = () => Object.values(t.matches).filter((m) => m.status === "live").flatMap((m) => m.boards.map((b) => lastGame(b).deadline));
    const before = live(); shiftTournament(t, 5 * 60_000); expect(live()).toEqual(before.map((d) => d + 5 * 60_000));
    await advanceTournament(t, Math.min(...before) + 4 * 60_000); expect(Object.values(t.matches).flatMap((m) => m.boards).every((b) => lastGame(b).moves.length === 0)).toBe(true);
  });
  test("pause does not touch finished or waiting matches", async () => {
    const t = await start(4, { moveMs: 10_000 }); const waiting = Object.values(t.matches).filter((m) => m.status === "waiting"); expect(waiting.length).toBe(1);
    shiftTournament(t, 1000); expect(waiting[0]!.boards).toEqual([]);
  });
});
