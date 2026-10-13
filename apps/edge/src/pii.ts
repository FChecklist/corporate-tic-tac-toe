// Encryption of personal data at rest. A participant's name and mobile number are never stored in the clear: they are sealed with AES-256-GCM,
// under a key derived (HKDF-SHA-256) from a secret that lives only in the Worker's environment (DATA_KEY), never in the database or the code.
// A copy of the database (a backup, an export, a leaked token) therefore holds only ciphertext. Every record has its own random nonce, and the
// format is versioned ("v1.") so the key can be rotated. The same sealing is used for the temporary pieces of an engagement report.
export interface PiiEnv { DATA_KEY?: string; ORGANIZER_SECRET?: string }
export interface Pii { phone: string; name: string | null }

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const AAD = enc.encode("corporate-tic-tac-toe/pii/v1");

const keys = new Map<string, Promise<CryptoKey>>();
/** The data key. DATA_KEY is the real secret; the fallback (derived from the organizer secret) only exists so a deployment that forgot to set it still never stores plain text. */
function keyFor(env: PiiEnv): Promise<CryptoKey> {
  const secret = env.DATA_KEY ? "k|" + env.DATA_KEY : env.ORGANIZER_SECRET ? "fallback|" + env.ORGANIZER_SECRET : "";
  if (!secret) return Promise.reject(new Error("no data key configured"));
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]).then((base) =>
      crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc.encode("corporate-tic-tac-toe/salt/v1"), info: enc.encode("pii-aes-256-gcm") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
    if (keys.size > 8) keys.clear();
    keys.set(secret, k);
  }
  return k;
}

/** Seals any text. The result looks like "v1.<nonce>.<ciphertext>" and is safe to store. */
export async function sealText(env: PiiEnv, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, await keyFor(env), enc.encode(text)));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
/** Opens a sealed text; null when it was tampered with, sealed under another key, or is not ours. */
export async function openText(env: PiiEnv, sealed: string | null | undefined): Promise<string | null> {
  if (!sealed) return null;
  const p = sealed.split(".");
  if (p.length !== 3 || p[0] !== "v1") return null;
  try { return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(p[1]!), additionalData: AAD }, await keyFor(env), unb64(p[2]!))); } catch { return null; }
}
export const sealPii = (env: PiiEnv, p: Pii) => sealText(env, JSON.stringify({ p: p.phone, n: p.name }));
export async function openPii(env: PiiEnv, sealed: string | null | undefined): Promise<Pii | null> {
  const t = await openText(env, sealed);
  if (t === null) return null;
  try { const o = JSON.parse(t); return { phone: String(o.p ?? ""), name: o.n == null ? null : String(o.n) }; } catch { return null; }
}

// ------------------------------------------------------------------------------------------------ per-engagement participant key (crypto-shredding)
// Personal details of an engagement's PARTICIPANTS in the audit log are sealed under a key of their own: HKDF(DATA_KEY, salt = a random 32-byte value made for that engagement and kept
// in `eng_key`, info = "participant/<engagement id>"). Destroying the salt (and the sealed blobs) makes those details unrecoverable even for someone who holds DATA_KEY, because the
// key can no longer be derived. Deriving from DATA_KEY + id alone would NOT be shreddable (DATA_KEY lives as long as the platform), which is why a stored random salt is used.
const secretOf = (env: PiiEnv) => (env.DATA_KEY ? "k|" + env.DATA_KEY : env.ORGANIZER_SECRET ? "fallback|" + env.ORGANIZER_SECRET : "");
async function engKey(env: PiiEnv, eid: string, saltHex: string): Promise<CryptoKey> {
  const secret = secretOf(env);
  if (!secret) throw new Error("no data key configured");
  const salt = Uint8Array.from(saltHex.match(/../g) ?? [], (h) => parseInt(h, 16));
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("participant/" + eid) }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const engAad = (eid: string) => enc.encode("corporate-tic-tac-toe/participant/v1/" + eid);
/** Seals text under an engagement's participant key. Format "e1.<nonce>.<ciphertext>". */
export async function sealEng(env: PiiEnv, eid: string, saltHex: string, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: engAad(eid) }, await engKey(env, eid, saltHex), enc.encode(text)));
  return `e1.${b64(iv)}.${b64(ct)}`;
}
/** Opens text sealed by `sealEng`; null when the salt is gone (shredded), the blob was altered, or it is not ours. */
export async function openEng(env: PiiEnv, eid: string, saltHex: string | null | undefined, sealed: string | null | undefined): Promise<string | null> {
  if (!sealed || !saltHex) return null;
  const p = sealed.split(".");
  if (p.length !== 3 || p[0] !== "e1") return null;
  try { return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(p[1]!), additionalData: engAad(eid) }, await engKey(env, eid, saltHex), unb64(p[2]!))); } catch { return null; }
}
