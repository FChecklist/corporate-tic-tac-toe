// P*: what a phone computes from the relayed log. Every phone must get the same result from the same log (twice, and in any arrival order).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { clockAt, keepAfter, pairSlot, settleStages, viewFor, type Stat, type SlotResult } from "../../vendor/game-core/packages/tictactoe/src";
import { agreed, fateOf, slotKey, type Entry } from "../../packages/ttt/src/stageplay";
import { START, fateMap, outcomeOf, playAll, players, run, shuffled } from "./drive";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const at = (r: { startMs: number }, el: number) => r.startMs + el * 1000;
const settleAt = (r: ReturnType<typeof run>, el: number, results = r.results) => settleStages({ gameId: r.gameId, startMs: r.startMs, nowMs: at(r, el), players: r.ps, fate: r.fate, results });

describe("P1 pairing of one slot", () => {
  test("P1: free players are paired by nearby points; equal points are broken by sha256(game id|stage|slot|player), lowest hash first", () => {
    const ps = players(8), stats: Record<string, Stat> = {};
    const { pairs, bye } = pairSlot("GAME-X", 1, 2, ps, stats, {});
    const sorted = [...ps].sort((x, y) => (sha(`GAME-X|1|2|${x}`) < sha(`GAME-X|1|2|${y}`) ? -1 : 1));
    expect(bye).toBeNull(); expect(pairs).toEqual([[sorted[0]!, sorted[1]!], [sorted[2]!, sorted[3]!], [sorted[4]!, sorted[5]!], [sorted[6]!, sorted[7]!]]);
  });
  test("P1b: the seed is the game id and the slot: another game or another slot gives another order", () => {
    const ps = players(40), a = pairSlot("G-A", 1, 1, ps, {}, {}).pairs, b = pairSlot("G-B", 1, 1, ps, {}, {}).pairs, c = pairSlot("G-A", 1, 2, ps, {}, {}).pairs;
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b)); expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    expect(JSON.stringify(pairSlot("G-A", 1, 1, [...ps].reverse(), {}, {}).pairs)).toBe(JSON.stringify(a)); // the order the list arrives in does not matter
  });
  test("P1c: players with more points meet each other first (neighbours in the points order)", () => {
    const ps = players(6), stats: Record<string, Stat> = {}; ps.forEach((p, i) => (stats[p] = { points: [6, 0, 6, 0, 3, 3][i]!, wins: 0, stagePoints: 0, byeStages: [] }));
    const g = pairSlot("G", 2, 1, ps, stats, {}).pairs.map(([a, b]) => [stats[a]!.points, stats[b]!.points].sort().join());
    expect(g.sort()).toEqual(["0,0", "3,3", "6,6"]);
  });
  test("P2: never the same opponent as in the last slot (when anybody else is free)", () => {
    const ps = players(8), first = pairSlot("G", 1, 1, ps, {}, {}).pairs, last: Record<string, string> = {};
    for (const [a, b] of first) { last[a] = b; last[b] = a; }
    const second = pairSlot("G", 1, 2, ps, {}, last).pairs;
    for (const [a, b] of second) expect(last[a]).not.toBe(b);
  });
  test("P2b: over a whole 200-player game nobody meets the same opponent in two slots in a row", () => {
    const r = run(200, "NOREPEAT"); let prev = new Map<string, string>(), bad = 0, checked = 0;
    playAll(r, outcomeOf(3), (st, sl, s) => { const cur = new Map<string, string>(); for (const [a, b] of s.pairsNow) { cur.set(a, b); cur.set(b, a); if (sl > 1) { checked++; if (prev.get(a) === b) bad++; } } prev = cur; });
    expect(checked).toBeGreaterThan(300); expect(bad).toBe(0);
  });
  test("P3: an odd number: exactly one player sits out and gets 1 point; the others are all paired", () => {
    const r = run(9, "ODD"); const s = settleAt(r, 130);
    expect(s.pairsNow.length).toBe(4); expect(s.bye).not.toBeNull(); expect(new Set([...s.pairsNow.flat(), s.bye!]).size).toBe(9);
    const s2 = settleAt(r, 230); expect(s2.stats[s.bye!]!.points).toBe(1); expect(s2.stats[s.bye!]!.wins).toBe(0);
  });
  test("P3b: the bye goes once per stage: three slots of a 9-player stage give three different players a bye", () => {
    const r = run(9, "ODD2"), byes: string[] = [];
    for (let k = 0; k < 3; k++) { const s = settleAt(r, 120 + k * 100 + 1, r.results); byes.push(s.bye!); }
    // no results are logged, so every pair is a draw: everybody gets 1 point and the lowest-ranked without a bye sits out
    expect(new Set(byes).size).toBe(3);
  });
  test("P3c: the bye is worth 1 point once per stage: a bye in stage 1 does not stop a bye in stage 2", () => {
    const r = run(9, "ODD3"); const s = settleAt(r, 421); const total = Object.values(s.stats).reduce((x, y) => x + y.points, 0);
    expect(s.alive.length).toBe(keepAfter(1, 9)); expect(total).toBeGreaterThanOrEqual(9 * 3 + 3 - 9); // 12 points per slot-trio with byes, never negative
    const byeTotals = Object.values(s.stats).map((x) => x.byeStages.length); expect(Math.max(...byeTotals)).toBeLessThanOrEqual(1);
  });
});

