// "Continue with Google" (Phase 4, docs/ROLES_AND_CONSOLE_SPEC_4.md section C). This file only PROVES who a Google ID token belongs to; what happens next
// (sign in, sign up, Host first open) is decided in worker.ts / hostsetup.ts and is exactly what the e-mail code does.
//
// What is checked, with Web Crypto only (no library): the RS256 signature against Google's published keys (https://www.googleapis.com/oauth2/v3/certs,
// cached for an hour, refetched at most every 5 minutes when an unknown key id appears), `iss` is Google, `aud` is OUR client id, `exp` has not passed,
// `iat` is not in the future, and `email_verified` is true. We read the e-mail address and nothing else: no name, no picture, no Google account id is kept.
// Tests never call Google: they install a fake key set with setGoogleKeyProvider().

export interface GoogleEnv { GOOGLE_CLIENT_ID?: string }
export interface Jwk { kty: string; kid?: string; n: string; e: string; alg?: string; use?: string }

export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const KEY_TTL_MS = 3_600_000, REFETCH_MIN_MS = 300_000, SKEW_MS = 60_000;

/** The public client id (it is not a secret), or null when Google sign-in is not set up. */
export const googleClientId = (env: GoogleEnv): string | null => {
  const v = (env.GOOGLE_CLIENT_ID ?? "").trim();
  return /^[A-Za-z0-9._-]{10,200}$/.test(v) ? v : null;
};

type KeyProvider = () => Promise<Jwk[]>;
const defaultProvider: KeyProvider = async () => {
  const r = await fetch(GOOGLE_CERTS_URL);
  if (!r.ok) throw new Error("certs " + r.status);
  const j = (await r.json()) as { keys?: Jwk[] };
  return Array.isArray(j.keys) ? j.keys : [];
};
let provider: KeyProvider = defaultProvider;
let cache: { keys: Jwk[]; at: number } | null = null;
/** Tests only: replaces the place the signing keys come from (and forgets what was cached). Call with no argument to go back to Google. */
export function setGoogleKeyProvider(p?: KeyProvider): void { provider = p ?? defaultProvider; cache = null; }

async function keyFor(kid: string, now: number): Promise<Jwk | null> {
  const find = () => cache?.keys.find((k) => k.kid === kid && k.kty === "RSA") ?? null;
  if (cache && now - cache.at < KEY_TTL_MS) { const k = find(); if (k) return k; if (now - cache.at < REFETCH_MIN_MS) return null; }
  try { const keys = await provider(); cache = { keys, at: now }; } catch { /* keep the old copy; an unknown key then simply fails */ }
  return find();
}

const b64u = (s: string): Uint8Array<ArrayBuffer> => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/"), pad = t + "=".repeat((4 - (t.length % 4)) % 4), raw = atob(pad);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
};
const jsonPart = (s: string): any => JSON.parse(new TextDecoder().decode(b64u(s)));
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export type GoogleResult = { ok: true; email: string } | { ok: false; why: "config" | "format" | "key" | "signature" | "claims" | "expired" | "unverified" };

/** Verifies a Google ID token ("credential") for our client id. Never throws. */
export async function verifyGoogleCredential(env: GoogleEnv, credential: unknown, now: number): Promise<GoogleResult> {
  const clientId = googleClientId(env);
  if (!clientId) return { ok: false, why: "config" };
  if (typeof credential !== "string" || credential.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(credential)) return { ok: false, why: "format" };
  try {
    const [h, p, s] = credential.split(".") as [string, string, string];
    const head = jsonPart(h);
    if (head?.alg !== "RS256" || typeof head.kid !== "string") return { ok: false, why: "format" }; // only the algorithm Google uses; "none" and HS256 are refused
    const jwk = await keyFor(head.kid, now);
    if (!jwk) return { ok: false, why: "key" };
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(s), new TextEncoder().encode(h + "." + p));
    if (!good) return { ok: false, why: "signature" };
    const c = jsonPart(p);
    if (!ISSUERS.has(c?.iss) || c?.aud !== clientId) return { ok: false, why: "claims" };
    if (typeof c.exp !== "number" || c.exp * 1000 <= now) return { ok: false, why: "expired" };
    if (typeof c.iat === "number" && c.iat * 1000 > now + SKEW_MS) return { ok: false, why: "claims" };
    if (c.email_verified !== true && c.email_verified !== "true") return { ok: false, why: "unverified" };
    const email = typeof c.email === "string" ? cleanEmail(c.email) : "";
    if (!EMAIL_RE.test(email)) return { ok: false, why: "claims" };
    return { ok: true, email };
  } catch { return { ok: false, why: "format" }; }
}
