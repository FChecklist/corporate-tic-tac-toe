import { describe, expect, test } from "bun:test";
import { bytesToHex } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { QUICKNET, deriveCalls, fetchRound, pickNumber, roundAt, roundTimeMs, scheduleFor, syncCalls, verifyRound, type Fetcher, type Round } from "../src";

// A genuine round captured from the live quicknet beacon on 2026-10-01.
const REAL: Round = {
  round: 32680188,
  randomness: "372b3ac5a47dc12f4280df3750b5bf58d7a100186370e6fba08571bd3c7f421d",
  signature: "b79356001df1e55e85fc2648bd6d6cd58cf2472b035f44c542a9038768da2c3898b8c3e19218f0a7f22f7e35de66c7af",
};

// A stand-in beacon for tests: not cryptographic, so we mark rounds as pre-verified via a custom net would be needed;
// instead tests of the call logic feed randomness directly, and fetch logic is tested with the real fixture.
const fakeRand = (seed: string, k: number) => bytesToHex(sha256(new TextEncoder().encode(`${seed}:${k}`)));

describe("beacon signature check", () => {
  test("a real round verifies", () => expect(verifyRound(REAL)).toBe(true));
  test("a changed round number fails", () => expect(verifyRound({ ...REAL, round: REAL.round + 1 })).toBe(false));
  test("a changed signature fails", () => {
    const s = REAL.signature.slice(0, -2) + (REAL.signature.endsWith("ff") ? "fe" : "ff");
    expect(verifyRound({ ...REAL, signature: s })).toBe(false);
  });
  test("randomness that is not the hash of the signature fails", () => expect(verifyRound({ ...REAL, randomness: "00".repeat(32) })).toBe(false));
  test("garbage fails without throwing", () => expect(verifyRound({ round: 1, signature: "zz", randomness: "" })).toBe(false));
});

describe("UTC time from rounds", () => {
  test("round time maps to the right UTC instant", () => {
    expect(new Date(roundTimeMs(1)).toISOString()).toBe("2023-08-23T15:09:27.000Z");
    expect(new Date(roundTimeMs(REAL.round)).toISOString().slice(0, 10)).toBe("2026-10-01");
  });
  test("roundAt inverts roundTimeMs", () => {
    for (const r of [1, 2, 1000, REAL.round]) {
      expect(roundAt(roundTimeMs(r))).toBe(r);
      expect(roundAt(roundTimeMs(r) + 2999)).toBe(r);
      expect(roundAt(roundTimeMs(r) + 3000)).toBe(r + 1);
    }
  });
});

