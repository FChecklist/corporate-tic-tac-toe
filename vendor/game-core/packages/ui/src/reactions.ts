// The Reaction pack: about 50 short text-only reactions a game offers by name at fitting events (rx.react("snake_bite", {who, now})). No faces, no images, no dependency.
// The pack is code and CSS only, so it is bundled with the web app and cached by the service worker (add reactions.css and the bundle to the precache list): it plays offline with no request.
// All of it is our own work (shapes, colours, lettering, words, motions: docs/REACTIONS_ORIGINAL.md). Style is in reactions.css: a corner strip at most 25% of the screen width, pointer-events none, 2 to 3 s each, never over the golden button or the board.
import type { GameId } from "../../manifest/src";
export type Anim = "pop" | "shake" | "wobble" | "slidel" | "slider" | "drop" | "zoom" | "spin" | "bounce" | "flip";
/** Our eight original shapes (drawn as polygons by tools/shapes.ts): spiky burst, round pop, cloud puff, jagged zigzag, wobbly bubble, ribbon, starburst, drip. */
export type Shape = "burst" | "pop" | "puff" | "zigzag" | "wobble" | "ribbon" | "star" | "drip";
/** Our eight colour pairs (fill, ink, line) are in reactions.css as p1..p8: 1 sun, 2 coral, 3 mint, 4 sky, 5 grape, 6 lime, 7 pink, 8 night. */
export type Pal = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export interface Reaction { id: string; text: string; event: string; events: string[]; games: GameId[]; anim: Anim; shape: Shape; pal: Pal; tilt: number; ms: number; personal: boolean }
const A: GameId[] = ["tambola", "bingo", "tictactoe", "snakes", "luck", "luckydraw"], S: GameId[] = ["snakes"], SL: GameId[] = ["snakes", "luck"], E: GameId[] = ["tictactoe", "snakes", "luck"],
  C: GameId[] = ["tambola", "bingo"], D: GameId[] = ["luckydraw"], LD: GameId[] = ["luck", "luckydraw"];