describe("P4 points and results", () => {
  test("P4: win 2, loss 0, draw 1 for both", () => {
    const r = run(4, "PTS"), s0 = settleAt(r, 125); const [[a, b], [c, d]] = s0.pairsNow;
    const log: SlotResult[] = [{ stage: 1, slot: 1, a: a!, b: b!, winner: "a" }, { stage: 1, slot: 1, a: c!, b: d!, winner: "draw" }];
    const s = settleAt(r, 225, log);
    expect([s.stats[a!]!.points, s.stats[a!]!.wins, s.stats[b!]!.points, s.stats[b!]!.wins]).toEqual([2, 1, 0, 0]);
    expect([s.stats[c!]!.points, s.stats[d!]!.points, s.stats[c!]!.wins]).toEqual([1, 1, 0]);
  });
  test("P4b: a game with no agreed result at the end of its slot is a draw (1 point each)", () => {
    const r = run(4, "NORES"), s = settleAt(r, 225); for (const p of r.ps) expect(s.stats[p]!.points).toBe(1);
  });
  test("P4c: a game running at slot end is a draw: a result that is not there yet changes nothing and the slot is closed as a draw", () => {
    const r = run(4, "RUN"), s0 = settleAt(r, 125); const [a, b] = s0.pairsNow[0]!;
    expect(settleAt(r, 125, [{ stage: 1, slot: 1, a: a!, b: b!, winner: "a" }]).pairsNow).toEqual(s0.pairsNow); // a result for a slot not finished is ignored
    expect(settleAt(r, 225).stats[a!]!.points).toBe(1);
  });
  test("P4d: a result for a pair the pairing did not make is ignored", () => {
    const r = run(4, "FAKE"), s0 = settleAt(r, 125), [[a], [c]] = s0.pairsNow; // a and c are in different pairs
    const s = settleAt(r, 225, [{ stage: 1, slot: 1, a: a!, b: c!, winner: "a" }]); expect(s.stats[a!]!.points).toBe(1);
  });
  test("P5: results in two-sided form: a result counts only when BOTH players wrote the same word", () => {
    const slot = slotKey(1, 1, "aaaa1", "bbbb2"), e = (id: number, pid: string, body: string): Entry => ({ id, slot, kind: "result", pid, seq: 0, body });
    expect(agreed([e(1, "aaaa1", "a"), e(2, "bbbb2", "a")])).toEqual([{ stage: 1, slot: 1, a: "aaaa1", b: "bbbb2", winner: "a" }]);
    expect(agreed([e(1, "aaaa1", "a"), e(2, "bbbb2", "b")])).toEqual([]); // they disagree
    expect(agreed([e(1, "aaaa1", "a")])).toEqual([]); // one side only
    expect(agreed([e(1, "cccc3", "a"), e(2, "bbbb2", "a")])).toEqual([]); // a stranger
    expect(agreed([e(1, "aaaa1", "x"), e(2, "bbbb2", "x")])).toEqual([]); // not a word of the game
    expect(agreed([e(1, "aaaa1", "draw"), e(2, "bbbb2", "draw")])[0]!.winner).toBe("draw");
  });
  test("P5b: agreed() gives the same answer whatever order the entries arrive in", () => {
    const es: Entry[] = []; let id = 0;
    for (let i = 0; i < 30; i++) { const a = `pa${String(i).padStart(3, "0")}`, b = `pb${String(i).padStart(3, "0")}`, slot = slotKey(1 + (i % 3), 1 + (i % 3), a, b), w = ["a", "b", "draw"][i % 3]!; es.push({ id: ++id, slot, kind: "result", pid: a, seq: 0, body: w }, { id: ++id, slot, kind: "result", pid: b, seq: 0, body: i % 7 === 0 ? "draw" : w }); }
    const key = (x: ReturnType<typeof agreed>) => JSON.stringify([...x].sort((p, q) => (p.a < q.a ? -1 : 1)));
    const base = key(agreed(es)); expect(JSON.parse(base).length).toBeGreaterThan(20);
    for (let s = 1; s <= 20; s++) expect(key(agreed(shuffled(es, s)))).toBe(base);
  });
});

