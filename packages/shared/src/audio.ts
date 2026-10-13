/**
 * Spoken text for the one fixed voice. A call is a letter and a number, said twice, the second time digit by digit for two-digit numbers:
 *   52 (G) -> "Gee, fifty-two. Gee, five two."
 *    7 (B) -> "Bee, seven. Bee, seven."   (single digits are not spelled out again)
 * The browser's own speech voice is used (no audio files ship with the app).
 */
import { MAX_NUMBER, columnOf } from "./bingo-card";

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
/** The letters as a speech voice reads them best. */
export const LETTER_WORDS = ["Bee", "Eye", "En", "Gee", "Oh"] as const;

export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > MAX_NUMBER) throw new RangeError(`number must be 1..${MAX_NUMBER}`);
  if (n < 20) return ONES[n]!;
  const t = Math.floor(n / 10), o = n % 10;
  return o === 0 ? TENS[t]! : `${TENS[t]}-${ONES[o]}`;
}

export const numberDigits = (n: number): string => String(n).split("").map((d) => ONES[Number(d)]).join(" ");

export function spokenPhrase(n: number): string {
  const w = numberWords(n), l = LETTER_WORDS[columnOf(n)]!;
  if (n < 10) return `${l}, ${w}. ${l}, ${w}.`;
  return `${l}, ${w}. ${l}, ${numberDigits(n)}.`;
}

/** Version of the voice wording; bump when it changes so devices that cached a voice line refresh it. */
export const AUDIO_PACK_VERSION = "v1-en-us-speech";
