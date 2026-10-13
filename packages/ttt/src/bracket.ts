// The knockout tournament: players (or teams) in a bracket, boards, byes, the strict ranking and the spectator view. Pure and deterministic from the sealed seed. See docs/RULES.md.
import { shuffled, sha256Hex } from "./random";
import { advanceBoard, applyMove, doneAtOf, howBoardEnded, newBoard, shiftBoard, DEFAULT_MOVE_MS, DEFAULT_READY_MS, type BoardState, type Cfg, type MoveResult } from "./match";

export const MAX_PLAYERS = 10_000;
export const TEAM_SIZES = [3, 5] as const;
export interface Entrant { id: string; name: string; members: string[] } // a solo player is an entrant of one member
export interface MatchState {
  mid: string; round: number; idx: number; a: string | null; b: string | null; boards: BoardState[];
  status: "waiting" | "live" | "done"; bye?: true; winner?: string; loser?: string; startedAt?: number; doneAt?: number;
}
export interface Tournament {
  v: 1; eid: string; format: "solo" | "team"; teamSize: number; moveMs: number; readyMs: number; seed: string;
  entrants: Entrant[]; reserve: string[]; size: number; rounds: number; startAt: number;
  matches: Record<string, MatchState>; done: boolean; champion?: string; names: Record<string, string>;
}
export interface PlayerIn { pid: string; name: string }
export const midOf = (round: number, idx: number): string => `r${round}m${idx}`;
export const cfgOf = (t: Tournament): Cfg => ({ seed: t.seed, moveMs: t.moveMs, readyMs: t.readyMs });

const nextPow2 = (n: number): number => { let p = 1; while (p < n) p *= 2; return p; };

/** The slots of a bracket of `size` places: the first half of the shuffled entrants take the even slots, the rest the odd ones, so at most one place in a pair is empty (a bye). */
export function layout<T>(order: readonly T[], size: number): (T | null)[] {
  const slots: (T | null)[] = Array(size).fill(null);
  const half = size / 2;
  for (let i = 0; i < order.length; i++) { if (i < half || size === 1) slots[size === 1 ? 0 : 2 * i] = order[i]!; else slots[2 * (i - half) + 1] = order[i]!; }
  return slots;
}

export interface StartOpts { eid: string; seed: string; players: PlayerIn[]; format?: "solo" | "team"; teamSize?: number; moveMs?: number; readyMs?: number; startAt: number }

/** Builds the bracket from the roster and the sealed seed and opens round 1. Players beyond a full team (team format) are held in reserve and only watch. */
export async function startTournament(o: StartOpts): Promise<Tournament> {
  const format = o.format ?? "solo", teamSize = format === "team" ? (o.teamSize ?? 3) : 1;
  if (format === "team" && !(TEAM_SIZES as readonly number[]).includes(teamSize)) throw new Error("A team has 3 or 5 players.");
  const ids = new Set<string>(); for (const p of o.players) { if (ids.has(p.pid)) throw new Error("The same player is listed twice."); ids.add(p.pid); }
  if (o.players.length > MAX_PLAYERS) throw new Error("Too many players.");
  const names: Record<string, string> = {}; for (const p of o.players) names[p.pid] = p.name;
  const sortedIds = [...ids].sort(); // the roster is put in a fixed order first, so the same people and seed always give the same bracket
  const seated = await shuffled(o.seed, "roster", sortedIds);
  const entrants: Entrant[] = []; const reserve: string[] = [];
  if (format === "solo") for (const id of seated) entrants.push({ id, name: names[id]!, members: [id] });
  else {
    const teams = Math.floor(seated.length / teamSize);
    for (let t = 0; t < teams; t++) { const members = seated.slice(t * teamSize, (t + 1) * teamSize); entrants.push({ id: `team${t + 1}`, name: `Team ${t + 1}`, members }); }
    reserve.push(...seated.slice(teams * teamSize));
  }
  if (entrants.length < 1) throw new Error(format === "team" ? "Not enough players for one team." : "At least one player is needed.");
  const size = nextPow2(entrants.length), rounds = Math.log2(size);
  const t: Tournament = {
    v: 1, eid: o.eid, format, teamSize, moveMs: o.moveMs ?? DEFAULT_MOVE_MS, readyMs: o.readyMs ?? DEFAULT_READY_MS, seed: o.seed,
    entrants, reserve, size, rounds, startAt: o.startAt, matches: {}, done: false, names,
  };
  for (let r = 1; r <= rounds; r++) for (let i = 0; i < size / 2 ** r; i++) t.matches[midOf(r, i)] = { mid: midOf(r, i), round: r, idx: i, a: null, b: null, boards: [], status: "waiting" };
  if (rounds === 0) { t.done = true; t.champion = entrants[0]!.id; return t; }
  const order = (await shuffled(o.seed, "bracket", entrants.map((e) => e.id)));
  const slots = layout(order, size);
  for (let i = 0; i < size / 2; i++) { const m = t.matches[midOf(1, i)]!; m.a = slots[2 * i] ?? null; m.b = slots[2 * i + 1] ?? null; }
  await settle(t, o.startAt);
  return t;
}

