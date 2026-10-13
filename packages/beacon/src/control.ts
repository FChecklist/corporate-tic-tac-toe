// Signed organizer control messages (pause / resume / extend / stop) for the zero-server design.
//
// No server pushes anything to phones. The organizer's console signs a tiny message with an Ed25519 key whose PUBLIC half is fixed
// at engagement creation. Phones fetch the whole (tiny) log from one cached static file, verify every signature themselves, and
// apply it with a pure function. Because the beacon round (not any clock) is the only time reference, every phone that holds the
// same log computes the same call rounds, hence the same numbers.
//
// This file has no dependency on the beacon/BLS code so it can be bundled alone for the organizer console and the phone.
import { ed25519 } from "@noble/curves/ed25519";

export const PERIOD_SEC = 3; // drand quicknet period; the unit of every "round" below

export type ControlAction = "pause" | "resume" | "extend" | "stop";

export interface UnsignedControl {
  engagementId: string;
  /** 1, 2, 3 ... with no gaps. Replays and reordering cannot change the result (see acceptLog). */
  seq: number;
  action: ControlAction;
  /** Beacon round at which the action takes effect. */
  atBeaconRound: number;
  /** Latest beacon round the organizer's console had seen when signing. Used to enforce the safety lead below. */
  signedAtRound: number;
  /** pause/extend only: beacon round at which the pause ends by itself (a timed break). Omit for an open-ended pause. */
  untilRound?: number;
}
export interface ControlMsg extends UnsignedControl { sig: string }

export interface ControlConfig {
  /** Ed25519 public key (raw, 32 bytes, hex), fixed at engagement creation. */
  pubKey: string;
  /** An open-ended pause ends by itself after this many rounds, so a lost organizer cannot freeze a room forever. */
  maxPauseRounds: number;
  /** Minimum distance, in rounds, between signing and a pause/stop/extend taking effect. See deriveSafety. */
  leadRounds: number;
}

export const MAX_TIMED_PAUSE_ROUNDS = 28_800; // 24 h

/* ---------------- keys and signatures (WebCrypto Ed25519, noble as the fallback) ---------------- */

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => { if (!/^([0-9a-f]{2})+$/i.test(h)) throw new Error("bad hex"); return Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16)); };
const subtle = (): SubtleCrypto | null => (globalThis.crypto && "subtle" in globalThis.crypto ? globalThis.crypto.subtle : null);

export function canonicalBytes(m: UnsignedControl): Uint8Array {
  if (/[|\s]/.test(m.engagementId) || !m.engagementId) throw new Error("engagementId must be non-empty with no spaces or |");
  return new TextEncoder().encode(`CBCTL1|${m.engagementId}|${m.seq}|${m.action}|${m.atBeaconRound}|${m.signedAtRound}|${m.untilRound ?? "-"}`);
}

/** The private key is a non-extractable CryptoKey by default: the browser can sign with it but nothing can read it out. */
export async function generateOrganizerKey(extractable = false): Promise<{ publicKeyHex: string; privateKey: CryptoKey }> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto is not available here.");
  const pair = (await s.generateKey({ name: "Ed25519" } as any, extractable, ["sign", "verify"])) as CryptoKeyPair;
  return { publicKeyHex: hex(new Uint8Array(await s.exportKey("raw", pair.publicKey))), privateKey: pair.privateKey };
}

export async function signControl(privateKey: CryptoKey, m: UnsignedControl): Promise<ControlMsg> {
  const s = subtle();
  if (!s) throw new Error("WebCrypto is not available here.");
  const sig = new Uint8Array(await s.sign({ name: "Ed25519" } as any, privateKey, canonicalBytes(m) as BufferSource));
  return { ...m, sig: hex(sig) };
}

/** Sign with a raw 32-byte secret (tests, and browsers without WebCrypto Ed25519). */
export function signControlWithSecret(secretHex: string, m: UnsignedControl): ControlMsg {
  return { ...m, sig: hex(ed25519.sign(canonicalBytes(m), unhex(secretHex))) };
}

