// The Reaction pack: about 50 short text-only reactions every game can call by name (react("snake_bite")). No faces, no images, no dependency.
// Style is in reactions.css. Each plays 0.6 to 1.5 s and removes itself; pointer-events none; it sits in the top strip, never over the golden button or the board.
import type { GameId } from "../../manifest/src";
export type Anim = "pop" | "shake" | "wobble" | "slidel" | "slider" | "drop" | "zoom" | "spin" | "bounce" | "flip";
export type Tone = "gold" | "red" | "blue" | "green" | "plain";
export interface Reaction { id: string; text: string; event: string; games: GameId[]; anim: Anim; tone: Tone; burst: boolean; ms: number }
const A: GameId[] = ["tambola", "bingo", "tictactoe", "snakes", "luck", "luckydraw"], S: GameId[] = ["snakes"], SL: GameId[] = ["snakes", "luck"], E: GameId[] = ["tictactoe", "snakes", "luck"],
  C: GameId[] = ["tambola", "bingo"], D: GameId[] = ["luckydraw"], LD: GameId[] = ["luck", "luckydraw"];
// id, text, event, games, anim, tone, burst, ms
type Row = [string, string, string, GameId[], Anim, Tone, 0 | 1, number];
const ROWS: Row[] = [
  ["snake_bite", "Aaahaa, bitten!", "snake_bite", S, "shake", "red", 1, 1300], ["snake_bite_again", "Oh my, again!", "snake_bite_again", S, "wobble", "red", 1, 1400],
  ["ladder", "Lucky! Ladder!", "ladder", S, "bounce", "green", 1, 1300], ["upgrade", "Level up!", "upgrade", S, "slidel", "green", 0, 1100], ["downgrade", "Down we go", "downgrade", S, "drop", "red", 0, 1100],
  ["reward", "Reward!", "reward", A, "pop", "gold", 1, 1200], ["punishment", "Penalty!", "punishment", E, "shake", "red", 0, 1100], ["extra_throw", "Throw again!", "extra_throw", SL, "spin", "blue", 1, 1200],
  ["missed_turn", "Oops!", "missed_turn", SL, "wobble", "plain", 0, 900], ["dice_roll", "Roll!", "dice_roll", SL, "spin", "blue", 0, 800], ["six", "Six!", "six", SL, "zoom", "gold", 1, 1100],
  ["finish", "Finished!", "finish", S, "pop", "gold", 1, 1400], ["win", "You won!", "win", A, "pop", "gold", 1, 1500], ["out", "Out!", "out", E, "drop", "red", 0, 1100],
  ["close_call", "So close!", "close_call", E, "shake", "blue", 0, 1000], ["comeback", "Comeback!", "comeback", E, "slider", "green", 0, 1200], ["streak", "On a roll!", "streak", E, "bounce", "gold", 0, 1100],
  ["ahead", "In front!", "ahead", E, "slidel", "green", 0, 900], ["behind", "Catch up!", "behind", E, "slider", "blue", 0, 900], ["tie", "Tie!", "tie", E, "flip", "plain", 0, 1000],
  ["round_start", "Round starts!", "round_start", E, "zoom", "blue", 0, 1200], ["round_end", "Round over", "round_end", E, "flip", "plain", 0, 1100], ["pause", "Paused", "pause", A, "flip", "plain", 0, 1000],
  ["resume", "Back on!", "resume", A, "pop", "green", 0, 900], ["countdown", "3 2 1", "countdown", A, "zoom", "blue", 0, 900], ["time_up", "Time is up!", "time_up", A, "shake", "red", 0, 1200],
  ["dishoom", "Dishoom!", "hit", E, "zoom", "red", 1, 1000], ["boom", "Boom!", "big", A, "zoom", "gold", 1, 1000], ["zap", "Zap!", "quick", E, "slidel", "blue", 1, 800],
  ["oops", "Oops!", "mistake", A, "wobble", "plain", 0, 900], ["not_again", "Not again", "bad_repeat", E, "drop", "red", 0, 1100], ["yay", "Yay!", "good", A, "bounce", "green", 1, 1000],
  ["wow", "Wow!", "surprise", A, "pop", "gold", 1, 1000], ["phew", "Phew!", "relief", E, "drop", "blue", 0, 1000], ["ouch", "Ouch!", "pain", E, "shake", "red", 1, 900],
  ["whoosh", "Whoosh!", "move", E, "slider", "blue", 0, 800], ["ta_da", "Ta-da!", "reveal", A, "flip", "gold", 1, 1300], ["bingo", "Bingo!", "bingo", ["bingo"], "pop", "gold", 1, 1400],
  ["housie", "Housie!", "housie", ["tambola"], "pop", "gold", 1, 1400], ["draw", "Draw!", "draw", D, "spin", "gold", 1, 1300], ["claim", "Claim!", "claim", C, "bounce", "gold", 1, 1100],
  ["your_turn", "Your turn!", "your_turn", E, "slidel", "blue", 0, 1000], ["ready", "Ready?", "ready", A, "flip", "plain", 0, 900], ["go", "Go!", "go", A, "zoom", "green", 1, 800],
  ["good_luck", "Good luck!", "good_luck", A, "wobble", "gold", 0, 1200], ["jackpot", "Jackpot!", "jackpot", LD, "spin", "gold", 1, 1500], ["nice", "Nice one!", "nice", A, "pop", "green", 0, 1000],
  ["winners_drawn", "Winners drawn!", "draw_done", D, "flip", "gold", 1, 1400], ["next_round", "Next round!", "next_round", E, "slider", "blue", 0, 1000], ["last_one", "Last one!", "last", A, "zoom", "red", 0, 1000],
  ["great", "Great!", "great", A, "bounce", "green", 0, 900], ["full_house", "Full house!", "full", C, "pop", "gold", 1, 1400],
];
export const REACTIONS: Reaction[] = ROWS.map(([id, text, event, games, anim, tone, b, ms]) => ({ id, text, event, games, anim, tone, burst: !!b, ms }));
export const reactionsFor = (game: GameId): Reaction[] => REACTIONS.filter((r) => r.games.includes(game));
/** The reactions a game can show for an event (e.g. "hit"); the game picks one. */
export const reactionsForEvent = (event: string): Reaction[] => REACTIONS.filter((r) => r.event === event);
/** The Organizer's setting for the game: full, reduced (the word shows still and brief) or off (nothing is shown). */
export type ReactionMode = "full" | "reduced" | "off";
export const REACTION_MODES: ReactionMode[] = ["full", "reduced", "off"];
let mode: ReactionMode = "full";
export const setReactionMode = (m: ReactionMode): void => { mode = m; };
export const getReactionMode = (): ReactionMode => mode;
const MAX_AT_ONCE = 2;
/** Show a reaction by id. Returns false when it is off, unknown or two are already showing. Needs a browser document. */
export function react(id: string, doc: Document = document): boolean {
  const r = REACTIONS.find((x) => x.id === id);
  if (!r || mode === "off") return false;
  let layer = doc.getElementById("rx-layer");
  if (!layer) { layer = doc.createElement("div"); layer.id = "rx-layer"; layer.setAttribute("aria-hidden", "true"); doc.body.appendChild(layer); }
  if (layer.childElementCount >= MAX_AT_ONCE) return false;
  const el = doc.createElement("span");
  el.className = `rx ${r.tone}${r.burst ? " b" : ""}`;
  el.textContent = r.text;
  el.style.setProperty("--rxa", `rx-${r.anim}`); el.style.setProperty("--rxd", `${r.ms}ms`);
  if (mode === "reduced") el.style.animationName = "rx-fade"; // same as the reduced-motion rule, chosen by the Organizer
  layer.appendChild(el);
  setTimeout(() => el.remove(), r.ms + 100);
  return true;
}
