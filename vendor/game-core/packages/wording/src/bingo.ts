// Bingo message codes (Bingo site 1.3.x: apps/web/public/audio.js and beacon/config.ts). The shared claim lines come from index.ts via sayFor("Card", ...).
export const BINGO_HOUSE_NAMES: Record<string, string> = {
  line: "Line", twolines: "Two Lines", corners: "Four Corners", plus: "Plus", x: "X", frame: "Frame", stamp: "Postage Stamp", letterL: "Letter L", letterT: "Letter T", blackout: "Blackout",
};
export const BINGO_MSG: Record<string, string> = {
  "bingo.call": "Next number is {l} {n}.",
  "bingo.won": "Congratulations! Card {t} wins {h}.",
  "bingo.house.taken": "{h} has been won. It is no longer available.",
  "bingo.free": "FREE counts as marked.",
  "bingo.first": "The first number is called in 2 minutes.",
};
export const bingoSay = (code: string, vars: Record<string, string | number> = {}): string =>
  (BINGO_MSG[code] ?? "").replace(/\{(\w+)\}/g, (_, k) => String(k === "h" ? (BINGO_HOUSE_NAMES[String(vars[k])] ?? vars[k]) : (vars[k] ?? "")));
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const LETTER_WORDS = ["Bee", "Eye", "En", "Gee", "Oh"], LETTERS = ["B", "I", "N", "G", "O"];
const words = (n: number): string => (n < 20 ? ONES[n]! : TENS[Math.floor(n / 10)]! + (n % 10 ? "-" + ONES[n % 10] : ""));
const col = (n: number): number => Math.floor((n - 1) / 15);
/** "G 52" (or the plain number when outside 1-75). */
export const callLabel = (n: number): string => (n >= 1 && n <= 75 ? `${LETTERS[col(n)]} ${n}` : String(n));
/** The voice line. G 52 -> "Next number is Gee, five two, fifty-two. Gee, fifty-two."  B 7 -> "Next number is Bee, seven. Bee, seven." */
export function spokenCall(n: number): string {
  const l = LETTER_WORDS[col(n)]!, digits = String(n).split("").map((d) => ONES[+d]).join(" ");
  return n < 10 ? `Next number is ${l}, ${words(n)}. ${l}, ${words(n)}.` : `Next number is ${l}, ${digits}, ${words(n)}. ${l}, ${words(n)}.`;
}
