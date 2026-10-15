// Mail to the owner of the platform (not to the organizer): a note on every paid order (E9) and on every player data request (U6/D7).
// TEST mode drops mail to everybody except the owner's allow-list (mode.ts); these notes go to the owner anyway (sendMail's `owner` option), so the owner sees what a test game does.
// The address is one constant here; a deployment can override it with OWNER_NOTIFY_EMAIL. This file imports nothing from pay.ts, so there is no import cycle.
import type { D1 } from "./worker";

export const OWNER_NOTIFY_EMAIL = "hello@corporatetambola.com";
export const ownerAddress = (env: object): string => { const v = (env as { OWNER_NOTIFY_EMAIL?: string }).OWNER_NOTIFY_EMAIL; return v && v.includes("@") ? v.trim() : OWNER_NOTIFY_EMAIL; };

export interface PaidOrder { gameLabel: string; paymentId: string; txnId: string; planLabel: string; amountText: string; organizerName: string; organizerEmail: string; eid?: string | null; test?: boolean }

/**
 * E9: "a payment was verified as paid" - a short note to the owner, ONCE per payment. The claim is one row in kv (`ownerpaid/<payment id>`) taken with INSERT OR IGNORE,
 * so the webhook and the verify path (and a repeat of either) can never send it twice. `send(subject, text)` delivers to the owner's address.
 */
export async function notifyOwnerOfPaidOrder(send: (subject: string, text: string) => Promise<boolean>, db: D1, o: PaidOrder, now: number): Promise<boolean> {
  const claim = await db.prepare("INSERT OR IGNORE INTO kv(k,v) VALUES(?,?)").bind(`ownerpaid/${o.paymentId}`, String(now)).run();
  if ((claim.meta?.changes ?? 0) === 0) return false; // already told
  const text = [
    `A paid order arrived on ${o.gameLabel}${o.test ? " (TEST mode)" : ""}.`, "",
    `Game: ${o.gameLabel}`, `Plan: ${o.planLabel}`, `Amount: ${o.amountText}`, `Transaction: ${o.txnId}`,
    `Organizer: ${o.organizerName || "(no name given)"} <${o.organizerEmail}>`, ...(o.eid ? [`Engagement: ${o.eid}`] : []),
  ].join("\n");
  try { return await send(`Paid order: ${o.gameLabel}, ${o.planLabel}, ${o.amountText}`, text); } catch { return false; }
}