const entrantOf = (t: Tournament, id: string): Entrant => t.entrants.find((e) => e.id === id)!;
export const nameOfEntrant = (t: Tournament, id: string | null): string => (id ? entrantOf(t, id).name : "-");

// ---- one match at a time. The server keeps one row per match and uses these directly; the whole-tournament functions below are built on them.
export interface MatchCtx { cfg: Cfg; rounds: number; size: number; startAt: number; entrant: (id: string) => Entrant }
export const ctxOf = (t: Tournament): MatchCtx => ({ cfg: cfgOf(t), rounds: t.rounds, size: t.size, startAt: t.startAt, entrant: (id) => entrantOf(t, id) });

/** Opens a match whose two sides are known: one board per seat. */
export async function openMatchP(c: MatchCtx, m: MatchState, at: number): Promise<void> {
  const A = c.entrant(m.a!), B = c.entrant(m.b!);
  m.status = "live"; m.startedAt = at; m.boards = [];
  for (let j = 0; j < A.members.length; j++) m.boards.push(await newBoard(c.cfg, m.mid, j, A.members[j]!, B.members[j]!, at));
}
/** A round-1 match with one empty place is a bye. */
export function makeBye(c: MatchCtx, m: MatchState): void { m.status = "done"; m.bye = true; m.winner = (m.a ?? m.b)!; m.doneAt = c.startAt; }
/** When every board is decided, the match gets its winner (the side that won more boards). Returns true when this call finished it. */
export function finalizeMatchP(c: MatchCtx, m: MatchState): boolean {
  if (m.status !== "live" || !m.boards.every((b) => b.done)) return false;
  const A = c.entrant(m.a!), k = m.boards.length;
  const winsA = m.boards.filter((b) => b.winner === A.members[b.j]).length;
  m.winner = winsA * 2 > k ? m.a! : m.b!; m.loser = m.winner === m.a ? m.b! : m.a!; m.status = "done"; m.doneAt = Math.max(...m.boards.map(doneAtOf));
  return true;
}
/** Plays the clock-outs that are due on this match, then finalizes it. */
export async function advanceMatchP(c: MatchCtx, m: MatchState, now: number): Promise<boolean> {
  if (m.status !== "live") return false;
  for (const b of m.boards) if (!b.done) await advanceBoard(c.cfg, m.mid, b, now);
  return finalizeMatchP(c, m);
}
/** Where the winner of a finished match goes next, or null for the final. */
export const parentOf = (c: MatchCtx, m: MatchState): { mid: string; side: "a" | "b" } | null => (m.round >= c.rounds ? null : { mid: midOf(m.round + 1, m.idx >> 1), side: m.idx % 2 === 0 ? "a" : "b" });
/** The two matches that feed a match in round r (none in round 1). */
export const feedersOf = (m: Pick<MatchState, "round" | "idx">): [string, string] | null => (m.round <= 1 ? null : [midOf(m.round - 1, 2 * m.idx), midOf(m.round - 1, 2 * m.idx + 1)]);