/** Public key for a raw 32-byte secret (tests and sims). */
export const publicKeyFromSecret = (secretHex: string): string => hex(ed25519.getPublicKey(unhex(secretHex)));

export async function verifyControlSig(pubKeyHex: string, m: ControlMsg): Promise<boolean> {
  try {
    if (!/^[0-9a-f]{128}$/i.test(m.sig)) return false;
    const msg = canonicalBytes(m), sig = unhex(m.sig), pub = unhex(pubKeyHex);
    const s = subtle();
    if (s) {
      try {
        const k = await s.importKey("raw", pub as BufferSource, { name: "Ed25519" } as any, false, ["verify"]);
        return await s.verify({ name: "Ed25519" } as any, k, sig as BufferSource, msg as BufferSource);
      } catch { /* this browser has no Ed25519 in WebCrypto: use the bundled implementation */ }
    }
    return ed25519.verify(sig, msg, pub);
  } catch {
    return false;
  }
}

/* ---------------- shape check ---------------- */

const isInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
export function wellFormed(x: any): x is ControlMsg {
  return !!x && typeof x === "object" && typeof x.engagementId === "string" && isInt(x.seq) && x.seq >= 1
    && ["pause", "resume", "extend", "stop"].includes(x.action) && isInt(x.atBeaconRound) && isInt(x.signedAtRound)
    && (x.untilRound === undefined || isInt(x.untilRound)) && typeof x.sig === "string";
}

/* ---------------- accepting a log from an untrusted place ---------------- */

/**
 * Turns whatever a CDN / mirror returned into the longest prefix of the real log it proves.
 *  - Messages with a bad signature, wrong engagement or malformed shape are dropped (a lying endpoint cannot invent anything).
 *  - Duplicates and replays are harmless: one message per seq, the first valid one seen wins.
 *  - Order does not matter: messages are sorted by seq. Applying stops at the first missing seq (a gap), so a truncated or
 *    selectively-withheld response can only make a phone know LESS, never something false.
 * `known` lets a phone merge a new response into what it already holds (an old, stale response never undoes anything).
 */
export async function acceptLogDetailed(cfg: ControlConfig, engagementId: string, incoming: unknown, known: readonly ControlMsg[] = []): Promise<{ log: ControlMsg[]; forged: number }> {
  const bySeq = new Map<number, ControlMsg>();
  for (const m of known) bySeq.set(m.seq, m);
  const list = Array.isArray(incoming) ? incoming : [];
  let forged = 0;
  for (const raw of list.slice(0, 500)) {
    if (!wellFormed(raw) || raw.engagementId !== engagementId) { forged++; continue; }
    const have = bySeq.get(raw.seq);
    if (have) { if (have.sig !== raw.sig) forged++; continue; } // a different message under a used seq is not believed
    if (await verifyControlSig(cfg.pubKey, raw)) bySeq.set(raw.seq, raw); else forged++;
  }
  const log: ControlMsg[] = [];
  for (let s = 1; bySeq.has(s); s++) log.push(bySeq.get(s)!);
  return { log, forged };
}
export async function acceptLog(cfg: ControlConfig, engagementId: string, incoming: unknown, known: readonly ControlMsg[] = []): Promise<ControlMsg[]> {
  return (await acceptLogDetailed(cfg, engagementId, incoming, known)).log;
}

/* ---------------- applying a verified log: a pure function ---------------- */

export interface PauseInterval { start: number; end: number }
export interface ControlState {
  /** Disjoint, sorted: beacon rounds [start, end) during which no call is made. */
  intervals: PauseInterval[];
  /** After this beacon round no call is made (engagement stopped). null = not stopped. */
  stopRound: number | null;
  /** Messages that were validly signed but break a rule (too little lead, wrong state ...). They take no effect but still use their seq. */
  ignored: { seq: number; why: string }[];
  applied: number;
}

