// The Reaction pack: about 50 short text-only reactions a game offers by name at fitting events (rx.react("snake_bite", {who, now})). No faces, no images, no dependency.
// The pack is code and CSS only, so it is bundled with the web app and cached by the service worker (add reactions.css and the bundle to the precache list): it plays offline with no request.
// Style is in reactions.css: a corner strip at most 25% of the screen width, pointer-events none, 2 to 3 s each, never over the golden button or the board.
import type { GameId } from "../../manifest/src";
export type Anim = "pop" | "shake" | "wobble" | "slidel" | "slider" | "drop" | "zoom" | "spin" | "bounce" | "flip";
export type Tone = "gold" | "red" | "blue" | "green" | "plain";
export interface Reaction { id: string; text: string; event: string; games: GameId[]; anim: Anim; tone: Tone; burst: boolean; ms: number; personal: boolean }
const A: GameId[] = ["tambola", "bingo", "tictactoe", "snakes", "luck", "luckydraw"], S: GameId[] = ["snakes"], SL: GameId[] = ["snakes", "luck"], E: GameId[] = ["tictactoe", "snakes", "luck"],
  C: GameId[] = ["tambola", "bingo"], D: GameId[] = ["luckydraw"], LD: GameId[] = ["luck", "luckydraw"];
// id, text, event, games, anim, tone, burst
type Row = [string, string, string, GameId[], Anim, Tone, 0 | 1];
const ROWS: Row[] = [
  ["snake_bite", "Aaahaa, bitten!", "snake_bite", S, "shake", "red", 1], ["snake_bite_again", "Oh my, again!", "snake_bite_again", S, "wobble", "red", 1],
  ["ladder", "Lucky! Ladder!", "ladder", S, "bounce", "green", 1], ["upgrade", "Level up!", "upgrade", S, "slidel", "green", 0], ["downgrade", "Down we go", "downgrade", S, "drop", "red", 0],
  ["reward", "Reward!", "reward", A, "pop", "gold", 1], ["punishment", "Penalty!", "punishment", E, "shake", "red", 0], ["extra_throw", "Throw again!", "extra_throw", SL, "spin", "blue", 1],
  ["missed_turn", "Oops!", "missed_turn", SL, "wobble", "plain", 0], ["dice_roll", "Roll!", "dice_roll", SL, "spin", "blue", 0], ["six", "Six!", "six", SL, "zoom", "gold", 1],
  ["finish", "Finished!", "finish", S, "pop", "gold", 1], ["win", "You won!", "win", A, "pop", "gold", 1], ["out", "Out!", "out", E, "drop", "red", 0],
  ["close_call", "So close!", "close_call", E, "shake", "blue", 0], ["comeback", "Comeback!", "comeback", E, "slider", "green", 0], ["streak", "On a roll!", "streak", E, "bounce", "gold", 0],
  ["ahead", "In front!", "ahead", E, "slidel", "green", 0], ["behind", "Catch up!", "behind", E, "slider", "blue", 0], ["tie", "Tie!", "tie", E, "flip", "plain", 0],
  ["round_start", "Round starts!", "round_start", E, "zoom", "blue", 0], ["round_end", "Round over", "round_end", E, "flip", "plain", 0], ["pause", "Paused", "pause", A, "flip", "plain", 0],
  ["resume", "Back on!", "resume", A, "pop", "green", 0], ["countdown", "3 2 1", "countdown", A, "zoom", "blue", 0], ["time_up", "Time is up!", "time_up", A, "shake", "red", 0],
  ["dishoom", "Dishoom!", "hit", E, "zoom", "red", 1], ["boom", "Boom!", "big", A, "zoom", "gold", 1], ["zap", "Zap!", "quick", E, "slidel", "blue", 1],
  ["oops", "Oops!", "mistake", A, "wobble", "plain", 0], ["not_again", "Not again", "bad_repeat", E, "drop", "red", 0], ["yay", "Yay!", "good", A, "bounce", "green", 1],
  ["wow", "Wow!", "surprise", A, "pop", "gold", 1], ["phew", "Phew!", "relief", E, "drop", "blue", 0], ["ouch", "Ouch!", "pain", E, "shake", "red", 1],
  ["whoosh", "Whoosh!", "move", E, "slider", "blue", 0], ["ta_da", "Ta-da!", "reveal", A, "flip", "gold", 1], ["bingo", "Bingo!", "bingo", ["bingo"], "pop", "gold", 1],
  ["housie", "Housie!", "housie", ["tambola"], "pop", "gold", 1], ["draw", "Draw!", "draw", D, "spin", "gold", 1], ["claim", "Claim!", "claim", C, "bounce", "gold", 1],
  ["your_turn", "Your turn!", "your_turn", E, "slidel", "blue", 0], ["ready", "Ready?", "ready", A, "flip", "plain", 0], ["go", "Go!", "go", A, "zoom", "green", 1],
  ["good_luck", "Good luck!", "good_luck", A, "wobble", "gold", 0], ["jackpot", "Jackpot!", "jackpot", LD, "spin", "gold", 1], ["nice", "Nice one!", "nice", A, "pop", "green", 0],
  ["winners_drawn", "Winners drawn!", "draw_done", D, "flip", "gold", 1], ["next_round", "Next round!", "next_round", E, "slider", "blue", 0], ["last_one", "Last one!", "last", A, "zoom", "red", 0],
  ["great", "Great!", "great", A, "bounce", "green", 0], ["full_house", "Full house!", "full", C, "pop", "gold", 1],
];
export const DEFAULT_MS = 2200, BURST_MS = 2400;
/** Events that concern everybody in the game; every other reaction is personal and shows only to the participant it happened to. */
const SHARED = new Set(["round_start", "round_end", "pause", "resume", "countdown", "time_up", "ready", "go", "good_luck", "next_round", "last", "draw_done", "draw", "reveal", "big", "surprise"]);
export const REACTIONS: Reaction[] = ROWS.map(([id, text, event, games, anim, tone, b]) => ({ id, text, event, games, anim, tone, burst: !!b, ms: b ? BURST_MS : DEFAULT_MS, personal: !SHARED.has(event) }));
export const reactionsFor = (game: GameId): Reaction[] => REACTIONS.filter((r) => r.games.includes(game));
/** The reactions a game can show for an event (e.g. "hit"); the game picks one. */
export const reactionsForEvent = (event: string): Reaction[] => REACTIONS.filter((r) => r.event === event);
/** The Organizer's setting for the game: full, reduced (the word shows still, same time) or off (nothing is shown). */
export type ReactionMode = "full" | "reduced" | "off";
export const REACTION_MODES: ReactionMode[] = ["full", "reduced", "off"];
/** Only these may jump the 15 s gap (they still count toward the maximum). */
export const HIGH_PRIORITY = ["win", "finish", "out"];
export const MIN_GAP_MS = 15_000, MAX_PER_WINDOW = 15, WINDOW_MS = 600_000;
export type Priority = "normal" | "high";
/** `who`: the participant the event happened to (needed for personal reactions). `now`: game time in ms (gameNow), so a pause freezes the throttle too. */
export interface Offer { priority?: Priority; who?: string; now: number; game?: GameId }
export type Verdict = "show" | "queued" | "off" | "unknown" | "wrong-game" | "not-yours" | "throttled" | "max" | "busy";
/**
 * The scheduler: one reaction at a time, a queue of one, at least 15 s between two reactions for this participant and at most 15 per 10 minutes of game time.
 * A high-priority reaction (win, finish, out) may jump the 15 s gap but still counts toward the 15. It never makes a reaction up: the game offers one at a fitting event.
 */
