// The sealed seed. Every random choice in a tournament (the bracket, who has X, the move put in for a player whose clock ran out, fate) comes from ONE seed that nobody can pick or see in advance.
//
//   1. When the tournament is made the server draws a secret and publishes only its fingerprint (the commit). Nothing about the bracket can be known from a fingerprint.
//   2. When the host starts, the roster is closed and the seed is made from: the secret, the tournament id, the closed roster, and (if given) a public beacon value.
//   3. The secret is then revealed, so anyone can check the fingerprint and re-compute the bracket, every starter and every fate number.
// The browser never holds the secret and sends nothing that goes into the seed. Honest limit: the server draws the secret, so it is trusted to draw it fairly and not to look; the beacon value
// (a public number the organizer's console can add at the start) removes even that, because the server cannot know it before the start.
import { sha256Hex } from "./hash";

export const newSecret = (): string => { const b = crypto.getRandomValues(new Uint8Array(32)); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); };
export const commitOf = (secret: string): Promise<string> => sha256Hex(`TTT-COMMIT|${secret}`);
export const rosterHash = (pids: readonly string[]): Promise<string> => sha256Hex(`TTT-ROSTER|${[...pids].sort().join(",")}`);
export const seedOf = async (secret: string, eid: string, pids: readonly string[], beacon = ""): Promise<string> => sha256Hex(`TTT-SEED|${secret}|${eid}|${await rosterHash(pids)}|${beacon}`);
export const verifyReveal = async (secret: string, commit: string): Promise<boolean> => (await commitOf(secret)) === commit;