interface Cur { start: number; until: number | null; endedAt: number | null }
const effEnd = (c: Cur, maxPause: number) => Math.min(c.endedAt ?? Infinity, c.until ?? c.start + maxPause);

/** Why a message would take no effect, or null if it is valid in this state. Shared by the phone and the publisher. */
function check(m: ControlMsg, cfg: ControlConfig, cur: Cur | null, stopped: boolean): string | null {
  if (stopped) return "engagement already stopped";
  if (m.signedAtRound > m.atBeaconRound) return "takes effect before it was signed";
  const lead = m.atBeaconRound - m.signedAtRound;
  const paused = cur && cur.start <= m.atBeaconRound && m.atBeaconRound < effEnd(cur, cfg.maxPauseRounds);
  switch (m.action) {
    case "pause":
      if (lead < cfg.leadRounds) return `pause needs at least ${cfg.leadRounds} rounds of lead`;
      if (cur && m.atBeaconRound < effEnd(cur, cfg.maxPauseRounds)) return "already paused";
      if (m.untilRound !== undefined && (m.untilRound <= m.atBeaconRound || m.untilRound - m.atBeaconRound > MAX_TIMED_PAUSE_ROUNDS)) return "bad pause end";
      return null;
    case "resume":
      if (!paused || !cur) return "not paused";
      if (lead < 1) return "resume must be after it was signed";
      return m.atBeaconRound > cur.start ? null : "resume before the pause began";
    case "extend":
      if (!cur || !paused) return "not paused";
      if (cur.endedAt !== null) return "pause already ending";
      if (lead < cfg.leadRounds) return `extend needs at least ${cfg.leadRounds} rounds of lead`;
      if (m.untilRound === undefined || m.untilRound - m.atBeaconRound > MAX_TIMED_PAUSE_ROUNDS) return "extend needs a sensible end round";
      return m.untilRound > effEnd(cur, cfg.maxPauseRounds) ? null : "extend must move the end later";
    case "stop":
      return lead >= cfg.leadRounds ? null : `stop needs at least ${cfg.leadRounds} rounds of lead`;
  }
}

export function resolveControl(cfg: ControlConfig, log: readonly ControlMsg[]): ControlState {
  const ivs: Cur[] = [];
  let cur: Cur | null = null, stop: number | null = null, applied = 0;
  const ignored: ControlState["ignored"] = [];
  for (const m of [...log].sort((a, b) => a.seq - b.seq)) {
    const why = check(m, cfg, cur, stop !== null);
    if (why) { ignored.push({ seq: m.seq, why }); continue; }
    applied++;
    if (m.action === "pause") { cur = { start: m.atBeaconRound, until: m.untilRound ?? null, endedAt: null }; ivs.push(cur); }
    else if (m.action === "resume") cur!.endedAt = m.atBeaconRound;
    else if (m.action === "extend") cur!.until = m.untilRound!;
    else stop = m.atBeaconRound;
  }
  return { intervals: ivs.map((c) => ({ start: c.start, end: effEnd(c, cfg.maxPauseRounds) })), stopRound: stop, ignored, applied };
}

/** True while a pause is in force at the given beacon round. */
export const pausedAt = (s: ControlState, round: number) => s.intervals.some((i) => round >= i.start && round < i.end);

/**
 * The beacon round call k uses. Without control messages this is start + k*stride (the existing schedule). Every pause pushes all
 * later calls later by exactly its length, so the gap between calls is still `stride` rounds (a multiple of 3 s) afterwards.
 * Returns null when the engagement was stopped before that call.
 */
export function callRound(s: ControlState, startRound: number, strideRounds: number, k: number): number | null {
  let a = startRound + k * strideRounds;
  for (const i of s.intervals) if (a >= i.start) a += i.end - i.start;
  return s.stopRound !== null && a >= s.stopRound ? null : a;
}

