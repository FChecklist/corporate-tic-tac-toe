// Tic Tac Toe stage settle: PURE and deterministic. Every phone runs it from the published start time and the relayed public log of agreed results, so every phone gets
// the same stage, slot, pairing, cut line and ranking. The server only stores and relays; it never runs this. Rule text: docs/TICTACTOE_RULES_BOOK.md (rules 3a to 3e).
import { sha256Hex as sha256 } from "../../core/src/sha256";
import { STAGES, STAGE_SECONDS, WAIT_SECONDS, WINNERS, BYE_POINTS, gamePoints, keepAfter, unrepeat, type Stat } from "./index";

export const SLOTS_PER_STAGE = 3, SLOT_SECONDS = 100, GAME_MAX_SECONDS = 90, SLOT_PAUSE_SECONDS = 10; // a game is at most 9 moves x 10 s = 90 s, plus a 10 s pause: 3 x 100 s = 300 s
/** One agreed result of a 1-game match (two-sided report, relayed by the server). winner is "a" | "b" | "draw" for the pair as listed by the pairing (a = the first of the pair). */
export interface SlotResult { stage: number; slot: number; a: string; b: string; winner: "a" | "b" | "draw" }
export interface Clock { phase: "waiting" | "slot" | "done"; stage: number; slot: number; slotStartMs: number; slotEndMs: number; stageEndMs: number; secondsLeftInStage: number; secondsToStart: number }
const hex = (s: string): string => sha256(s);
/** Where the game is at `nowMs`. `startMs` = the published start (waiting room opens); `pausedMs` = total time paused so far (every clock stands still while paused). */
export function clockAt(startMs: number, nowMs: number, pausedMs = 0): Clock {
  const el = Math.floor((nowMs - pausedMs - startMs) / 1000), play = STAGES * STAGE_SECONDS;
  if (el < WAIT_SECONDS) return { phase: "waiting", stage: 0, slot: 0, slotStartMs: startMs, slotEndMs: startMs + WAIT_SECONDS * 1000 + pausedMs, stageEndMs: startMs + WAIT_SECONDS * 1000 + pausedMs, secondsLeftInStage: 0, secondsToStart: WAIT_SECONDS - el };
  const p = el - WAIT_SECONDS;
  if (p >= play) return { phase: "done", stage: STAGES, slot: SLOTS_PER_STAGE, slotStartMs: 0, slotEndMs: 0, stageEndMs: 0, secondsLeftInStage: 0, secondsToStart: 0 };
  const stage = Math.floor(p / STAGE_SECONDS) + 1, inStage = p - (stage - 1) * STAGE_SECONDS, slot = Math.floor(inStage / SLOT_SECONDS) + 1;
  const base = startMs + pausedMs + (WAIT_SECONDS + (stage - 1) * STAGE_SECONDS) * 1000;
  return { phase: "slot", stage, slot, slotStartMs: base + (slot - 1) * SLOT_SECONDS * 1000, slotEndMs: base + slot * SLOT_SECONDS * 1000, stageEndMs: base + STAGE_SECONDS * 1000, secondsLeftInStage: STAGE_SECONDS - inStage, secondsToStart: 0 };
}
const zero = (): Stat => ({ points: 0, wins: 0, stagePoints: 0, byeStages: [] });
/** Cut and ranking order: points, then wins, then points in the last stage, then fate (lower wins), then the id (never tied). */
const rank = (stats: Record<string, Stat>, fate: Record<string, number>, ps: string[]): string[] =>
  [...ps].sort((x, y) => { const a = stats[x] ?? zero(), b = stats[y] ?? zero(); return (b.points - a.points) || (b.wins - a.wins) || (b.stagePoints - a.stagePoints) || ((fate[x] ?? 0) - (fate[y] ?? 0)) || (x < y ? -1 : 1); });
/** Pair the free players for one slot: by points (nearby points meet), ties broken by sha256(gameId|stage|slot|player); never the same opponent as in the last slot; the odd one out (lowest, no bye yet this stage) sits out and gets 1 point. */
export function pairSlot(gameId: string, stage: number, slot: number, free: string[], stats: Record<string, Stat>, lastOpp: Record<string, string | undefined>): { pairs: [string, string][]; bye: string | null } {
  const key = (p: string) => hex(`${gameId}|${stage}|${slot}|${p}`);
  const list = [...free].sort((x, y) => ((stats[y] ?? zero()).points - (stats[x] ?? zero()).points) || (key(x) < key(y) ? -1 : 1));
  let bye: string | null = null;
  if (list.length % 2 === 1) {
    for (let i = list.length - 1; i >= 0; i--) if (!(stats[list[i]!] ?? zero()).byeStages.includes(stage)) { bye = list.splice(i, 1)[0]!; break; }
    if (!bye) bye = list.pop()!;
  }
  const pairs: [string, string][] = [];
  while (list.length > 1) {
    const a = list.shift()!; let j = list.findIndex((x) => lastOpp[a] !== x && lastOpp[x] !== a); if (j < 0) j = 0;
    pairs.push([a, list.splice(j, 1)[0]!]);
  }
  return { pairs: free.length >= 4 ? unrepeat(pairs, (x, y) => lastOpp[x] === y || lastOpp[y] === x) : pairs, bye };
}
export interface Settled { stage: number; slot: number; phase: Clock["phase"]; alive: string[]; out: { player: string; stage: number }[]; stats: Record<string, Stat>; pairsNow: [string, string][]; bye: string | null; ranking?: string[]; winners?: string[]; over: boolean }
/**
 * The whole game from the log. `results` = every agreed result so far (any order). A pair with no agreed result at the end of its slot is a draw (still running, or a phone was offline: no move was made, so nobody won).
 * A result for a pair that the pairing did not make, or for a slot not yet finished, is ignored (it cannot change the pairing).
 */
