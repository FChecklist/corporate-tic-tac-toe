// 1.6.3 (security audit M-2 c, BOSS decision 24 Nov 2026): a small proof of work on the "no ID" request path (a person asks the organizer to let them in).
// Self-contained: no paid or outside service, no key, no secret and nothing stored. The phone has to find a number (a nonce) so that the SHA-256 of
//   pow1|<game>|<the phone's own random id>|<10-minute window>|<nonce>
// starts with a number of zero bits. The server checks it with one hash. A script that sends many requests has to do this work for every NEW phone id,
// while a real person pays about one second once. It is a speed bump, not a wall: the per-game limit of new requests (people.ts, worker.ts) is what stops a flood.
// The same text and the same count of zero bits are used by the page (apps/web/public/ttt.js, powSolve). A test pins the two together.

/** Zero bits asked normally, and when the game is already getting many new requests (about 65 thousand and 262 thousand hashes on average). */
export const POW_BITS = 16, POW_BITS_BUSY = 18, POW_BUSY_AFTER = 30;
/** The window a proof is good for: 10 minutes; the current and the one before are accepted. */
export const POW_WINDOW_MS = 600_000;
export const powWindow = (now: number): number => Math.floor(now / POW_WINDOW_MS);
const enc = new TextEncoder();
export const powText = (eid: string, device: string, win: number, nonce: string): string => `pow1|${eid}|${device}|${win}|${nonce}`;
export function zeroBits(h: Uint8Array): number {
  let n = 0;
  for (const b of h) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; }
  return n;
}
/** True when `proof` ({ b: window, n: nonce }) is a good proof for this game and this phone id at this time. */
export async function powValid(eid: string, device: unknown, proof: unknown, bits: number, now: number): Promise<boolean> {
  if (typeof device !== "string" || !proof || typeof proof !== "object") return false;
  const p = proof as { b?: unknown; n?: unknown }, win = Number(p.b), nonce = typeof p.n === "string" || typeof p.n === "number" ? String(p.n) : "";
  if (!Number.isInteger(win) || !/^[0-9a-z]{1,16}$/.test(nonce)) return false;
  const cur = powWindow(now);
  if (win !== cur && win !== cur - 1) return false;
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(powText(eid, device, win, nonce))));
  return zeroBits(h) >= bits;
}