async function openMatch(t: Tournament, m: MatchState, at: number): Promise<void> { await openMatchP(ctxOf(t), m, at); }

/** Gives a finished match its winner and moves winners up; opens matches that now have both sides; resolves byes. Repeats until nothing changes. */
async function settle(t: Tournament, now: number): Promise<void> {
  const c = ctxOf(t);
  for (let changed = true; changed;) {
    changed = false;
    for (let r = 1; r <= t.rounds; r++) {
      for (let i = 0; i < t.size / 2 ** r; i++) {
        const m = t.matches[midOf(r, i)]!;
        if (m.status === "waiting" && m.a && m.b) { await openMatch(t, m, Math.max(t.startAt, t.matches[midOf(r - 1, 2 * i)]?.doneAt ?? 0, t.matches[midOf(r - 1, 2 * i + 1)]?.doneAt ?? 0)); changed = true; }
        else if (m.status === "waiting" && r === 1 && (m.a || m.b)) { makeBye(c, m); changed = true; }
        if (finalizeMatchP(c, m)) changed = true;
        if (m.status === "done") { const p = parentOf(c, m); if (p) { const pm = t.matches[p.mid]!; if (pm[p.side] !== m.winner) { pm[p.side] = m.winner!; changed = true; } } }
      }
    }
    const fin = t.matches[midOf(t.rounds, 0)];
    if (fin && fin.status === "done" && !t.done) { t.done = true; t.champion = fin.winner!; changed = true; }
  }
  void now;
}

/** Plays every clock-out that is due, then moves the bracket on. Call it before every read; the result does not depend on how often it is called. */
export async function advanceTournament(t: Tournament, now: number): Promise<Tournament> {
  if (t.done) return t;
  for (let again = true; again && !t.done;) {
    again = false;
    for (const m of Object.values(t.matches)) if (m.status === "live") for (const b of m.boards) if (!b.done) await advanceBoard(cfgOf(t), m.mid, b, now);
    const before = Object.values(t.matches).filter((m) => m.status === "done").length;
    await settle(t, now);
    if (Object.values(t.matches).filter((m) => m.status === "done").length !== before) again = true; // a new match may already have timed out
  }
  return t;
}

/** The undecided board a player has in this match, or null. */
export const boardInMatch = (m: MatchState, pid: string): BoardState | null => m.boards.find((b) => !b.done && (b.a === pid || b.b === pid)) ?? null;

/** The live board a player is in right now, or null. */
export function boardOf(t: Tournament, pid: string): { match: MatchState; board: BoardState } | null {
  for (const m of Object.values(t.matches)) if (m.status === "live") for (const b of m.boards) if (!b.done && (b.a === pid || b.b === pid)) return { match: m, board: b };
  return null;
}

export async function moveInTournament(t: Tournament, pid: string, cell: number, now: number, ply?: number): Promise<MoveResult | { ok: false; error: "no-live-board" }> {
  await advanceTournament(t, now);
  const f = boardOf(t, pid);
  if (!f) return { ok: false, error: "no-live-board" };
  const r = await applyMove(cfgOf(t), f.match.mid, f.board, pid, cell, now, ply);
  await advanceTournament(t, now);
  return r;
}

/** Everybody's clocks wait while the host pauses: shift them by the length of the pause. */
export function shiftTournament(t: Tournament, ms: number): void { for (const m of Object.values(t.matches)) if (m.status === "live") for (const b of m.boards) shiftBoard(b, ms); }

export interface RankRow { rank: number; id: string; name: string; roundReached: number; points: number; lastMatchPoints: number; fate: string; decidedBy: string }
export const roundName = (t: Tournament, round: number): string => (round === t.rounds ? "Final" : round === t.rounds - 1 ? "Semi-final" : round === t.rounds - 2 ? "Quarter-final" : `Round ${round}`);

