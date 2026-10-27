// The one place that knows what a console assertion looks like. The console signs with it, every game verifies with it (this file is copied byte for byte into each game).
// Format:  v1.<payload>.<signature>   payload = base64url(JSON), signature = base64url(Ed25519 over the text "cgv1." + payload)
// Only WebCrypto is used (same API in Cloudflare Workers, Bun and Node), so nothing else has to be installed in a game.

export type Act = "session" | "games" | "billing" | "invited" | "role" | "handoff" | "stepup" | "purge";
export interface Payload {
  v: 1;
  kid: string;
  aud: string; // the game's own origin, e.g. https://bingo.corporatetambola.com
  sub: string; // sha256('email|' + trimmed lowercase e-mail), hex
  em?: string; // plain e-mail: only when the console proves a mailbox to create an account or accept an invite
  act: Act;
  eid?: string;
  sa?: string; // for act 'stepup': the high-impact action this assertion allows
  hint?: string; // role the console believes the person has: a hint only, the game ignores it
  jti: string;
  iat: number; // seconds
  exp: number; // seconds
}

export const MAX_LIFE_S = 60;
export const SKEW_S = 30;
export const MAX_TOKEN_CHARS = 2048;
export type Verdict = { ok: true; payload: Payload } | { ok: false; error: "bad_assertion" | "expired" | "wrong_audience" | "unknown_kid" | "wrong_act" };

const te = new TextEncoder();
const td = new TextDecoder();
export const b64uEncode = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const b64uDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export async function signAssertion(payload: Payload, privateKey: CryptoKey): Promise<string> {
  const p = b64uEncode(te.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, te.encode("cgv1." + p)));
  return `v1.${p}.${b64uEncode(sig)}`;
}

/** CONSOLE_PUBKEYS is plain text: "k1:<base64url raw 32-byte public key>,k2:<...>". Bad entries are skipped, never guessed. */
export function parseKeyList(text: string | undefined | null): Array<{ kid: string; x: Uint8Array }> {
  const out: Array<{ kid: string; x: Uint8Array }> = [];
  for (const part of String(text ?? "").split(",")) {
    const m = /^\s*([a-z0-9]{1,12}):([A-Za-z0-9_-]{43})\s*$/.exec(part);
    if (!m) continue;
    try { const x = b64uDecode(m[2] as string); if (x.length === 32) out.push({ kid: m[1] as string, x }); } catch { /* skip */ }
  }
  return out;
}

export async function verifyAssertion(token: unknown, o: { keys: Array<{ kid: string; x: Uint8Array }>; aud: string; nowS: number; act?: Act }): Promise<Verdict> {
  if (typeof token !== "string" || token.length > MAX_TOKEN_CHARS) return { ok: false, error: "bad_assertion" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return { ok: false, error: "bad_assertion" };
  let payload: Payload;
  try { payload = JSON.parse(td.decode(b64uDecode(parts[1] as string))); } catch { return { ok: false, error: "bad_assertion" }; }
  if (!payload || typeof payload !== "object" || payload.v !== 1 || typeof payload.kid !== "string") return { ok: false, error: "bad_assertion" };
  const key = o.keys.find((k) => k.kid === payload.kid);
  if (!key) return { ok: false, error: "unknown_kid" };
  let good = false;
  try {
    const pub = await crypto.subtle.importKey("raw", key.x as unknown as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    good = await crypto.subtle.verify("Ed25519", pub, b64uDecode(parts[2] as string) as unknown as BufferSource, te.encode("cgv1." + (parts[1] as string)));
  } catch { good = false; }
  if (!good) return { ok: false, error: "bad_assertion" };
  // from here on the payload is authentic: check what it says
  if (payload.aud !== o.aud) return { ok: false, error: "wrong_audience" };
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp - payload.iat > MAX_LIFE_S || payload.exp < payload.iat) return { ok: false, error: "bad_assertion" };
  if (o.nowS > payload.exp + SKEW_S || payload.iat > o.nowS + SKEW_S) return { ok: false, error: "expired" };
  if (typeof payload.sub !== "string" || !/^[0-9a-f]{64}$/.test(payload.sub) || typeof payload.jti !== "string" || payload.jti.length < 16) return { ok: false, error: "bad_assertion" };
  if (o.act && payload.act !== o.act) return { ok: false, error: "wrong_act" };
  return { ok: true, payload };
}

/** the console's own helper for tests and for console-auth: a fresh Ed25519 key pair as { privateKey, publicRaw } */
export async function makeKeyPair(): Promise<{ privateKey: CryptoKey; publicRaw: Uint8Array; publicB64u: string }> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { privateKey: kp.privateKey, publicRaw, publicB64u: b64uEncode(publicRaw) };
}
