// The fake public randomness beacon (drand "quicknet" stand-in), deterministic per round and seed, importable from node and bun.
// Real BLS signatures cannot be forged, so the fake has two halves:
//   * the DATA: round r -> { round, signature, randomness } with randomness = sha256(signature) (the one structural check verifyRound does before the BLS check);
//   * the TRUST: browsers load a COPY of the bundles (zgame.js, control.js ...) whose BLS check is replaced by "true" (patchBundle, served through a Playwright route, the files on disk are
//     never changed); the bun phone-runtime gets `verify` injected (fakeVerify). Nothing here touches production code.
import { createHash } from "node:crypto";
export const GENESIS = 1692803367, PERIOD = 3;
export const CHAIN = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"; // quicknet chain hash (as in packages/beacon/src/index.ts QUICKNET)
export const roundAt = (ms) => Math.floor((ms / 1000 - GENESIS) / PERIOD) + 1;
export const roundTimeMs = (r) => (GENESIS + (r - 1) * PERIOD) * 1000;
const sha = (b) => createHash("sha256").update(b).digest();
export function fakeRound(r, seed = "sim") {
  const s = Buffer.concat([sha(`${seed}|a|${r}`), sha(`${seed}|b|${r}`)]).subarray(0, 48);
  return { round: r, signature: s.toString("hex"), randomness: sha(s).toString("hex") };
}
/** the `verify` hook for PhoneRuntime deps (bun phones): accepts exactly this seed's rounds */
export const fakeVerify = (seed = "sim") => (x) => { const f = fakeRound(x.round, seed); return x.signature === f.signature && x.randomness === f.randomness; };
/** Randomness of a round for reference computations (what the real beacon would have said). */
export const randomnessOf = (r, seed = "sim") => fakeRound(r, seed).randomness;
/** A Fetcher for the bun phone-runtime: `nowMs()` is the simulated UTC time. Rounds in the future are 404 like the real network. */
export const fakeFetcher = (nowMs, seed = "sim") => async (url) => {
  const last = url.split("/").pop(); const nr = roundAt(nowMs());
  const r = last === "latest" ? nr : Number(last);
  if (!Number.isInteger(r) || r > nr || r < 1) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => fakeRound(r, seed) };
};
/** Turns a shipped bundle's BLS verification into "accept". Returns the patched text and how many call sites were replaced. */
export function patchBundle(text) {
  let n = 0;
  const out = text.replace(/[\w$]+\.shortSignatures\.verify\(/g, () => { n++; return "(function(){return!0})("; });
  return { text: out, replaced: n };
}
/**
 * Playwright: make a browser context use the fake beacon. `nowMs()` = simulated UTC. Intercepts every drand mirror and re-serves the bundles that verify rounds (patched copy).
 * Returns { patched: { file: count } } filled as bundles load, so a scenario can assert the patch really applied.
 */
export async function routeBeacon(ctx, { nowMs, seed = "sim", base }) {
  const patched = {};
  await ctx.route(/^https:\/\/(api|api2|api3)\.drand\.sh\/|^https:\/\/drand\.cloudflare\.com\//, async (route) => {
    const last = route.request().url().split("/").pop(); const nr = roundAt(nowMs());
    const r = last === "latest" ? nr : Number(last);
    if (!Number.isInteger(r) || r > nr || r < 1) return route.fulfill({ status: 404, body: "{}", headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
    return route.fulfill({ status: 200, body: JSON.stringify(fakeRound(r, seed)), headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
  });
  await ctx.route(/\/(zgame|control|z|big|zc|report|preview)\.js(\?.*)?$/, async (route) => {
    const resp = await route.fetch();
    let body = await resp.text(); const name = new URL(route.request().url()).pathname.slice(1);
    if (/shortSignatures\.verify\(/.test(body)) { const p = patchBundle(body); body = p.text; patched[name] = p.replaced; }
    return route.fulfill({ response: resp, body, headers: { ...resp.headers(), "content-length": String(Buffer.byteLength(body)) } });
  });
  return { patched };
}
