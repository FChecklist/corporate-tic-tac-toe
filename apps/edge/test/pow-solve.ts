// Test helper: finds the number the Worker asks for on the "no ID" request path (src/pow.ts). The page does the same in ttt.js (powSolve); this one uses the fast native hash so a test that asks for hundreds of proofs stays quick.
import { createHash } from "node:crypto";
import { powText, zeroBits } from "../src/pow";

export async function powSolve(eid: string, device: string, win: number, bits: number): Promise<string> {
  for (let i = 0; ; i++) {
    const nonce = i.toString(36);
    if (zeroBits(createHash("sha256").update(powText(eid, device, win, nonce)).digest()) >= bits) return nonce;
  }
}
