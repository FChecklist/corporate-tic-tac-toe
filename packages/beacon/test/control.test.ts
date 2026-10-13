import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519";
import {
  ControlTracker, SAFETY_FAST, SAFETY_STANDARD, acceptLog, callRound, deriveSafety, describeControl, generateOrganizerKey, nextMessage, pausedAt,
  publishControl, readPublished, registerKey, resolveControl, scheduleWithControl, signControl, signControlWithSecret, verifyControlSig,
  type ControlConfig, type ControlMsg, type KV, type UnsignedControl,
} from "../src";

const ID = "ABC1234";
const secret = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const secretHex = Array.from(secret, (b) => b.toString(16).padStart(2, "0")).join("");
const pub = Array.from(ed25519.getPublicKey(secret), (b) => b.toString(16).padStart(2, "0")).join("");
const cfg: ControlConfig = { pubKey: pub, maxPauseRounds: 600, leadRounds: 12 };
const S = 1000, STRIDE = 2; // call k uses round 1000 + 2k  (6 second calls)
const mk = (seq: number, action: UnsignedControl["action"], at: number, signedAt: number, until?: number): ControlMsg =>
  signControlWithSecret(secretHex, { engagementId: ID, seq, action, atBeaconRound: at, signedAtRound: signedAt, untilRound: until });
const kv = (): KV & { m: Map<string, string> } => { const m = new Map<string, string>(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) }; };

describe("signatures", () => {
  test("WebCrypto Ed25519 sign -> verify, and a noble-signed message verifies through WebCrypto too", async () => {
    const k = await generateOrganizerKey();
    const m = await signControl(k.privateKey, { engagementId: ID, seq: 1, action: "pause", atBeaconRound: 50, signedAtRound: 38 });
    expect(await verifyControlSig(k.publicKeyHex, m)).toBe(true);
    expect(await verifyControlSig(pub, mk(1, "stop", 50, 30))).toBe(true);
  });
  test("the private key is not extractable", async () => {
    const k = await generateOrganizerKey();
    await expect(crypto.subtle.exportKey("pkcs8", k.privateKey)).rejects.toThrow();
  });
  test("any changed field, another key or a mangled signature fails", async () => {
    const m = mk(1, "pause", 50, 38);
    for (const bad of [{ ...m, seq: 2 }, { ...m, action: "stop" as const }, { ...m, atBeaconRound: 51 }, { ...m, signedAtRound: 39 }, { ...m, untilRound: 80 }, { ...m, engagementId: "OTHER11" }, { ...m, sig: "00".repeat(64) }, { ...m, sig: "zz" }])
      expect(await verifyControlSig(pub, bad as ControlMsg)).toBe(false);
    const other = await generateOrganizerKey();
    expect(await verifyControlSig(other.publicKeyHex, m)).toBe(false);
  });
});

describe("log acceptance: replay, order, gaps, forgeries", () => {
  const a = mk(1, "pause", 1100, 1080), b = mk(2, "resume", 1160, 1150), c = mk(3, "stop", 1300, 1280);
  test("order and duplicates do not matter", async () => {
    const x = await acceptLog(cfg, ID, [c, a, b, a, b, c]);
    expect(x.map((m) => m.seq)).toEqual([1, 2, 3]);
  });
  test("a gap stops the log: later messages are held back until the gap is filled", async () => {
    const part = await acceptLog(cfg, ID, [a, c]);
    expect(part.map((m) => m.seq)).toEqual([1]);
    expect((await acceptLog(cfg, ID, [b], part)).map((m) => m.seq)).toEqual([1, 2]); // c still unknown here
    expect((await acceptLog(cfg, ID, [b, c], part)).map((m) => m.seq)).toEqual([1, 2, 3]);
  });
  test("a stale (older) answer arriving after a newer one cannot undo anything", async () => {
    const full = await acceptLog(cfg, ID, [a, b, c]);
    expect((await acceptLog(cfg, ID, [a], full)).length).toBe(3);
  });
  test("forged and other-engagement messages are dropped; a second message under a used seq is not believed", async () => {
    const forged = { ...b, atBeaconRound: 1161 };
    const other = signControlWithSecret(secretHex, { engagementId: "OTHER11", seq: 2, action: "resume", atBeaconRound: 1160, signedAtRound: 1150 });
    const evil = mk(1, "stop", 1111, 1090);
    expect((await acceptLog(cfg, ID, [a, forged, other, evil])).map((m) => m.sig)).toEqual([a.sig]);
    const tr = new ControlTracker(cfg, ID, SAFETY_STANDARD, 990);
    expect(await tr.ingest(1000, { engagementId: ID, messages: [a, forged] })).toBe(false); // one forgery poisons the whole answer
    expect(tr.log.length).toBe(0);
  });
});

