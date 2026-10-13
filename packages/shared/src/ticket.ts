/** The Bingo card, its patterns and the random helpers. The card itself lives in bingo-card.ts; "Ticket" is the card, kept as a name so the rest of the code reads the same. */
export * from "./bingo-card";
import type { Card } from "./bingo-card";

export type Ticket = Card;