export class ReactionScheduler {
  mode: ReactionMode = "full";
  private shown: number[] = []; private cur: { until: number } | null = null; private queue: { r: Reaction; high: boolean } | null = null; private last = -Infinity;
  /** `viewer`: the participant this screen belongs to. `onShow` draws the reaction (default: the page). */
  constructor(readonly viewer: string | null, private onShow: (r: Reaction, mode: ReactionMode) => void = (r, m) => domShow(r, m)) {}
  setMode(m: ReactionMode): void { this.mode = m; if (m === "off") this.queue = null; }
  private allowed(now: number, high: boolean): Verdict | null {
    this.shown = this.shown.filter((t) => now - t < WINDOW_MS);
    if (this.shown.length >= MAX_PER_WINDOW) return "max";
    return !high && now - this.last < MIN_GAP_MS ? "throttled" : null;
  }
  private start(r: Reaction, now: number): void { this.shown.push(now); this.last = now; this.cur = { until: now + r.ms }; this.onShow(r, this.mode); }
  /** Move on: the current one has finished; show the queued one if it is still allowed. */
  tick(now: number): void {
    if (this.cur && now >= this.cur.until) this.cur = null;
    if (!this.cur && this.queue) { const q = this.queue; this.queue = null; if (this.mode !== "off" && !this.allowed(now, q.high)) this.start(q.r, now); }
  }
  /** Offer a reaction at an event. Returns what happened; nothing is ever shown that was not offered. */
  react(id: string, o: Offer): Verdict {
    const r = REACTIONS.find((x) => x.id === id);
    if (this.mode === "off") return "off";
    if (!r) return "unknown";
    if (o.game && !r.games.includes(o.game)) return "wrong-game";
    if (r.personal && (o.who === undefined || o.who !== this.viewer)) return "not-yours";
    this.tick(o.now);
    const high = o.priority === "high" && HIGH_PRIORITY.includes(r.id), v = this.allowed(o.now, high);
    if (v) return v;
    if (!this.cur) { this.start(r, o.now); return "show"; }
    if (!this.queue || (high && !this.queue.high)) { this.queue = { r, high }; return "queued"; }
    return "busy";
  }
  /** For the demo page only: show now, ignoring the throttle. */
  preview(id: string): void { const r = REACTIONS.find((x) => x.id === id); if (r && this.mode !== "off") this.onShow(r, this.mode); }
}
const domShow = (r: Reaction, mode: ReactionMode, doc: Document = document): void => {
  let layer = doc.getElementById("rx-layer");
  if (!layer) { layer = doc.createElement("div"); layer.id = "rx-layer"; layer.setAttribute("aria-hidden", "true"); doc.body.appendChild(layer); }
  layer.replaceChildren();
  const el = doc.createElement("span");
  el.className = `rx ${r.tone}${r.burst ? " b" : ""}`;
  el.textContent = r.text;
  el.style.setProperty("--rxa", `rx-${r.anim}`); el.style.setProperty("--rxd", `${r.ms}ms`);
  if (mode === "reduced") el.style.animationName = "rx-fade"; // a static word for the same time (also the prefers-reduced-motion rule in the CSS)
  layer.appendChild(el);
  setTimeout(() => el.remove(), r.ms + 50);
};
export const createReactions = (viewer: string | null): ReactionScheduler => new ReactionScheduler(viewer);