describe("applying a pause: every phone that holds the same log computes the same rounds", () => {
  test("no messages: the existing schedule, unchanged", () => {
    const st = resolveControl(cfg, []);
    expect(scheduleWithControl(st, S, STRIDE, 5)).toEqual([1000, 1002, 1004, 1006, 1008]);
  });
  test("a pause spanning several calls pushes every later call by exactly its length; stride stays 2 rounds (6 s)", () => {
    const st = resolveControl(cfg, [mk(1, "pause", 1011, 998), mk(2, "resume", 1041, 1030)]); // paused rounds 1011..1040 = 30 rounds (90 s)
    expect(st.intervals).toEqual([{ start: 1011, end: 1041 }]);
    const r = scheduleWithControl(st, S, STRIDE, 30) as number[];
    expect(r.slice(0, 6)).toEqual([1000, 1002, 1004, 1006, 1008, 1010]); // before the pause
    expect(r[6]).toBe(1012 + 30); // call 6 would have been 1012 (inside the pause) -> 1042
    for (let k = 1; k < 30; k++) if (k !== 6) expect(r[k]! - r[k - 1]!).toBe(2); // ...except across the pause itself
    expect(r.filter((x) => pausedAt(st, x))).toEqual([]); // no call ever lands inside a pause
    expect(r.every((x) => ((x - S) % STRIDE) === 0 || x >= 1041)).toBe(true);
  });
  test("a call exactly on the first paused round moves; one just before does not", () => {
    const st = resolveControl(cfg, [mk(1, "pause", 1010, 990), mk(2, "resume", 1020, 1000)]);
    expect(callRound(st, S, STRIDE, 4)).toBe(1008);
    expect(callRound(st, S, STRIDE, 5)).toBe(1020);
  });
  test("two separate pauses add up; a call pushed out of the first can land inside the second and is pushed again", () => {
    const st = resolveControl(cfg, [mk(1, "pause", 1010, 990), mk(2, "resume", 1020, 1000), mk(3, "pause", 1030, 1010), mk(4, "resume", 1050, 1030)]);
    expect(st.intervals.length).toBe(2);
    const r = scheduleWithControl(st, S, STRIDE, 20) as number[];
    expect(r.filter((x) => pausedAt(st, x))).toEqual([]);
    expect(r[19]! - 1000 - 19 * 2).toBe(10 + 20);
  });
  test("open-ended pause ends by itself after maxPauseRounds (a lost organizer cannot freeze the room)", () => {
    const st = resolveControl(cfg, [mk(1, "pause", 1100, 1080)]);
    expect(st.intervals).toEqual([{ start: 1100, end: 1700 }]);
  });
  test("timed pause, then extend moves its end; resume ends it early", () => {
    const t = resolveControl(cfg, [mk(1, "pause", 1100, 1080, 1130)]);
    expect(t.intervals).toEqual([{ start: 1100, end: 1130 }]);
    const e = resolveControl(cfg, [mk(1, "pause", 1100, 1080, 1130), mk(2, "extend", 1115, 1100, 1190)]);
    expect(e.intervals).toEqual([{ start: 1100, end: 1190 }]);
    const r = resolveControl(cfg, [mk(1, "pause", 1100, 1080, 1130), mk(2, "extend", 1115, 1100, 1190), mk(3, "resume", 1150, 1140)]);
    expect(r.intervals).toEqual([{ start: 1100, end: 1150 }]);
  });
  test("stop: no call at or after the stop round, none after a stop in any case", () => {
    const st = resolveControl(cfg, [mk(1, "stop", 1050, 1030), mk(2, "pause", 1200, 1100)]);
    expect(st.stopRound).toBe(1050);
    expect(st.ignored.map((x) => x.seq)).toEqual([2]);
    const r = scheduleWithControl(st, S, STRIDE, 40);
    expect(r.filter((x) => x !== null).length).toBe(25); // rounds 1000..1048
    expect(r[25]).toBeNull();
  });
  test("rule breaks are ignored, deterministically, and still consume their seq", () => {
    const st = resolveControl(cfg, [
      mk(1, "pause", 1100, 1095), // too little lead (5 < 12)
      mk(2, "resume", 1105, 1100), // not paused
      mk(3, "extend", 1110, 1090, 1200), // not paused
      mk(4, "pause", 1100, 1088), // ok
      mk(5, "pause", 1105, 1090), // already paused
      mk(6, "resume", 1099, 1090), // resume before the pause began
    ]);
    expect(st.ignored.map((x) => x.seq)).toEqual([1, 2, 3, 5, 6]);
    expect(st.intervals).toEqual([{ start: 1100, end: 1700 }]);
  });
  test("a late joiner who replays the whole log gets the same schedule as a phone that watched it grow", async () => {
    const full = [mk(1, "pause", 1100, 1080), mk(2, "resume", 1160, 1150), mk(3, "pause", 1300, 1280, 1330)];
    const live = new ControlTracker(cfg, ID, SAFETY_STANDARD, 1000);
    for (const n of [1, 2, 3]) await live.ingest(1000 + n * 100, { engagementId: ID, messages: full.slice(0, n) });
    const late = new ControlTracker(cfg, ID, SAFETY_STANDARD, 1400);
    await late.ingest(1400, { engagementId: ID, messages: [...full].reverse() });
    for (let k = 0; k < 90; k++) expect(late.callRound(S, STRIDE, k)).toBe(live.callRound(S, STRIDE, k));
  });
});

