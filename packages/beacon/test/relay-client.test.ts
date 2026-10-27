import { afterEach, describe, expect, test } from "bun:test";
import { fetchRound } from "../src/index";

afterEach(() => { delete (globalThis as any).location; });
const ROUND = { round: 5, signature: "s", randomness: "r" };

describe("beacon client: our own server is the last route", () => {
  test("when the beacon's own servers cannot be reached, the relay on our site answers; the blocked ones are then asked last", async () => {
    (globalThis as any).location = { protocol: "https:", origin: "https://corporatetambola.com" };
    const asked: string[] = [];
    const fetcher = (async (url: string) => { asked.push(url); if (url.startsWith("https://corporatetambola.com/api/beacon")) return new Response(JSON.stringify(ROUND), { status: 200 }); throw new Error("blocked by the company firewall"); }) as any;
    const a = await fetchRound(5, { fetcher, verify: () => true, hedgeMs: 5 }); expect(a?.round).toBe(5);
    expect(asked.some((u) => u.startsWith("https://api.drand.sh"))).toBe(true); expect(asked.at(-1)!.startsWith("https://corporatetambola.com/api/beacon/")).toBe(true);
    asked.length = 0; const b = await fetchRound(5, { fetcher, verify: () => true, hedgeMs: 5 }); expect(b?.round).toBe(5);
    expect(asked[0]!.startsWith("https://corporatetambola.com/api/beacon/")).toBe(true); // the blocked servers are asked last for a while: a blocked network does not slow every number
  });
  test("with no page address (tests, scripts) no relay is added", async () => {
    const asked: string[] = []; const fetcher = (async (url: string) => { asked.push(url); throw new Error("down"); }) as any;
    await fetchRound(7, { fetcher, verify: () => true, hedgeMs: 5, timeoutMs: 50 });
    expect(asked.every((u) => !u.includes("/api/beacon/"))).toBe(true);
  });
});
