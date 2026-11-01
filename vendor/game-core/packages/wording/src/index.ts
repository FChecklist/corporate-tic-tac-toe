// Plain-words messages shared by every game, extracted from Tambola 1.9.0 (packages/beacon/src/messages.ts and the organizer flow). English only; "close group", never "private".
/** The ONE on-screen retention line (owner, 31 Oct 2026). */
import { NO_PERSONAL_DETAILS, TERMS_RETENTION, ID_ONLY_LINE, DETAILS_LINE, AUTO_DELETE_LINE } from "./lines";
export { NO_PERSONAL_DETAILS, TERMS_RETENTION, ID_ONLY_LINE, DETAILS_LINE, AUTO_DELETE_LINE };
export * from "./legal";
export * from "./documents";
export * from "./consent";
export const RETENTION_LINE = NO_PERSONAL_DETAILS;
export const DATA_SENTENCES: string[] = [NO_PERSONAL_DETAILS, TERMS_RETENTION, ID_ONLY_LINE, DETAILS_LINE, AUTO_DELETE_LINE];
/** Words that must not appear in a data or privacy sentence: first person (we, our, us), harsh or legal-sounding words, and any mention of a name or a mobile number (say "participant details" or "participant data"). */
export const DATA_TEXT_BANNED: RegExp[] = [/\b(we|our|ours|us|i|my)\b/i, /\b(breach|liable|liability|penalt(y|ies)|violat\w*|illegal|unlawful|prosecut\w*|sue|sued|fraud|forbidden|terminate[ds]?|warning|risk|danger\w*|threat\w*)\b/i, /\b(names?|mobiles?|phones?|numbers?)\b/i];
export const dataTextOk = (text: string): boolean => guardOk(text) && !DATA_TEXT_BANNED.some((r) => r.test(text));
/** Messages by code, with {t} ticket/entry, {p} prize, {n} a count. A game adds its own codes; the shared ones are the same everywhere. */
export const MSG: Record<string, string> = {
  "claim.k": "Ticket {t} has claimed {p}. Checking now…",
  "claim.w": "Ticket {t}'s claim was not correct. The game continues.",
  "claim.a": "Ticket {t}'s claim is correct. Congratulations Ticket {t} on winning {p}! \u{1F389} The game continues.",
  "claim.a2": "A claim for {p} is correct. The game continues.",
  "claim.g": "{p} has been won. It is no longer available.",
  "won": "You won {p}. Tap to open your prize card.",
  "out": "You are out.",
  "over": "Game over.",
  "paused": "Paused",
  "resumed": "The game continues.",
  "wait": "Waiting for the Organizer to let you in.",
  "full": "This game is full.",
  "notopen": "This game is not open yet.",
  "seated": "This ID already has a seat in this game.",
  "net.reconnecting": "Reconnecting…",
  "net.back": "Back online.",
  "generic": "Something changed in the game.",
};
export const say = (code: string, vars: Record<string, string | number> = {}): string =>
  (MSG[code] ?? MSG["generic"]!).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
/** Wording guard (Tambola wording-guard.test.ts): words that never appear in anything a player reads. */
/** Words that never appear in customer text. "erase" in any form is out: say "auto-deleted" when the system deletes by timer and "deleted" when a person deletes. */
export const BANNED_PLAYER_WORDS: RegExp[] = [/\bengagements?\b/i, /\bprivate\b/i, /\bera(se|sed|ses|sing|sure)\b/i];
export const GROUP_WORD = "close group";
export const guardOk = (text: string): boolean => !BANNED_PLAYER_WORDS.some((r) => r.test(text));

/** What a game calls a player's piece: Tambola "Ticket", Bingo "Card", other games "Entry". The shared claim lines are written with "Ticket"; sayFor swaps the noun. */
export type Noun = "Ticket" | "Card" | "Entry";
export const sayFor = (noun: Noun, code: string, vars: Record<string, string | number> = {}): string => say(code, vars).replace(/\bTicket\b/g, noun).replace(/\bTicket's\b/g, `${noun}'s`);
export { BINGO_MSG, BINGO_HOUSE_NAMES, spokenCall, callLabel, bingoSay } from "./bingo";