describe("freshness: the safe default when the control endpoint is missing or lying", () => {
  test("lead is long enough that a phone inside its freshness window can never have shown a call a later pause forbids", () => {
    for (const poll of [4, 7, 9, 12, 20]) for (const ttl of [0, 3, 6]) for (const lat of [0, 3, 6]) for (const miss of [0, 1, 2]) {
      const s = deriveSafety({ pollMaxSec: poll, cacheTtlSec: ttl, latencySec: lat, missedPollsTolerated: miss });
      // snapshot is up to ttl old when fetched; a pause signed right after it takes effect lead rounds later; reveals stop holdAfter rounds after the fetch
      expect(s.leadRounds * 3 - ttl).toBeGreaterThan(s.holdAfterRounds * 3);
      expect(s.holdAfterRounds * 3).toBeGreaterThanOrEqual(poll + ttl + lat);
    }
    expect(SAFETY_STANDARD).toMatchObject({ holdAfterRounds: 10, leadRounds: 13 });
    expect(SAFETY_FAST.leadRounds).toBeLessThan(SAFETY_STANDARD.leadRounds);
  });
  test("live -> hold -> blind as the last good answer ages; a good answer makes it live again", async () => {
    const t = new ControlTracker(cfg, ID, SAFETY_STANDARD, 1000);
    expect(t.mode(1000)).toBe("hold"); // a brand-new phone has heard nothing yet
    expect(await t.ingest(1000, { engagementId: ID, messages: [] })).toBe(true);
    expect(t.mode(1000 + SAFETY_STANDARD.holdAfterRounds)).toBe("live");
    expect(t.mode(1000 + SAFETY_STANDARD.holdAfterRounds + 1)).toBe("hold");
    expect(t.mode(1000 + SAFETY_STANDARD.giveUpRounds + 100)).toBe("hold"); // silence alone (phone offline, no attempts) never goes blind
    t.failed(1020); t.failed(1030); // an unbroken run of failed attempts
    expect(t.mode(1020 + SAFETY_STANDARD.giveUpRounds - 1)).toBe("hold");
    expect(t.mode(1020 + SAFETY_STANDARD.giveUpRounds)).toBe("blind");
    expect(await t.ingest(1300, { engagementId: ID, messages: [] })).toBe(true);
    expect(t.mode(1300)).toBe("live");
  });
  test("garbage, wrong engagement and non-JSON answers never count as a good answer", async () => {
    const t = new ControlTracker(cfg, ID, SAFETY_STANDARD, 1000);
    for (const b of [null, "x", 5, {}, { engagementId: "OTHER11", messages: [] }, { engagementId: ID, messages: "no" }, { engagementId: ID, messages: [{ seq: 1 }] }])
      expect(await t.ingest(1000, b)).toBe(false);
    expect(t.mode(1001)).toBe("hold");
  });
});

describe("publishing (same code runs in the local server and in a Cloudflare Worker)", () => {
  test("register once; publish needs no login because the signature is the login", async () => {
    const store = kv();
    expect((await registerKey(store, ID, pub)).ok).toBe(true);
    expect((await registerKey(store, ID, "ab".repeat(32))).ok).toBe(false); // the key can never be swapped
    const f = (await readPublished(store, ID))!;
    const m1 = signControlWithSecret(secretHex, nextMessage(f, 2000, { action: "pause" }));
    expect(m1.atBeaconRound).toBe(2000 + f.leadRounds);
    expect(await publishControl(store, ID, m1)).toEqual({ ok: true, seq: 1 });
    expect(await publishControl(store, ID, m1)).toEqual({ ok: true, seq: 1, duplicate: true }); // idempotent retry
    const stranger = await generateOrganizerKey();
    const f2 = (await readPublished(store, ID))!;
    const forged = await signControl(stranger.privateKey, nextMessage(f2, 2010, { action: "resume" }));
    expect(await publishControl(store, ID, forged)).toMatchObject({ ok: false, status: 403 });
    const gap = signControlWithSecret(secretHex, { ...nextMessage(f2, 2010, { action: "resume" }), seq: 5 });
    expect(await publishControl(store, ID, gap)).toMatchObject({ ok: false, status: 409 });
    const m2 = signControlWithSecret(secretHex, nextMessage(f2, 2010, { action: "resume" }));
    expect(await publishControl(store, ID, m2)).toMatchObject({ ok: true, seq: 2 });
    const d = describeControl((await readPublished(store, ID))!, 2100);
    expect(d).toMatchObject({ registered: true, pausedNow: false });
  });
  test("a message that would take no effect is refused up front, not silently ignored", async () => {
    const store = kv();
    await registerKey(store, ID, pub);
    const f = (await readPublished(store, ID))!;
    const early = mk(1, "pause", 2005, 2000); // lead 5 < 13
    expect(await publishControl(store, ID, early)).toMatchObject({ ok: false, status: 422 });
    expect(await publishControl(store, ID, mk(1, "resume", 2050, 2000))).toMatchObject({ ok: false, status: 422 }); // not paused
    expect((await readPublished(store, ID))!.messages.length).toBe(0);
    void f;
  });
});