describe("P6 cuts and ranking", () => {
  test("P6: after stage 1 the bottom half is out; after stage 2 half of the survivors; stage 3 ranks everybody left and the top five win", () => {
    const r = run(40, "CUTS"); const s = playAll(r, outcomeOf(5));
    const s1 = settleAt(r, 421), s2 = settleAt(r, 721);
    expect(s1.alive.length).toBe(20); expect(s1.out.length).toBe(20); expect(s2.alive.length).toBe(10); expect(s2.out.length).toBe(30);
    expect(s.over).toBe(true); expect(s.phase).toBe("done"); expect(s.ranking!.length).toBe(10); expect(s.winners).toEqual(s.ranking!.slice(0, 5));
    for (const p of s2.alive) expect(s1.alive).toContain(p);
  });
  test("P6b: halves round up for odd counts (45 -> 23 -> 12), never below 1", () => {
    expect(keepAfter(1, 45)).toBe(23); expect(keepAfter(2, 23)).toBe(12); expect(keepAfter(1, 2)).toBe(1); expect(keepAfter(1, 1)).toBe(1);
    const r = run(45, "ODDCUT"); expect(settleAt(r, 421).alive.length).toBe(23); expect(settleAt(r, 721).alive.length).toBe(12);
  });
  test("P6c: the cut keeps the players with the most points; nobody outside has more points than somebody inside", () => {
    const r = run(60, "CUTPTS"); playAll(r, outcomeOf(9)); const s = settleAt(r, 421);
    const inMin = Math.min(...s.alive.map((p) => s.stats[p]!.points)), outMax = Math.max(...s.out.map((o) => s.stats[o.player]!.points));
    expect(outMax).toBeLessThanOrEqual(inMin);
  });
  test("P7: the final order is points, then wins, then points in the last stage, then fate (lower wins); nobody is tied", () => {
    const r = run(60, "ORDER"); const s = playAll(r, outcomeOf(11)), rk = s.ranking!;
    for (let i = 0; i + 1 < rk.length; i++) {
      const a = s.stats[rk[i]!]!, b = s.stats[rk[i + 1]!]!;
      const cmp = (b.points - a.points) || (b.wins - a.wins) || (b.stagePoints - a.stagePoints) || (r.fate[rk[i]!]! - r.fate[rk[i + 1]!]!);
      expect(cmp).toBeLessThan(0);
    }
    expect(new Set(rk).size).toBe(rk.length);
  });
  test("P7b: a total tie is broken by fate, the lower number first, and the order then does not depend on the player list order", () => {
    const r = run(12, "TIEFATE"); // no results at all: everybody has the same points
    const a = settleStages({ gameId: r.gameId, startMs: r.startMs, nowMs: at(r, 1020), players: r.ps, fate: r.fate, results: [] });
    const b = settleStages({ gameId: r.gameId, startMs: r.startMs, nowMs: at(r, 1020), players: [...r.ps].reverse(), fate: r.fate, results: [] });
    expect(b.ranking).toEqual(a.ranking); expect(new Set(a.ranking).size).toBe(a.ranking!.length);
  });
  test("P7c: the fate number comes from the sealed seed and the player: the same on every phone, different for different players", () => {
    expect(fateOf("seed1", "p1")).toBe(fateOf("seed1", "p1")); expect(fateOf("seed1", "p1")).not.toBe(fateOf("seed2", "p1")); expect(fateOf("seed1", "p1")).not.toBe(fateOf("seed1", "p2"));
    expect(fateOf("seed1", "p1")).toBe(parseInt(sha("seed1|p1").slice(0, 8), 16));
  });
  test("P8: a player who is out keeps no place in the next stage's pairing, and views: place, places to the cut line, opponent", () => {
    const r = run(20, "VIEW"); const s = settleAt(r, 430); const out = s.out[0]!.player, inn = s.alive[0]!;
    const vo = viewFor(s, out, r.fate), vi = viewFor(s, inn, r.fate);
    expect(vo.isOut).toBe(true); expect(vo.opponent).toBeNull(); expect(vi.isOut).toBe(false); expect(s.pairsNow.flat()).not.toContain(out);
    expect(vi.place).toBeGreaterThan(0); expect(vi.of).toBe(10); expect(vi.keep).toBe(5);
  });
});

