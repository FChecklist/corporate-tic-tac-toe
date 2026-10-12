// Chooses the second-player bonus (KOMI) by simulation: bots play full boards with KOMI = 0 and we look at how much more the first player (X) scores on average.
// Two kinds of bot: "random" (any free cell) and "greedy" (the free cell that gives the best own-minus-opponent score right now; ties at random).
// Run: bun sim/komi.ts [games per case]. The bots are simple; real players differ, so the bonus is a starting value, to be re-checked with real match data.
import { emptyBoard, emptyCells, nextMark, scoreBoard, type Cell, type Size } from "../src/engine";

let seed = 20261012;
const rnd = (n: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
const diffFor = (cells: Cell[], n: Size, me: 1 | 2): number => { const s = scoreBoard(cells, n); return me === 1 ? s.x.total - s.o.total : s.o.total - s.x.total; };

function pick(cells: Cell[], n: Size, me: 1 | 2, kind: "random" | "greedy"): number {
  const free = emptyCells(cells);
  if (kind === "random") return free[rnd(free.length)]!;
  let best = -Infinity; let bestCells: number[] = [];
  for (const c of free) { cells[c] = me; const d = diffFor(cells, n, me); cells[c] = 0; if (d > best) { best = d; bestCells = [c]; } else if (d === best) bestCells.push(c); }
  return bestCells[rnd(bestCells.length)]!;
}

function playBoard(n: Size, xKind: "random" | "greedy", oKind: "random" | "greedy"): { x: number; o: number } {
  const cells = emptyBoard(n);
  while (cells.some((c) => c === 0)) { const me = nextMark(cells); cells[pick(cells, n, me, me === 1 ? xKind : oKind)] = me; }
  const s = scoreBoard(cells, n); return { x: s.x.total, o: s.o.total - s.o.komi };
}

const GAMES = Number(process.argv[2] ?? 3000);
console.log(`games per case: ${GAMES} (KOMI = 0 in these runs)\n`);
for (const kind of ["random", "greedy"] as const) {
  for (const n of [3, 4, 5] as const) {
    let dx = 0, xWins = 0, oWins = 0, ties = 0;
    for (let g = 0; g < GAMES; g++) { const r = playBoard(n, kind, kind); dx += r.x - r.o; if (r.x > r.o) xWins++; else if (r.o > r.x) oWins++; else ties++; }
    console.log(`${kind.padEnd(7)} ${n}x${n}: first player scores ${(dx / GAMES).toFixed(2)} points more on average; first wins ${(xWins / GAMES * 100).toFixed(1)}%, second wins ${(oWins / GAMES * 100).toFixed(1)}%, tied ${(ties / GAMES * 100).toFixed(1)}%`);
  }
}
