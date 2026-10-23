// Public randomness beacon (drand "quicknet") client + the deterministic call generator.
//
// Why this exists: every phone derives the engagement's calls by itself from public, signed,
// unpredictable randomness, so the engagement needs no game server and no phone clock.
// Time is the beacon's own UTC schedule: round r is published at GENESIS + (r-1) * 3 seconds.
import { bls12_381 } from "@noble/curves/bls12-381";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export const QUICKNET = {
  chainHash: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  // Scheme bls-unchained-g1-rfc9380: signature on G1 (48 bytes), public key on G2 (96 bytes).
  publicKey:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  genesisSec: 1692803367, // 2023-08-23T15:09:27Z
  periodSec: 3,
  mirrors: [
    "https://api.drand.sh",
    "https://api2.drand.sh",
    "https://api3.drand.sh",
    "https://drand.cloudflare.com",
  ],
} as const;

const DST = "BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_";

export type Round = { round: number; signature: string; randomness: string };

/** UTC milliseconds at which a round is published. */
export const roundTimeMs = (r: number, net = QUICKNET): number => (net.genesisSec + (r - 1) * net.periodSec) * 1000;
/** The latest round that exists at a given UTC time. */
export const roundAt = (utcMs: number, net = QUICKNET): number =>
  Math.floor((utcMs / 1000 - net.genesisSec) / net.periodSec) + 1;

const roundBytes = (r: number): Uint8Array => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(r));
  return b;
};

/** True only when the signature is a genuine beacon signature for that round. Mirrors are untrusted; this is what makes them safe. */
export function verifyRound(x: Round, net = QUICKNET): boolean {
  try {
    if (!Number.isInteger(x.round) || x.round < 1) return false;
    const sig = hexToBytes(x.signature);
    // randomness must be sha256(signature)
    if (bytesToHex(sha256(sig)) !== x.randomness) return false;
    const msg = bls12_381.shortSignatures.hash(sha256(roundBytes(x.round)), DST);
    return bls12_381.shortSignatures.verify(sig, msg, hexToBytes(net.publicKey));
  } catch {
    return false;
  }
}

export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface BeaconOpts {
  net?: typeof QUICKNET;
  mirrors?: readonly string[];
  fetcher?: Fetcher;
  timeoutMs?: number;
  /** Milliseconds before the next mirror is asked as well (default 1200). */
  hedgeMs?: number;
  /** Test hook only; production always uses the real signature check. */
  verify?: (x: Round, net: typeof QUICKNET) => boolean;
}