export function settleStages(o: { gameId: string; startMs: number; nowMs: number; pausedMs?: number; players: string[]; fate: Record<string, number>; results: SlotResult[] }): Settled {
  const clock = clockAt(o.startMs, o.nowMs, o.pausedMs ?? 0);
  let alive = [...o.players], stats: Record<string, Stat> = {}; const out: Settled["out"] = [], lastOpp: Record<string, string | undefined> = {};
  const lastStage = clock.phase === "done" ? STAGES : clock.stage, lastSlot = clock.phase === "done" ? SLOTS_PER_STAGE : clock.slot;
  // two results for the same pair and slot that disagree count as a draw, whatever order they arrived in
  const res = new Map<string, SlotResult>(); for (const r of o.results) { const k = `${r.stage}|${r.slot}|${r.a}|${r.b}`, e = res.get(k); res.set(k, e && e.winner !== r.winner ? { ...r, winner: "draw" } : (e ?? r)); }
  let pairsNow: [string, string][] = [], byeNow: string | null = null, over = false, ranking: string[] | undefined;
  for (let st = 1; st <= lastStage && !over; st++) {
    for (const p of alive) stats[p] = { ...(stats[p] ?? zero()), stagePoints: 0 };
    const slots = st < lastStage || clock.phase === "done" ? SLOTS_PER_STAGE : lastSlot;
    for (let sl = 1; sl <= slots; sl++) {
      const { pairs, bye } = pairSlot(o.gameId, st, sl, alive, stats, lastOpp);
      const finished = st < lastStage || clock.phase === "done" || sl < lastSlot;
      if (!finished) { pairsNow = pairs; byeNow = bye; break; }
      if (bye && !(stats[bye] ?? zero()).byeStages.includes(st)) { const t = stats[bye] ?? zero(); stats[bye] = { ...t, points: t.points + BYE_POINTS, stagePoints: t.stagePoints + BYE_POINTS, byeStages: [...t.byeStages, st] }; lastOpp[bye] = undefined; } else if (bye) lastOpp[bye] = undefined;
      for (const [a, b] of pairs) {
        const r = res.get(`${st}|${sl}|${a}|${b}`), w = r ? r.winner : "draw";
        const A = stats[a] ?? zero(), B = stats[b] ?? zero(), pa = gamePoints(w, "a"), pb = gamePoints(w, "b");
        stats[a] = { ...A, points: A.points + pa, stagePoints: A.stagePoints + pa, wins: A.wins + (w === "a" ? 1 : 0) }; stats[b] = { ...B, points: B.points + pb, stagePoints: B.stagePoints + pb, wins: B.wins + (w === "b" ? 1 : 0) };
        lastOpp[a] = b; lastOpp[b] = a;
      }
    }
    const stageDone = st < lastStage || clock.phase === "done";
    if (stageDone) {
      const o2 = rank(stats, o.fate, alive);
      if (st >= STAGES) { ranking = o2; over = true; break; }
      const keep = keepAfter(st, o2.length); for (const p of o2.slice(keep)) out.push({ player: p, stage: st });
      alive = o2.slice(0, keep);
    }
  }
  return { stage: clock.stage, slot: clock.slot, phase: clock.phase, alive, out, stats, pairsNow, bye: byeNow, ranking, winners: ranking?.slice(0, WINNERS), over };
}
/** What one player sees: place, how many places to the cut line, and (if still free this slot) the opponent. */
export function viewFor(s: Settled, me: string, fate: Record<string, number>): { place: number; of: number; keep: number; safe: boolean; placesToLine: number; opponent: string | null; sitsOut: boolean; isOut: boolean } {
  const r = rank(s.stats, fate, s.alive), place = r.indexOf(me) + 1, keep = s.phase === "done" ? Math.min(WINNERS, r.length) : keepAfter(s.stage || 1, r.length);
  const pair = s.pairsNow.find(([a, b]) => a === me || b === me);
  return { place, of: r.length, keep, safe: place > 0 && place <= keep, placesToLine: place <= keep ? keep - place : place - keep, opponent: pair ? (pair[0] === me ? pair[1] : pair[0]) : null, sitsOut: s.bye === me, isOut: !s.alive.includes(me) };
}