/** The strict ranking, every rank unique: (1) round reached (champion, runner-up, semi-finalists...), (2) all points, (3) points in the last match, (4) fate. Each row says how it was separated from the one above. */
export async function rankings(t: Tournament): Promise<RankRow[]> {
  const rows: Omit<RankRow, "rank" | "decidedBy">[] = [];
  for (const e of t.entrants) {
    let points = 0, lastRound = 0, lastPts = 0, reached = 1;
    const mine = new Set(e.members);
    for (const m of Object.values(t.matches)) {
      if (m.bye || m.status === "waiting") { if (m.bye && m.winner === e.id) reached = Math.max(reached, m.round); continue; }
      if (m.a !== e.id && m.b !== e.id) continue;
      let p = 0; for (const b of m.boards) { if (mine.has(b.a)) p += b.points[b.a] ?? 0; if (mine.has(b.b)) p += b.points[b.b] ?? 0; }
      points += p; if (m.round >= lastRound) { lastRound = m.round; lastPts = p; }
      reached = Math.max(reached, m.round);
    }
    const out = Object.values(t.matches).find((m) => m.status === "done" && !m.bye && m.loser === e.id);
    const roundReached = t.champion === e.id ? t.rounds + 1 : out ? out.round : reached;
    rows.push({ id: e.id, name: e.name, roundReached, points, lastMatchPoints: lastPts, fate: await sha256Hex(`${t.seed}|TTT-RANK|${e.id}`) });
  }
  rows.sort((x, y) => y.roundReached - x.roundReached || y.points - x.points || y.lastMatchPoints - x.lastMatchPoints || (x.fate < y.fate ? -1 : 1));
  return rows.map((r, i) => {
    const prev = rows[i - 1];
    const decidedBy = !prev ? "" : prev.roundReached !== r.roundReached ? "round reached" : prev.points !== r.points ? "total points" : prev.lastMatchPoints !== r.lastMatchPoints ? "points in the last match" : "fate";
    return { ...r, rank: i + 1, decidedBy };
  });
}

/** One plain line for a tie on the results screen. */
export const tieLine = (r: RankRow, prevName: string): string => (!r.decidedBy || r.decidedBy === "round reached" ? "" : `${prevName} and ${r.name} were level on ${r.decidedBy === "total points" ? "round reached" : r.decidedBy === "points in the last match" ? "round reached and total points" : "round reached, total points and points in the last match"}; separated by ${r.decidedBy}.`);

export interface BoardView { j: number; a: string; b: string; aName: string; bName: string; cells: number[]; gameNo: number; games: number; turn: string | null; deadline: number | null; done: boolean; winnerName: string | null; how: string }
export interface MatchView { mid: string; round: number; roundName: string; a: string; b: string; status: string; bye: boolean; winner: string | null; boards: BoardView[] }
/** What a spectator (or the big screen) may see: names and boards only. No seed before the start, no device ids, no personal data beyond the display names the players gave. */
export function publicView(t: Tournament): { eid: string; format: string; teamSize: number; players: number; entrants: number; reserve: number; rounds: number; done: boolean; champion: string | null; matches: MatchView[] } {
  const nm = (id: string) => t.names[id] ?? id;
  const matches: MatchView[] = Object.values(t.matches).sort((x, y) => x.round - y.round || x.idx - y.idx).map((m) => ({
    mid: m.mid, round: m.round, roundName: roundName(t, m.round), a: nameOfEntrant(t, m.a), b: nameOfEntrant(t, m.b), status: m.status, bye: !!m.bye, winner: m.winner ? nameOfEntrant(t, m.winner) : null,
    boards: m.boards.map((b) => { const g = b.games[b.games.length - 1]!; return { j: b.j, a: b.a, b: b.b, aName: nm(b.a), bName: nm(b.b), cells: [...g.cells], gameNo: g.no, games: b.games.length, turn: b.done ? null : (g.moves.length % 2 === 0 ? g.x : g.o), deadline: b.done ? null : g.deadline, done: b.done, winnerName: b.winner ? nm(b.winner) : null, how: howBoardEnded(b, nm) }; }),
  }));
  return { eid: t.eid, format: t.format, teamSize: t.teamSize, players: Object.keys(t.names).length, entrants: t.entrants.length, reserve: t.reserve.length, rounds: t.rounds, done: t.done, champion: t.champion ? nameOfEntrant(t, t.champion) : null, matches };
}