/** All call rounds for calls 0..count-1 (null entries only at the end, after a stop). */
export function scheduleWithControl(s: ControlState, startRound: number, strideRounds: number, count: number): (number | null)[] {
  return Array.from({ length: count }, (_, k) => callRound(s, startRound, strideRounds, k));
}

/* ---------------- how fresh must a phone's view be? ---------------- */

export interface SafetyInput { pollMaxSec: number; cacheTtlSec: number; latencySec: number; missedPollsTolerated: number }
export interface Safety { holdAfterRounds: number; leadRounds: number; giveUpRounds: number; worstNormalAgeSec: number; pollMaxSec: number }

/**
 * The rule that makes a late discovery impossible. A phone reveals new calls only while its last good fetch is at most
 * `holdAfterRounds` old. A pause signed just after that fetch's snapshot takes effect `leadRounds` after signing, and
 * leadRounds*3 > holdAfter*3 + cacheTtl + margin, so any call that phone reveals is earlier than the pause. Hence nobody ever
 * shows a number that a pause (which they could not yet have seen) would have prevented.
 */
export function deriveSafety(i: SafetyInput): Safety {
  const ceil3 = (s: number) => Math.ceil(s / PERIOD_SEC);
  const worst = i.pollMaxSec + i.cacheTtlSec + i.latencySec;
  const holdAfter = ceil3(worst + i.missedPollsTolerated * i.pollMaxSec);
  const lead = holdAfter + ceil3(i.cacheTtlSec) + 2; // snapshot staleness + publish latency margin
  return { holdAfterRounds: holdAfter, leadRounds: lead, giveUpRounds: Math.max(holdAfter * 6, 60), worstNormalAgeSec: worst, pollMaxSec: i.pollMaxSec };
}
/** The two profiles we recommend. */
export const SAFETY_STANDARD = deriveSafety({ pollMaxSec: 12, cacheTtlSec: 3, latencySec: 3, missedPollsTolerated: 1 }); // poll 9 s +/- 3
export const SAFETY_FAST = deriveSafety({ pollMaxSec: 7, cacheTtlSec: 3, latencySec: 3, missedPollsTolerated: 1 }); // poll 6 s +/- 1

/**
 * The free plan allows about 100,000 Worker requests a day, and every phone asks "any pause?" on a timer. So the bigger the engagement, the slower
 * the timer, and the longer a pause takes to reach phones (it always takes effect `leadRounds` after signing, so nobody ever sees a number a pause
 * should have prevented). Planning figure: one engagement may use about 40,000 requests for this, over about 20 minutes.
 */
export const SAFETY_LEAN30 = deriveSafety({ pollMaxSec: 36, cacheTtlSec: 3, latencySec: 3, missedPollsTolerated: 1 }); // phones ask about every 27 to 36 s
export const SAFETY_LEAN60 = deriveSafety({ pollMaxSec: 72, cacheTtlSec: 3, latencySec: 3, missedPollsTolerated: 1 }); // about every 54 to 72 s
export const ALL_SAFETIES: Safety[] = [SAFETY_FAST, SAFETY_STANDARD, SAFETY_LEAN30, SAFETY_LEAN60];
export const PAUSE_MAX_PARTICIPANTS = 2000;
/** The pause profile for an engagement of this size, or null when it is too large for a pause to be affordable on the free plan. */
export function safetyForCap(cap: number, fast = false): Safety | null {
  if (cap <= 250) return fast ? SAFETY_FAST : SAFETY_STANDARD;
  if (cap <= 1000) return SAFETY_LEAN30;
  if (cap <= PAUSE_MAX_PARTICIPANTS) return SAFETY_LEAN60;
  return null;
}

export type Mode = "live" | "hold" | "blind";

