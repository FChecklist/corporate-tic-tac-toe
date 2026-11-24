// RUNNER_KEY (owner order 5 Nov 2026): the test sign-in, the free owner-test packs and the join-guard bypass are honoured ONLY with a valid X-Runner-Key header.
// The test preload (tests/runner-preload.ts) adds the right key to every request unless a test sets its own x-runner-key; "" means no key.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { W, call, dev, eng, j, keyH, mob, one, organizer, paidGame, reset, restore, uid } from "./param-harness";

const NOKEY = { "x-runner-key": "" }, WRONG = { "x-runner-key": "x".repeat(40) };
const signIn = (h: Record<string, string> = {}) => call("POST", "/api/auth/verify", { email: "demo1@xyz.in", code: "123456" }, h);
const joinH = (id: string, i: number, h: Record<string, string> = {}) => call("POST", `/api/z/${id}/join`, { phone: mob(i), name: "Guest " + i, device: dev(i), ...{} }, h);

describe("RUNNER_KEY: the test sign-in", () => {
  beforeEach(() => reset()); afterEach(restore);
  test("works with the right key", async () => { expect((await signIn()).status).toBe(200); });
  test("is refused without the key, with a wrong key, with no key set, and with a too-short key", async () => {
    expect((await signIn(NOKEY)).status).not.toBe(200);
    expect((await signIn(WRONG)).status).not.toBe(200);
    W.env = { ...W.env, RUNNER_KEY: "" } as any; expect((await signIn()).status).not.toBe(200); // no key set: nothing is honoured, even a header
    W.env = { ...W.env, RUNNER_KEY: "short" } as any; expect((await signIn({ "x-runner-key": "short" })).status).not.toBe(200); // a short key counts as no key
  });
});

describe("RUNNER_KEY: the free owner-test packs", () => {
  beforeEach(() => reset()); afterEach(restore);
  test("a demo game is paid (not a draft) with the key and a draft without it", async () => {
    const o = await organizer("demo1@xyz.in");
    const a = uid("OT"), b = uid("OT");
    expect((await j(await call("POST", "/api/z", eng(a, { cap: 250 }), keyH(o.key)))).draft).toBe(false);
    expect((await j(await call("POST", "/api/z", eng(b, { cap: 250 }), { ...keyH(o.key), ...NOKEY }))).draft).toBe(true);
  });
});

describe("RUNNER_KEY: the per-address join guard", () => {
  beforeEach(() => reset({ JOIN_PER_IP_MINUTE: "1", JOIN_PER_IP_DAY: "1" } as any)); afterEach(restore);
  const game = async (id: string, isTest: number) => { const g = await paidGame({ id }); W.raw.prepare("UPDATE engagement SET is_test=?, pack=1 WHERE id=?").run(isTest, id); return g; };
  const two = async (id: string, h: Record<string, string>) => { const a = (await joinH(id, 1, h)).status, b = (await joinH(id, 2, h)).status, c = (await joinH(id, 3, h)).status; return [a, b, c]; };
  test("SMK10M- test game + valid key: the guard is skipped", async () => { const id = "SMK10M-" + uid("A"); await game(id, 1); expect(await two(id, {})).toEqual([200, 200, 200]); });
  test("SMK10M- test game without the key: the guard still limits", async () => { const id = "SMK10M-" + uid("B"); await game(id, 1); const r = await two(id, NOKEY); expect(r[0]).toBe(200); expect(r[1]).toBe(429); });
  test("SMK10M- test game with a wrong key: the guard still limits", async () => { const id = "SMK10M-" + uid("C"); await game(id, 1); expect((await two(id, WRONG))[1]).toBe(429); });
  test("a test game whose id does not start with SMK10M-, with the key: still limited", async () => { const id = "PLAIN-" + uid("D"); await game(id, 1); expect((await two(id, {}))[1]).toBe(429); });
  test("an SMK10M- game that is not a test game, with the key: still limited", async () => { const id = "SMK10M-" + uid("E"); await game(id, 0); expect((await two(id, {}))[1]).toBe(429); });
});