describe("P9 every phone computes the same", () => {
  test("P9: the same log run through the phone code twice gives the identical result, at every moment of the game", () => {
    const r = run(50, "SAME"); playAll(r, outcomeOf(2));
    for (const el of [10, 125, 330, 421, 500, 721, 900, 1019, 1020, 2000]) expect(JSON.stringify(settleAt(r, el))).toBe(JSON.stringify(settleAt(r, el)));
  });
  test("P9b: the log in any arrival order gives the identical result (20 shuffles, at stage ends and at the end)", () => {
    const r = run(50, "SHUF"); playAll(r, outcomeOf(4));
    for (const el of [220, 421, 721, 1020]) { const base = JSON.stringify(settleAt(r, el)); for (let s = 1; s <= 20; s++) expect(JSON.stringify(settleAt(r, el, shuffled(r.results, s)))).toBe(base); }
  });
  test("P9c: the order of the player list does not matter either", () => {
    const r = run(31, "LISTORD"); const s = playAll(r, outcomeOf(8));
    const t = settleStages({ gameId: r.gameId, startMs: r.startMs, nowMs: at(r, 1020), players: shuffled(r.ps, 3), fate: r.fate, results: shuffled(r.results, 5) });
    expect(t.ranking).toEqual(s.ranking); expect(t.winners).toEqual(s.winners);
  });
  test("P9d: duplicate copies of the same result entry (a phone that wrote it twice) change nothing", () => {
    const r = run(30, "DUP"); const s = playAll(r, outcomeOf(6)); const t = settleAt(r, 1020, [...r.results, ...r.results]); expect(t.ranking).toEqual(s.ranking);
  });
  test("P9e: two different results for the same pair and slot give the same answer in either arrival order", () => {
    const r = run(4, "CONFLICT"), s0 = settleAt(r, 125), [a, b] = s0.pairsNow[0]!;
    const x: SlotResult = { stage: 1, slot: 1, a: a!, b: b!, winner: "a" }, y: SlotResult = { ...x, winner: "b" };
    expect(JSON.stringify(settleAt(r, 225, [x, y]))).toBe(JSON.stringify(settleAt(r, 225, [y, x])));
  });
  test("P10: a late phone (opened at the end) catches up to exactly what the phones that watched all along computed", () => {
    const r = run(25, "LATE"); const live = playAll(r, outcomeOf(1)); const late = settleAt(r, 1500);
    expect(late.ranking).toEqual(live.ranking); expect(late.over).toBe(true); expect(clockAt(r.startMs, at(r, 1500)).phase).toBe("done");
  });
  test("P11: a paused game gives the same result as an unpaused one, shifted: the pause is not game time", () => {
    const a = run(30, "PAUSE"), b = { ...run(30, "PAUSE"), pausedMs: 75_000 };
    const sa = playAll(a, outcomeOf(7)), sb = playAll(b, outcomeOf(7)); expect(sb.ranking).toEqual(sa.ranking); expect(sb.winners).toEqual(sa.winners);
    expect(settleStages({ gameId: "PAUSE", startMs: START, nowMs: START + 1020_000 + 74_000, pausedMs: 75_000, players: b.ps, fate: b.fate, results: b.results }).over).toBe(false);
  });
});
