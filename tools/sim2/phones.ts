// Simulated phones for Corporate Tic Tac Toe. Every simulated phone is a real TttPhone (packages/ttt/src/phone.ts, the code the browser bundle ships): it builds the bracket, replays moves, claims clock-outs, reports its board and registers its next match ON ITS OWN.
// The only thing they talk to is the dumb mailbox (apps/edge/src/tournament.ts) through its HTTP routes, on a virtual clock. The driver here only decides WHEN a phone looks (every step) and WHICH square a bot taps.
// Used by apps/edge/test/tournament.test.ts and tools/sim2/bracket-sim.ts.
import { TttConsole, TttPhone, type Api } from "../../packages/ttt/src/phone";

export type CallFn = (method: string, path: string, body?: unknown, headers?: Record<string, string>, now?: number) => Promise<Response>;
export interface SimPhone { pid: string; device: string; name: string }
export const clockOf = (t0: number) => ({ t: t0 });

/** An API for one phone (or the Organizer's page when headers carry the key): parsed JSON on success, an Error with status/code/body otherwise. */
export function apiFor(call: CallFn, clock: { t: number }, headers: Record<string, string> = {}): Api {
  return async (method, path, body) => {
    const r = await call(method, path, body, headers, clock.t);
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error ?? "http " + r.status), { status: r.status, code: j.code, body: j });
    return j;
  };
}

export interface CrowdOpts {
  call: CallFn; eid: string; phones: SimPhone[]; orgHeaders: Record<string, string>; clock: { t: number };
  away?: ReadonlySet<string>; rng: () => number; stepMs?: number; maxSteps?: number;
  /** a done() that stops the run: the mailbox says the tournament is over */
  isDone: () => boolean | Promise<boolean>;
  /** how often (in steps) a phone that is out of the tournament looks again */
  watcherEvery?: number;
}
export interface CrowdResult { steps: number; now: number; moves: number; refused: number; ticks: number; phases: Record<string, number>; claims: number; results: number; opens: number; gets: number; posts: number }

export async function playCrowd(o: CrowdOpts): Promise<CrowdResult> {
  const stepMs = o.stepMs ?? 2000, maxSteps = o.maxSteps ?? 6000, every = o.watcherEvery ?? 8;
  const consolePage = new TttConsole(apiFor(o.call, o.clock, o.orgHeaders), o.eid);
  const phones = o.phones.map((p) => ({ p, ph: new TttPhone({ api: apiFor(o.call, o.clock), eid: o.eid, pid: p.pid, device: p.device, now: () => o.clock.t }), phase: "", sleeping: 0 }));
  let moves = 0, refused = 0, ticks = 0, steps = 0;
  for (; steps < maxSteps; steps++) {
    o.clock.t += stepMs;
    await consolePage.tick();
    for (const x of phones) {
      if (o.away?.has(x.p.pid)) continue;
      if (x.sleeping > 0) { x.sleeping--; continue; }
      const v = await x.ph.tick(); ticks++; x.phase = v.phase;
      if (v.phase === "playing" && v.board && !v.board.done && v.board.yourTurn) {
        const free = v.board.cells.map((c: number, i: number) => (c === 0 ? i : -1)).filter((i: number) => i >= 0);
        const r = await x.ph.play(free[Math.floor(o.rng() * free.length)]);
        if (r.ok) moves++; else refused++;
      }
      if (v.phase === "out" || v.phase === "champion" || v.phase === "reserve" || v.phase === "watching") x.sleeping = every;
    }
    if (await o.isDone()) { steps++; break; }
  }
  const phases: Record<string, number> = {}; for (const x of phones) phases[x.phase || "away"] = (phases[x.phase || "away"] ?? 0) + 1;
  const sum = (k: keyof TttPhone["counters"]) => phones.reduce((s, x) => s + x.ph.counters[k], 0);
  return { steps, now: o.clock.t, moves, refused, ticks, phases, claims: sum("claims"), results: sum("results"), opens: sum("opens"), gets: sum("gets"), posts: sum("posts") };
}