/**
 * The phone side. Holds the verified log and decides whether it may reveal new calls right now.
 *  live  - control state is fresh: reveal calls as their rounds arrive.
 *  hold  - the endpoint has been silent/lying too long: keep tracking the beacon but do NOT reveal new calls ("checking with the organizer").
 *  blind - every attempt failed for giveUpRounds in a row: assume no control messages exist and carry on, visibly flagged. If a pause turns out to have
 *          been issued meanwhile, the phone re-derives from the full log; its canonical log still equals everyone else's.
 */
export class ControlTracker {
  log: ControlMsg[] = [];
  lastGoodRound: number;
  /** Round of the first failed attempt in the current unbroken run of failures; null while attempts succeed or none were made. */
  failingSince: number | null = null;
  private resolved: ControlState;
  constructor(public cfg: ControlConfig, public engagementId: string, public safety: Safety, joinedAtRound: number) {
    this.lastGoodRound = joinedAtRound - safety.holdAfterRounds - 1; // a fresh phone has heard nothing: it holds until its first good fetch (and goes blind only after giveUpRounds)
    this.resolved = resolveControl(cfg, []);
  }
  get state(): ControlState { return this.resolved; }
  /** `body` is the parsed JSON of the control endpoint (or anything at all if it lied). Returns true if it was a good, verifiable answer. */
  async ingest(nowRound: number, body: unknown): Promise<boolean> {
    const b = body as { engagementId?: unknown; messages?: unknown } | null;
    if (!b || typeof b !== "object" || b.engagementId !== this.engagementId || !Array.isArray(b.messages)) return this.failed(nowRound);
    const { log, forged } = await acceptLogDetailed(this.cfg, this.engagementId, b.messages, this.log);
    if (forged > 0) return this.failed(nowRound); // anything forged in the answer: treat the whole answer as a lie (nothing from it is applied)
    if (log.length !== this.log.length) { this.log = log; this.resolved = resolveControl(this.cfg, log); }
    this.lastGoodRound = nowRound;
    this.failingSince = null;
    return true;
  }
  /** Call when a poll got no usable answer at all (network error, outage, bad status). Always returns false. */
  failed(nowRound: number): false { if (this.failingSince === null) this.failingSince = nowRound; return false; }
  mode(nowRound: number): Mode {
    if (nowRound - this.lastGoodRound <= this.safety.holdAfterRounds) return "live";
    // Blind only after a long unbroken run of FAILED attempts. A phone that was simply offline made no attempts, so it cannot go blind (it cannot reveal anything either).
    return this.failingSince !== null && nowRound - this.failingSince >= this.safety.giveUpRounds ? "blind" : "hold";
  }
  callRound(startRound: number, strideRounds: number, k: number) { return callRound(this.resolved, startRound, strideRounds, k); }
}

/* ---------------- publishing (shared by the local server and a Cloudflare Worker) ---------------- */

export interface KV { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }
export interface PublishedFile { v: 1; engagementId: string; pubKey: string; maxPauseRounds: number; leadRounds: number; messages: ControlMsg[] }

const fileKey = (id: string) => `control/${id}.json`;
export async function readPublished(kv: KV, engagementId: string): Promise<PublishedFile | null> {
  const t = await kv.get(fileKey(engagementId));
  return t ? (JSON.parse(t) as PublishedFile) : null;
}
export const cfgOf = (f: PublishedFile): ControlConfig => ({ pubKey: f.pubKey, maxPauseRounds: f.maxPauseRounds, leadRounds: f.leadRounds });

/** Registers the engagement's public key, once. Nobody (including the server) can swap it afterwards. */
export async function registerKey(kv: KV, engagementId: string, pubKeyHex: string, safety: Safety = SAFETY_STANDARD, maxPauseRounds = 600): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^[0-9a-f]{64}$/i.test(pubKeyHex)) return { ok: false, error: "The public key must be 32 bytes in hex." };
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(engagementId)) return { ok: false, error: "Bad engagement id." };
  if (await readPublished(kv, engagementId)) return { ok: false, error: "A key is already registered for this engagement and cannot be changed." };
  const f: PublishedFile = { v: 1, engagementId, pubKey: pubKeyHex.toLowerCase(), maxPauseRounds, leadRounds: safety.leadRounds, messages: [] };
  await kv.put(fileKey(engagementId), JSON.stringify(f));
  return { ok: true };
}

