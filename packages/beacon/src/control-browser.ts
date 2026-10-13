// Organizer-side browser helper (bundled to apps/web/public/control.js, exposes window.TBControl).
// Holds the engagement's signing key in IndexedDB as a NON-EXTRACTABLE CryptoKey: the page can sign, nothing can read the key out.
// Built with: bun run build:control   (not covered by unit tests: needs a browser; the signing and publishing logic it calls is).
import { generateOrganizerKey, nextMessage, signControl, type ControlAction, type PublishedFile } from "./control";

const DB = "bingo-control";
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const get = async (k: string): Promise<{ privateKey: CryptoKey; publicKeyHex: string } | undefined> => { const d = await idb(); return new Promise((res, rej) => { const q = d.transaction("keys").objectStore("keys").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); };
const put = async (k: string, v: unknown) => { const d = await idb(); return new Promise<void>((res, rej) => { const q = d.transaction("keys", "readwrite").objectStore("keys").put(v, k); q.onsuccess = () => res(); q.onerror = () => rej(q.error); }); };

const MIRRORS = ["https://api.drand.sh", "https://api2.drand.sh", "https://api3.drand.sh", "https://drand.cloudflare.com"];
const CHAIN = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
const GENESIS = 1692803367;
/** Current beacon round. Only used to stamp a message; a wrong value can hurt only this organizer's own game, never forge anything. */
async function beaconRound(): Promise<number> {
  for (const m of MIRRORS) {
    try { const r = await fetch(`${m}/${CHAIN}/public/latest`); if (r.ok) { const j = await r.json(); if (Number.isInteger(j.round)) return j.round; } } catch { /* next mirror */ }
  }
  return Math.floor((Date.now() / 1000 - GENESIS) / 3) + 1;
}

type Auth = { token: string; base?: string; prefix?: string };
const P = (a: Auth) => `${a.base ?? ""}${a.prefix ?? "/api/e"}`;
const hdr = (a: Auth) => ({ "content-type": "application/json", authorization: `Bearer ${a.token}` });

const TBControl = {
  /** Make sure this engagement has a key registered. Call once while the engagement is still open. Returns false if this browser lacks the key. */
  async ensureKey(code: string, a: Auth, profile: "standard" | "fast" = "standard"): Promise<{ ok: boolean; created?: boolean; reason?: string }> {
    const base = a.base ?? "";
    const pub = await (await fetch(`${P(a)}/${code}/control`)).json().catch(() => null);
    const mine = await get(code);
    if (pub?.pubKey) return mine && mine.publicKeyHex === pub.pubKey ? { ok: true } : { ok: false, reason: "This engagement's signing key lives in another browser." };
    const k = await generateOrganizerKey(false);
    const r = await fetch(`${P(a)}/${code}/control/key`, { method: "PUT", headers: hdr(a), body: JSON.stringify({ publicKey: k.publicKeyHex, profile }) });
    if (!r.ok) return { ok: false, reason: (await r.json().catch(() => ({}))).error ?? "Could not register the key." };
    await put(code, k);
    return { ok: true, created: true };
  },
  /** Build, sign and return the next control message (does not publish it). */
  async sign(code: string, a: Auth, action: ControlAction, o: { pauseForRounds?: number; untilRound?: number; addRounds?: number } = {}) {
    const base = a.base ?? "";
    const f = (await (await fetch(`${P(a)}/${code}/control`, { cache: "no-store" })).json()) as PublishedFile;
    const k = await get(code);
    if (!k || k.publicKeyHex !== f.pubKey) throw new Error("This browser does not hold the signing key for this engagement.");
    return signControl(k.privateKey, nextMessage(f, await beaconRound(), { action, ...o }));
  },
  /** Sign and publish in one step (what the console's Pause / Resume buttons call). */
  async publish(code: string, a: Auth, action: ControlAction, o: { pauseForRounds?: number; untilRound?: number; addRounds?: number } = {}) {
    const message = await TBControl.sign(code, a, action, o);
    const r = await fetch(`${P(a)}/${code}/control`, { method: "POST", headers: hdr(a), body: JSON.stringify({ message }) });
    return { status: r.status, data: await r.json().catch(() => ({})), message };
  },
};
(globalThis as any).TBControl = TBControl;
