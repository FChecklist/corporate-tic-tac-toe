// The beacon relay: our own server passes on the public random-number service, for a network that blocks the service's own servers. A postman only: the phone checks every answer.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { QUICKNET } from "../../../packages/beacon/src/index";
import { call, j, reset, restore } from "./param-harness";

beforeEach(() => reset());
afterEach(restore);
const CH = QUICKNET.chainHash;
const ANSWER = { round: 100, randomness: "ab".repeat(32), signature: "cd".repeat(48) };
const stub = (f: (url: string) => Response | Promise<Response> | never) => { const seen: string[] = []; globalThis.fetch = (async (u: any) => { const url = String(u); seen.push(url); return f(url); }) as any; return seen; };

describe("beacon relay", () => {
  test("a round is fetched from the first mirror and passed on unchanged, cacheable for good (a finished round never changes)", async () => {
    const seen = stub(() => new Response(JSON.stringify(ANSWER), { status: 200 }));
    const r = await call("GET", `/api/beacon/${CH}/public/100`); expect(r.status).toBe(200); expect(await j(r)).toEqual(ANSWER);
    expect(r.headers.get("cache-control")).toMatch(/immutable/); expect(seen[0]).toBe(`${QUICKNET.mirrors[0]}/${CH}/public/100`);
  });
  test("latest is cached for one second only", async () => {
    stub(() => new Response(JSON.stringify(ANSWER), { status: 200 }));
    const r = await call("GET", `/api/beacon/${CH}/public/latest`); expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toMatch(/max-age=1$/);
  });
  test("a mirror that fails is skipped: the next one answers", async () => {
    let n = 0; const seen = stub(() => { n++; if (n === 1) throw new Error("blocked"); if (n === 2) return new Response("oops", { status: 500 }); return new Response(JSON.stringify(ANSWER), { status: 200 }); });
    const r = await call("GET", `/api/beacon/${CH}/public/100`); expect(r.status).toBe(200); expect(seen.length).toBe(3);
  });
  test("a round that is not published yet is a plain 404, and when no mirror answers the phone is told to try again", async () => {
    stub(() => new Response("{}", { status: 404 })); expect((await call("GET", `/api/beacon/${CH}/public/999999999`)).status).toBe(404);
    stub(() => { throw new Error("down"); }); const bad = await call("GET", `/api/beacon/${CH}/public/100`); expect(bad.status).toBe(502); expect((await j(bad)).error).toMatch(/try again/);
  });
  test("it is never an open proxy: only the beacon's own chain and plain round numbers are passed on", async () => {
    const seen = stub(() => new Response(JSON.stringify(ANSWER), { status: 200 }));
    expect((await call("GET", `/api/beacon/${"0".repeat(64)}/public/100`)).status).toBe(404);
    for (const bad of [`/api/beacon/${CH}/public/abc`, `/api/beacon/${CH}/public/../../etc`, `/api/beacon/${CH}/info`, `/api/beacon/short/public/1`, `/api/beacon/${CH}/public/12345678901`]) expect([400, 404].includes((await call("GET", bad)).status)).toBe(true);
    expect(seen.length).toBe(0); // nothing was fetched for any of them
    expect((await call("POST", `/api/beacon/${CH}/public/100`, {})).status).not.toBe(200);
  });
});
