// Test and simulation driver: plays a whole tournament with simple bots on a fake clock.
import { advanceTournament, boardOf, moveInTournament, type Tournament } from "../src/bracket";
import { emptiesOf } from "../src/classic";
import { lastGame, moverOf } from "../src/match";

/** A tiny seeded generator so a sim is repeatable. */
export const lcg = (seed: number) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 0x100000000; };

export interface DriveOpts { absent?: ReadonlySet<string>; rng?: () => number; stepMs?: number; maxMs?: number; onMove?: () => void }
export interface DriveResult { now: number; moves: number; steps: number }

/** Every live board: if the player to move is present, they play a random empty square; absent players do nothing (their clock runs out). Time moves on until the tournament is done. */
export async function drive(t: Tournament, now: number, o: DriveOpts = {}): Promise<DriveResult> {
  const rng = o.rng ?? lcg(7), step = o.stepMs ?? 2000, limit = now + (o.maxMs ?? 6 * 3600_000);
  let moves = 0, steps = 0;
  while (!t.done && now < limit) {
    await advanceTournament(t, now); if (t.done) break;
    const live: [string, number][] = [];
    for (const m of Object.values(t.matches)) if (m.status === "live") for (const b of m.boards) if (!b.done) { const g = lastGame(b); live.push([moverOf(g), g.moves.length]); }
    let any = false;
    for (const [pid, ply] of live) {
      if (o.absent?.has(pid)) continue;
      const f = boardOf(t, pid); if (!f) continue;
      const g = lastGame(f.board); if (moverOf(g) !== pid || g.moves.length !== ply) continue;
      const e = emptiesOf(g.cells); const cell = e[Math.floor(rng() * e.length)]!;
      const r = await moveInTournament(t, pid, cell, now, ply);
      if (!r.ok) throw new Error("a bot move was refused: " + r.error);
      moves++; any = true; o.onMove?.();
    }
    now += any ? step : Math.max(step, 5000); steps++;
  }
  return { now, moves, steps };
}