// id, text, event(s) separated by |, games, motion, shape, palette, tilt in degrees. Each reaction is one choice of all four, made for this pack (see docs/REACTIONS_ORIGINAL.md).
type Row = [string, string, string, GameId[], Anim, Shape, Pal, number];
const ROWS: Row[] = [
  // join and start
  ["hello", "Hello!", "join", A, "pop", "puff", 3, -3], ["hi_there", "Hi there!", "join", A, "bounce", "pop", 7, 3], ["good_luck", "Good luck!", "game_start", A, "wobble", "puff", 6, 2],
  ["lets_go", "Let's go!", "game_start|resume", A, "zoom", "pop", 3, -3], ["ready_set_go", "Ready, set, go!", "round_start|countdown", A, "zoom", "burst", 4, -2],
  // good
  ["yeah", "Yeah!", "good", A, "bounce", "pop", 6, -3], ["yes", "Yes!", "good", A, "pop", "wobble", 3, 3], ["super", "Super!", "good", A, "slidel", "ribbon", 1, 2], ["cool", "Cool!", "good", A, "flip", "pop", 4, -2],
  ["wow", "Wow!", "surprise", A, "pop", "star", 7, 3], ["nice_one", "Nice one!", "good_move", A, "pop", "wobble", 3, 3], ["bam", "Bam!", "hit", E, "zoom", "burst", 2, -4], ["pow", "Pow!", "hit", E, "pop", "burst", 1, 4],
  ["zap", "Zap!", "hit|quick", E, "slidel", "zigzag", 4, -3], ["boom", "Boom!", "big_win", A, "zoom", "star", 1, 4], ["ta_da", "Ta-da!", "reveal|draw_done", A, "flip", "star", 7, 3], ["hurray", "Hurray!", "round_win", A, "bounce", "burst", 6, -3],
  ["lucky_you", "Lucky you!", "lucky", A, "wobble", "puff", 1, 3], ["jackpot", "Jackpot!", "jackpot", LD, "spin", "star", 1, -4], ["spot_on", "Spot on!", "exact", A, "pop", "pop", 3, 2],
  // ladder and reward
  ["climb_on", "Climb on!", "ladder", S, "bounce", "ribbon", 3, -3], ["up_you_go", "Up you go!", "upgrade", S, "slidel", "ribbon", 6, 2], ["big_jump", "Big jump!", "ladder_big", S, "bounce", "star", 3, -3],
  ["extra_throws", "Extra throws!", "extra_throw|reward", SL, "spin", "burst", 4, 3], ["bonus_time", "Bonus time!", "bonus|reward", A, "pop", "pop", 1, 4], ["bullseye", "Bullseye!", "finish", A, "pop", "burst", 3, -2],
  // bad luck, snake, penalty
  ["oh", "Oh!", "bad_luck", E, "wobble", "wobble", 5, 3], ["no", "No!", "bad_luck", E, "shake", "zigzag", 2, 3], ["why_me", "Why me?", "bad_luck", E, "drop", "wobble", 8, -2],
  ["oops", "Oops!", "mistake|missed_turn", A, "wobble", "puff", 7, -4], ["ouch", "Ouch!", "pain|penalty", E, "shake", "burst", 2, -4], ["aaah_bitten", "Aaah, bitten!", "snake_bite", S, "shake", "drip", 2, -4],
  ["not_again", "Not again!", "snake_bite_again|bad_repeat", E, "drop", "drip", 5, -2], ["slip_slide", "Slip slide!", "downgrade", S, "drop", "drip", 8, -2], ["oh_my", "Oh my!", "bad_repeat", E, "wobble", "wobble", 5, 3],
  ["crash", "Crash!", "snake_far", S, "drop", "zigzag", 2, -3],
  // near miss and timing
  ["yikes", "Yikes!", "danger", E, "shake", "burst", 2, -3], ["phew", "Phew!", "relief", E, "drop", "puff", 4, 2], ["so_close", "So close!", "close_call", E, "shake", "wobble", 4, -2],
  ["missed_it", "Missed it!", "missed_turn|time_up", E, "drop", "zigzag", 8, 2], ["hurry_up", "Hurry up!", "time_warning", A, "shake", "zigzag", 2, 2], ["tick_tock", "Tick tock!", "countdown", A, "flip", "pop", 4, 0],
  ["last_chance", "Last chance!", "last|time_warning", A, "zoom", "zigzag", 2, -2], ["hang_on", "Hang on!", "pause|wait", A, "flip", "pop", 8, 0],
  // standing and end
  ["comeback_time", "Comeback time!", "comeback", E, "slider", "ribbon", 3, 2], ["youre_ahead", "You're ahead!", "ahead|streak", E, "slidel", "ribbon", 3, 1], ["catch_up", "Catch up!", "behind", E, "slider", "zigzag", 4, -1],
  ["poof_gone", "Poof, gone!", "out|drop_out", E, "drop", "puff", 8, 2], ["kapow", "Kapow!", "big_hit", E, "zoom", "burst", 5, -5], ["champion", "Champion!", "win", A, "pop", "star", 1, 3],
];
export const DEFAULT_MS = 2200, BIG_MS = 2600;
/** Events that concern everybody in the game; every other reaction is personal and shows only to the participant it happened to. */
const SHARED = new Set(["game_start", "resume", "round_start", "countdown", "pause", "wait", "time_warning", "last", "reveal", "draw_done"]);
export const REACTIONS: Reaction[] = ROWS.map(([id, text, event, games, anim, shape, pal, tilt]) => ({ id, text, event: event.split("|")[0]!, events: event.split("|"), games, anim, shape, pal, tilt, ms: id === "champion" || id === "bullseye" ? BIG_MS : DEFAULT_MS, personal: !event.split("|").some((e) => SHARED.has(e)) }));
export const reactionsFor = (game: GameId): Reaction[] => REACTIONS.filter((r) => r.games.includes(game));
/** The reactions a game can show for an event (e.g. "hit"); the game picks one. */
export const reactionsForEvent = (event: string): Reaction[] => REACTIONS.filter((r) => r.events.includes(event));
/** The Organizer's setting for the game: full, reduced (the word shows still, same time) or off (nothing is shown). */
export type ReactionMode = "full" | "reduced" | "off";
export const REACTION_MODES: ReactionMode[] = ["full", "reduced", "off"];
/** Only these may jump the 15 s gap (they still count toward the maximum). */
export const HIGH_PRIORITY = ["champion", "bullseye", "poof_gone"];
export const MIN_GAP_MS = 15_000, MAX_PER_WINDOW = 15, WINDOW_MS = 600_000;
export type Priority = "normal" | "high";
/** `who`: the participant the event happened to (needed for personal reactions). `now`: game time in ms (gameNow), so a pause freezes the throttle too. */
export interface Offer { priority?: Priority; who?: string; now: number; game?: GameId }
export type Verdict = "show" | "queued" | "off" | "unknown" | "wrong-game" | "not-yours" | "throttled" | "max" | "busy";
/**
 * The scheduler: one reaction at a time, a queue of one, at least 15 s between two reactions for this participant and at most 15 per 10 minutes of game time.
 * A high-priority reaction (champion, bullseye, poof_gone: win, finish, out) may jump the 15 s gap but still counts toward the 15. It never makes a reaction up: the game offers one at a fitting event.
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
  el.className = `rx p${r.pal} sh-${r.shape}`; el.style.setProperty("--rxt", `${r.tilt}deg`);
  el.textContent = r.text;
  el.style.setProperty("--rxa", `rx-${r.anim}`); el.style.setProperty("--rxd", `${r.ms}ms`);
  if (mode === "reduced") el.style.animationName = "rx-fade"; // a static word for the same time (also the prefers-reduced-motion rule in the CSS)
  layer.appendChild(el);
  setTimeout(() => el.remove(), r.ms + 50);
};
export const createReactions = (viewer: string | null): ReactionScheduler => new ReactionScheduler(viewer);