/**
 * Appends one signed message. Needs no login: the signature IS the authorisation, so a Worker in front of the store can be
 * completely open and still only ever accept the organizer's messages. Rejects (rather than silently ignoring) a message
 * that would take no effect, so the console tells the organizer immediately.
 */
export async function publishControl(kv: KV, engagementId: string, msg: unknown): Promise<{ ok: true; seq: number; duplicate?: boolean } | { ok: false; status: number; error: string }> {
  const f = await readPublished(kv, engagementId);
  if (!f) return { ok: false, status: 404, error: "No key is registered for this engagement." };
  if (!wellFormed(msg) || msg.engagementId !== engagementId) return { ok: false, status: 400, error: "Malformed control message." };
  const cfg = cfgOf(f);
  if (!(await verifyControlSig(cfg.pubKey, msg))) return { ok: false, status: 403, error: "Signature does not match the organizer key." };
  const existing = f.messages.find((m) => m.seq === msg.seq);
  if (existing) return existing.sig === msg.sig ? { ok: true, seq: msg.seq, duplicate: true } : { ok: false, status: 409, error: "That sequence number is already used." };
  if (msg.seq !== f.messages.length + 1) return { ok: false, status: 409, error: `Next sequence number is ${f.messages.length + 1}.` };
  const after = resolveControl(cfg, [...f.messages, msg]);
  const bad = after.ignored.find((x) => x.seq === msg.seq);
  if (bad) return { ok: false, status: 422, error: `Not accepted: ${bad.why}.` };
  f.messages.push(msg);
  await kv.put(fileKey(engagementId), JSON.stringify(f));
  return { ok: true, seq: msg.seq };
}

/** What the console shows / what the AI link reads (no key material beyond the public key). */
export function describeControl(f: PublishedFile | null, nowRound?: number) {
  if (!f) return { registered: false as const };
  const st = resolveControl(cfgOf(f), f.messages);
  return {
    registered: true as const, pubKey: f.pubKey, leadRounds: f.leadRounds, leadSeconds: f.leadRounds * PERIOD_SEC, maxPauseRounds: f.maxPauseRounds,
    messages: f.messages.map((m) => ({ seq: m.seq, action: m.action, atBeaconRound: m.atBeaconRound, untilRound: m.untilRound })),
    intervals: st.intervals, stopRound: st.stopRound, ignored: st.ignored,
    pausedNow: nowRound === undefined ? undefined : pausedAt(st, nowRound), stopped: nowRound === undefined || st.stopRound === null ? undefined : nowRound >= st.stopRound,
  };
}

/** Builds the next message for the console. `nowRound` must come from the beacon (utcNow), never the device clock. */
export function nextMessage(f: PublishedFile, nowRound: number, a: { action: ControlAction; inRounds?: number; pauseForRounds?: number; untilRound?: number; addRounds?: number }): UnsignedControl {
  const lead = a.action === "resume" ? Math.max(1, a.inRounds ?? f.leadRounds) : Math.max(f.leadRounds, a.inRounds ?? 0);
  const at = nowRound + lead;
  const m: UnsignedControl = { engagementId: f.engagementId, seq: f.messages.length + 1, action: a.action, atBeaconRound: at, signedAtRound: nowRound };
  if (a.action === "pause" && a.pauseForRounds) m.untilRound = at + a.pauseForRounds;
  if (a.action === "extend") {
    const open = resolveControl(cfgOf(f), f.messages).intervals.at(-1);
    m.untilRound = a.untilRound ?? (open ? open.end : at) + (a.addRounds ?? a.pauseForRounds ?? 0);
  }
  return m;
}
