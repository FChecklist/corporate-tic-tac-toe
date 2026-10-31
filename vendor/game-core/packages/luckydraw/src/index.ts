// The Lucky Draw rules module (spec 410 section 5). See docs/LUCKYDRAW_RULES_BOOK.md.
// The beacon value is public and given in by the host site; the core never makes it. Fairness here is only what the code below proves.
import { MANIFESTS } from "../../manifest/src";
import { canControlClock, gameNow, normId, sha256Hex, type Clock, type IdKind, type Outcome, type Role, type RulesModule, type SetupField } from "../../core/src";
export const DRAW_CAP = 100_000;
export const setupFields: SetupField[] = [
  { key: "winners", label: "Number of winners", kind: "number", default: 1, help: "One entry cannot win twice." },
  { key: "prizes", label: "Prize for each place", kind: "text", default: "", help: "1st, 2nd, 3rd and so on, separated by commas." },
  { key: "draw", label: "Draw", kind: "choice", choices: ["auto", "manual"], default: "auto" },
  { key: "ref", label: "Draw reference", kind: "text", default: "0", advanced: true, help: "Which beacon round decides the draw." },
];
export interface DrawState {
  eid: string; ref: string; idKind: IdKind; mode: "auto" | "manual"; closeAt: number; winnersWanted: number; prizes: string[]; cap: number;
  entries: string[]; drawn: string[] | null; beacon: string | null; over: boolean;
}
export type DrawEvent =
  | { type: "tick"; beacon?: string }                       // auto: the first tick at or after the draw time that carries the beacon draws
  | { type: "register"; player: string }
  | { type: "registerMany"; players: string[] }              // a batch in one pass (the host collects a tick's registrations); same rules per person
  | { type: "draw"; by: Role; beacon: string };              // manual: the Organizer or Host presses Draw
/** The rank of an entry for this draw. Anybody holding the entries and the beacon value can compute it; the lowest ranks win. */
export const rankOf = (eid: string, ref: string, beacon: string, id: string): string => sha256Hex(`CB1-LUCKY|${eid}|${ref}|${beacon}|${id}`);
/** The winners, in place order. Every entry is equally likely, nobody wins twice, the answer depends only on the entries and the beacon. */
export function winnersFor(eid: string, ref: string, beacon: string, entries: readonly string[], n: number): string[] {
  return [...new Set(entries)].map((id) => [rankOf(eid, ref, beacon, id), id] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, Math.max(0, n)).map((x) => x[1]);
}
const place = (i: number): string => ["1st", "2nd", "3rd"][i] ?? `${i + 1}th`;
export const prizePlaces = (n: number): string[] => Array.from({ length: n }, (_, i) => place(i));
const finishDraw = (s: DrawState, beacon: string): { state: DrawState; out: Outcome[] } => {
  const drawn = winnersFor(s.eid, s.ref, beacon, s.entries, s.winnersWanted);
  return { state: { ...s, drawn, beacon, over: true }, out: [...drawn.map((player, i): Outcome => ({ kind: "win", player, position: place(i) })), { kind: "end" }] };
};
export const luckyDrawRules: RulesModule<DrawState, DrawEvent> = {
  manifest: MANIFESTS.luckydraw,
  setupFields,
  claimType: "auto",
  goldenButton: "You won",
  prizePositions: (s) => prizePlaces(Math.max(1, Number(s.winners ?? 1))),
  lateJoin: MANIFESTS.luckydraw.lateJoin,
  init(setup, _players, now) {
    const mode = setup.draw === "manual" ? "manual" : "auto";
    const winnersWanted = Math.floor(Number(setup.winners ?? 1));
    if (!(winnersWanted >= 1)) throw new Error("a draw needs at least one winner");
    const closeAt = mode === "auto" ? Number(setup.closeAt) : Infinity;
    if (mode === "auto" && !Number.isFinite(closeAt)) throw new Error("an automatic draw needs its draw time (setup.closeAt)");
    const cap = setup.rehearsal ? MANIFESTS.luckydraw.rehearsalMax : Math.min(Number(setup.cap ?? DRAW_CAP), DRAW_CAP);
    return {
      eid: String(setup.eid ?? ""), ref: String(setup.ref ?? "0"), idKind: setup.idKind === "email" ? "email" : "emp", mode, closeAt, winnersWanted, cap,
      prizes: String(setup.prizes ?? "").split(",").map((p) => p.trim()).filter(Boolean), entries: [], drawn: null, beacon: null, over: false,
    };
  },
  step(s, e, now, clock: Clock) {
    if (s.over || clock.phase === "paused") return { state: s, out: [] }; // paused: nothing registers, nothing draws, the draw time waits
    const t = gameNow(clock, now);
    if (e.type === "register") {
      const id = normId(s.idKind, e.player);
      // refused (closed, full, bad id, already in) changes nothing; the host site shows the guided message
      if (!id || t >= s.closeAt || s.entries.length >= s.cap || s.entries.includes(id)) return { state: s, out: [] };
      return { state: { ...s, entries: [...s.entries, id] }, out: [] };
    }
    if (e.type === "registerMany") {
      if (t >= s.closeAt) return { state: s, out: [] };
      const seen = new Set(s.entries), add: string[] = [];
      for (const raw of e.players) { const id = normId(s.idKind, raw); if (id && !seen.has(id) && s.entries.length + add.length < s.cap) { seen.add(id); add.push(id); } }
      return add.length ? { state: { ...s, entries: s.entries.concat(add) }, out: [] } : { state: s, out: [] };
    }
    if (e.type === "draw") return s.mode === "manual" && canControlClock(e.by) && e.beacon ? finishDraw(s, e.beacon) : { state: s, out: [] };
    const b = "beacon" in e ? e.beacon : undefined;
    return s.mode === "auto" && t >= s.closeAt && b ? finishDraw(s, b) : { state: s, out: [] };
  },
};
/** Why a registration was refused, in the order a participant should hear it (the host site turns this into the guided message). */
export function registerWhy(s: DrawState, raw: string, now: number, clock: Clock): string | null {
  const id = normId(s.idKind, raw);
  if (s.drawn) return "The draw is done.";
  if (!id) return "That ID is not valid.";
  if (gameNow(clock, now) >= s.closeAt) return "Registration is closed.";
  if (s.entries.includes(id)) return "You are already in the draw.";
  if (s.entries.length >= s.cap) return "The draw is full.";
  return null;
}