describe("mirrors", () => {
  const ok = (body: Round): Fetcher => async () => ({ ok: true, status: 200, json: async () => body });
  test("falls through blocked and lying mirrors to an honest one", async () => {
    const calls: string[] = [];
    const f: Fetcher = async (url) => {
      calls.push(url);
      if (url.includes("blocked")) throw new Error("firewall");
      if (url.includes("liar")) return { ok: true, status: 200, json: async () => ({ ...REAL, signature: REAL.signature.replace(/^b7/, "b8") }) };
      if (url.includes("late")) return { ok: false, status: 404, json: async () => ({}) };
      return ok(REAL)(url);
    };
    const x = await fetchRound(REAL.round, { fetcher: f, mirrors: ["https://blocked", "https://liar", "https://late", "https://good"] });
    expect(x?.round).toBe(REAL.round);
    expect(calls.length).toBe(4);
  });
  test("a mirror that hangs forever is skipped after the timeout", async () => {
    const f: Fetcher = (url) => (url.includes("hang") ? new Promise(() => {}) : Promise.resolve({ ok: true, status: 200, json: async () => REAL }));
    const t0 = performance.now();
    const x = await fetchRound(REAL.round, { fetcher: f, mirrors: ["https://hang", "https://good"], timeoutMs: 150 });
    expect(x?.round).toBe(REAL.round);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
  test("a mirror returning garbage JSON or a non-object is skipped", async () => {
    const f: Fetcher = async (url) => (url.includes("bad") ? { ok: true, status: 200, json: async () => "<html>blocked by firewall</html>" } : { ok: true, status: 200, json: async () => REAL });
    expect((await fetchRound(REAL.round, { fetcher: f, mirrors: ["https://bad", "https://good"] }))?.round).toBe(REAL.round);
  });
  test("all mirrors down returns null, never a made-up round", async () => {
    const f: Fetcher = async () => { throw new Error("offline"); };
    expect(await fetchRound(REAL.round, { fetcher: f, mirrors: ["https://a", "https://b"] })).toBeNull();
  });
  test("a mirror that answers a different round is rejected", async () => {
    expect(await fetchRound(REAL.round + 5, { fetcher: ok(REAL), mirrors: ["https://a"] })).toBeNull();
  });
});

describe("deterministic calls", () => {
  const rs = Array.from({ length: 75 }, (_, k) => fakeRand("t", k));
  test("same inputs give the same log, on every phone", () => expect(deriveCalls("E1", rs)).toEqual(deriveCalls("E1", rs)));
  test("all 75 numbers appear exactly once", () => {
    const c = deriveCalls("E1", rs);
    expect(c.length).toBe(75);
    expect(new Set(c).size).toBe(75);
    expect(Math.min(...c)).toBe(1);
    expect(Math.max(...c)).toBe(75);
  });
  test("different engagement or different randomness gives a different order", () => {
    expect(deriveCalls("E2", rs)).not.toEqual(deriveCalls("E1", rs));
    expect(deriveCalls("E1", rs.map((_, k) => fakeRand("u", k)))).not.toEqual(deriveCalls("E1", rs));
  });
  test("call k depends only on rounds up to k: later randomness cannot change or reveal it", () => {
    const a = deriveCalls("E1", rs.slice(0, 30));
    const b = deriveCalls("E1", rs.slice(0, 40).map((x, i) => (i < 30 ? x : fakeRand("other", i))));
    expect(b.slice(0, 30)).toEqual(a);
  });
  test("no obvious bias: first call is roughly uniform over 1..75", () => {
    const counts = new Array(76).fill(0);
    for (let s = 0; s < 9000; s++) counts[pickNumber("E", 0, fakeRand("s" + s, 0), [])]++;
    for (let n = 1; n <= 75; n++) { expect(counts[n]).toBeGreaterThan(55); expect(counts[n]).toBeLessThan(150); } // mean 100
  });
  test("a call after all 75 throws", () => expect(() => pickNumber("E", 75, rs[0]!, Array.from({ length: 75 }, (_, i) => i + 1))).toThrow());
});

describe("schedule", () => {
  test("round per call from the call speed", () => {
    expect(scheduleFor(100, 6, 4)).toEqual([100, 102, 104, 106]);
    expect(scheduleFor(100, 12, 3)).toEqual([100, 104, 108]);
  });
  test("speeds that do not align to the 3 s round are refused", () => {
    expect(() => scheduleFor(100, 10)).toThrow();
    expect(() => scheduleFor(100, 3)).toThrow();
  });
  test("syncCalls stops at the first missing round", async () => {
    // Only a real signed round exists for the first slot, so a one-round log is derivable and slot two is missing.
    const f: Fetcher = async (url) => (url.endsWith(`/${REAL.round}`) ? { ok: true, status: 200, json: async () => REAL } : { ok: false, status: 404, json: async () => ({}) });
    const r = await syncCalls("E1", [REAL.round, REAL.round + 2], 2, { fetcher: f, mirrors: ["https://a"] });
    expect(r.calls.length).toBe(1);
    expect(r.missing).toEqual([REAL.round + 2]);
    expect(QUICKNET.periodSec).toBe(3);
  });
});

describe("no phone clock", () => {
  test("the beacon code never reads the device clock", async () => {
    const src = await Bun.file(new URL("../src/index.ts", import.meta.url)).text();
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(/Date\.now\s*\(|new Date\s*\(|performance\.now/.test(code)).toBe(false);
  });
});
