// Prize plan shared by all games (Tambola 1.9.0): Auto plans from a budget, Manual sets each prize. Manual never changes who won; it only sets the prize per position and delivery notes.
import type { PrizeMode } from "../../manifest/src";
export interface PrizeLine { position: string; label: string; amount?: number; note?: string }
export interface PrizePlan { mode: PrizeMode; currency: string; budget?: number; count?: number; prizes: PrizeLine[] }
export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"];
export const MAX_MANUAL_PRIZES = 30;
export const planOk = (p: PrizePlan): string | null => (!p.prizes.length ? "Add at least one prize." : p.prizes.length > MAX_MANUAL_PRIZES ? "Too many prizes." : null);
/** Tied winners split equally, floored; the leftover stays with the Organizer (Tambola ties: "share"). */
export const splitTie = (amount: number, winners: number): { each: number; left: number } => {
  const each = Math.floor(amount / winners);
  return { each, left: amount - each * winners };
};

export interface Winner { position: string; player: string }
/** Manual prizes never change who won: the winners come back exactly as given; each is only paired with the prize line and note for its position. */
export const applyManualPrizes = (winners: Winner[], plan: PrizePlan): { winners: Winner[]; awards: (Winner & { prize?: PrizeLine })[] } => ({
  winners,
  awards: winners.map((w) => ({ ...w, prize: plan.prizes.find((p) => p.position === w.position) })),
});
