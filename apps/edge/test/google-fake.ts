// A stand-in for Google in tests: our own RSA key pair signs ID tokens, and the Worker is told to trust that public key instead of fetching Google's (setGoogleKeyProvider).
// Tests never call Google.
import { setGoogleKeyProvider, type Jwk } from "../src/google";

export const CLIENT_ID = "1234567890-testclient.apps.googleusercontent.com";
const enc = (o: unknown) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export interface Idp { kid: string; sign: (claims: Record<string, unknown>, head?: Record<string, unknown>) => Promise<string>; jwk: Jwk }

export async function makeIdp(kid = "fake-kid-1"): Promise<Idp> {
  const kp = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as Jwk;
  const jwk: Jwk = { kty: "RSA", kid, n: pub.n, e: pub.e, alg: "RS256", use: "sig" };
  const sign = async (claims: Record<string, unknown>, head: Record<string, unknown> = {}) => {
    const h = enc({ alg: "RS256", kid, typ: "JWT", ...head }), p = enc(claims);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(h + "." + p));
    return `${h}.${p}.${Buffer.from(sig).toString("base64url")}`;
  };
  return { kid, sign, jwk };
}
/** Trust this fake IdP's key (and no others) for the rest of the test. */
export const trust = (...idps: Idp[]) => setGoogleKeyProvider(async () => idps.map((i) => i.jwk));
/** The claims of a good token for `email`, valid around `nowMs`. */
export const claims = (email: string, nowMs: number, over: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1100", email, email_verified: true, iat: Math.floor(nowMs / 1000) - 5, exp: Math.floor(nowMs / 1000) + 3000, ...over,
});