/** Fetches one round, trying mirrors in turn (rotated by `salt` so phones spread across mirrors). Only a signature-verified round is returned. */
export async function fetchRound(r: number | "latest", opts: BeaconOpts = {}, salt = 0): Promise<Round | null> {
  const net = opts.net ?? QUICKNET;
  const mirrors = opts.mirrors ?? net.mirrors;
  const f = opts.fetcher ?? (fetch as unknown as Fetcher);
  // Hedged: the first mirror is asked at once; if it has not answered within HEDGE_MS (or has failed) the next one is asked too, and the first VALID answer wins. A mirror that hangs therefore
  // delays a number by about a second, not by its whole timeout (a number that arrives 5 seconds late and is followed by one a second later looks like "the numbers are going fast").
  const HEDGE_MS = opts.hedgeMs ?? 1200;
  return new Promise<Round | null>((resolve) => {
    let launched = 0, finished = 0, won = false;
    const ctls: AbortController[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (x: Round | null) => { if (won) return; won = true; timers.forEach(clearTimeout); ctls.forEach((c) => { try { c.abort(); } catch { /* already done */ } }); resolve(x); };
    const launch = () => {
      if (won || launched >= mirrors.length) return;
      const m = mirrors[(launched + salt) % mirrors.length]!; launched++;
      const ctl = new AbortController(); ctls.push(ctl);
      const ms = opts.timeoutMs ?? 6000;
      let to: ReturnType<typeof setTimeout> | undefined;
      // A mirror that hangs (or a fetcher that ignores the abort signal) must never stall the phone.
      Promise.race([
        f(`${m}/${net.chainHash}/public/${r}`, { signal: ctl.signal }),
        new Promise<never>((_, rej) => { to = setTimeout(() => { ctl.abort(); rej(new Error("timeout")); }, ms); }),
      ]).finally(() => clearTimeout(to)).then(async (res) => {
        if (!res.ok) return null; // 404 = not published yet (or a bad mirror): try the next
        const x = (await res.json()) as Round;
        return (opts.verify ?? verifyRound)(x, net) && (r === "latest" || x.round === r) ? x : null;
      }).catch(() => null /* blocked, offline or slow mirror: move on */).then((x) => {
        finished++;
        if (x) return finish(x);
        if (finished >= mirrors.length) return finish(null);
        launch(); // this one failed: ask the next at once
      });
      if (launched < mirrors.length) timers.push(setTimeout(launch, HEDGE_MS));
    };
    launch();
  });
}

/** Phone-independent UTC: the newest verified round proves the real time is at least its publish time (and under 3 s after it). */
export async function utcNow(opts: BeaconOpts = {}, salt = 0): Promise<{ utcMs: number; round: number } | null> {
  const x = await fetchRound("latest", opts, salt);
  return x ? { utcMs: roundTimeMs(x.round, opts.net) + ((opts.net ?? QUICKNET).periodSec * 1000) / 2, round: x.round } : null;
}

/* ---------------- Deterministic calls ---------------- */

export const NUMBERS = 75;

/** Rounds used by each call: call k uses round startRound + k * stride. Call speeds must be multiples of the 3 s round. */
export function scheduleFor(startRound: number, callSeconds: number, count = NUMBERS, net = QUICKNET): number[] {
  if (!Number.isInteger(callSeconds) || callSeconds % net.periodSec !== 0 || callSeconds < net.periodSec * 2)
    throw new Error(`Call speed must be a multiple of ${net.periodSec} seconds, at least ${net.periodSec * 2}.`);
  const stride = callSeconds / net.periodSec;
  return Array.from({ length: count }, (_, k) => startRound + k * stride);
}

const u8 = (n: number) => String(n);

/**
 * Number for call k, given the numbers already called and the verified randomness of the round assigned to call k.
 * Nothing about call k can be known before that round is published; everything about it can be re-checked afterwards.
 */
export function pickNumber(engagementId: string, k: number, randomnessHex: string, called: readonly number[]): number {
  const taken = new Set(called);
  const remaining: number[] = [];
  for (let n = 1; n <= NUMBERS; n++) if (!taken.has(n)) remaining.push(n);
  if (remaining.length === 0) throw new Error("All 75 numbers have been called.");
  const h = sha256(utf8ToBytes(`CB1|${engagementId}|${u8(k)}|${randomnessHex}`));
  let v = 0n;
  for (const b of h) v = (v << 8n) | BigInt(b);
  return remaining[Number(v % BigInt(remaining.length))]!;
}

/** The full call log so far, from the verified rounds for calls 0..n-1 (all rounds must be supplied and verified by the caller). */
export function deriveCalls(engagementId: string, randomness: readonly string[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < randomness.length; k++) out.push(pickNumber(engagementId, k, randomness[k]!, out));
  return out;
}

/** A phone's way of reaching the same log: fetch every scheduled round up to `upto` (in parallel, mirrors rotated), verify, derive. */
export async function syncCalls(
  engagementId: string,
  schedule: readonly number[],
  upto: number,
  opts: BeaconOpts = {},
  salt = 0,
): Promise<{ calls: number[]; missing: number[] }> {
  const rs = await Promise.all(schedule.slice(0, upto).map((r, i) => fetchRound(r, opts, salt + i)));
  const have: string[] = [];
  const missing: number[] = [];
  for (let i = 0; i < rs.length; i++) {
    const x = rs[i];
    if (!x) { missing.push(schedule[i]!); break; } // the log can only grow from the first gap
    have.push(x.randomness);
  }
  return { calls: deriveCalls(engagementId, have), missing };
}

/* ---------------- Deterministic tickets ---------------- */

/** A repeatable random source: the same seed gives the same stream on every phone. */
export function seededRand(seed: string): (n: number) => number {
  let counter = 0;
  let buf: Uint8Array = new Uint8Array(0);
  let pos = 0;
  const refill = () => { buf = sha256(utf8ToBytes(`${seed}|${counter++}`)); pos = 0; };
  return (n: number) => {
    // rejection sampling over 32-bit values keeps it unbiased
    const limit = Math.floor(0x100000000 / n) * n;
    for (;;) {
      if (pos + 4 > buf.length) refill();
      const v = ((buf[pos]! << 24) | (buf[pos + 1]! << 16) | (buf[pos + 2]! << 8) | buf[pos + 3]!) >>> 0;
      pos += 4;
      if (v < limit) return v % n;
    }
  };
}
export * from "./control";
