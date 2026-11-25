// "Notify me when this game begins" on the server side (apps/edge/src/push.ts), tested against a FAKE push service (a stand-in for fetch; nothing real is ever called).
// Dark: with either setting missing nothing is sent and nothing is written. Configured: ONE send per game when the game really starts, and a purge whenever the game's data is deleted.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import type { Env } from "../src/worker";
import { announceBegin, announceDueGames, BEGIN_BODY, BEGIN_TITLE, gameLink, pushSettings, resetPushState } from "../src/push";
import { erasePersonal, lifecycleTick } from "../src/lifecycle";
import { TttConsole } from "../../../packages/ttt/src/phone";
import { apiFor } from "../../../tools/sim2/phones";

const T = Date.UTC(2026, 9, 1, 10, 0, 0), GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200;
const PUSH = "https://push.example.com", KEY = "k".repeat(40) + "-secret-admin-key", ORIGIN = "https://tictactoe.corporatetambola.com";
let env: Env; let raw: ReturnType<typeof makeD1>["raw"]; let n = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => (i.toString(16).padStart(4, "0")).repeat(8);
const flagRows = (id: string) => (raw.prepare("SELECT COUNT(*) c FROM kv WHERE k=?").get(`pushbegin/${id}`) as { c: number }).c;

interface Sent { url: string; method: string; auth: string | null; body: any }
/** A stand-in for the push service: it checks the admin key like the real one, records every call, and can be made to fail. */
function fakePush(mode: { status?: number; throws?: boolean } = {}) {
  const sent: Sent[] = [];
  (globalThis as any).fetch = async (input: any, init: any) => {
    const url = String(input);
    if (!url.startsWith(PUSH)) return new Response("{}", { status: 404 });
    sent.push({ url, method: String(init?.method), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
    if (mode.throws) throw new Error("network down");
    if (new Headers(init?.headers).get("authorization") !== "Bearer " + KEY) return new Response("{}", { status: 401 });
    return new Response(JSON.stringify({ ok: true }), { status: mode.status ?? 200 });
  };
  return sent;
}

async function game(id: string) {
  const r = await j(await call("POST", "/api/start", { email: `o${++n}@acme.com` }, { "cf-connecting-ip": `10.9.0.${n}` }));
  const h = { "x-organizer": r.token as string };
  expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, h)).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, h)).status).toBe(200);
  raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]);
  for (let i = 1; i <= 2; i++) expect((await call("POST", `/api/z/${id}/join`, { name: `Player ${i}`, device: dev(i) })).status).toBe(200);
  return h;
}
/** The classic start as the Organizer's page does it: the start route, then the draw (the draw switches the game to "running"). */
async function begin(id: string, h: Record<string, string>) {
  expect((await call("POST", `/api/z/${id}/ttt/start`, {}, h)).status).toBe(200);
  const con = new TttConsole(apiFor(call, { t: T }, h), id);
  expect((await con.tick()).sentPlan).toBe(true);
}
const stateOf = (id: string) => (raw.prepare("SELECT state FROM ttt_t WHERE eid=?").get(id) as { state: string }).state;

beforeEach(() => {
  resetPushState();
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", RUNNER_KEY: "test-runner-key-test-runner-key-test0000", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: ORIGIN, PHONE_SALT: "salt", PUSH_URL: PUSH, PUSH_ADMIN_KEY: KEY } as unknown as Env;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("dark: nothing is sent and nothing is written without BOTH settings", () => {
  for (const [name, set] of [
    ["no settings at all", { PUSH_URL: undefined, PUSH_ADMIN_KEY: undefined }],
    ["the address but no key", { PUSH_ADMIN_KEY: undefined }],
    ["the key but no address", { PUSH_URL: undefined }],
    ["an empty key", { PUSH_ADMIN_KEY: "" }],
    ["an address that is not https", { PUSH_URL: "http://push.example.com" }],
    ["an address with a path", { PUSH_URL: "https://push.example.com/send" }],
  ] as [string, Record<string, unknown>][]) {
    test(name + ": starting a game sends nothing and writes no flag", async () => {
      Object.assign(env, set); const sent = fakePush();
      const h = await game("PU-D1"); await begin("PU-D1", h);
      expect(stateOf("PU-D1")).toBe("running");
      expect(sent.length).toBe(0); expect(flagRows("PU-D1")).toBe(0);
    });
  }
  test("deleting a game's data sends nothing, and the deletion still happens", async () => {
    Object.assign(env, { PUSH_ADMIN_KEY: undefined }); const sent = fakePush();
    await game("PU-D2"); await erasePersonal(env, "PU-D2", T, "organizer");
    expect(sent.length).toBe(0); expect((raw.prepare("SELECT COUNT(*) c FROM participant WHERE eid=?").get("PU-D2") as any).c).toBe(0);
  });
  test("pushSettings reads only a real https origin and a non-empty key", () => {
    expect(pushSettings({ PUSH_URL: "https://push.example.com/", PUSH_ADMIN_KEY: "x" })).toEqual({ url: "https://push.example.com", key: "x" });
    for (const url of ["", "push.example.com", "http://push.example.com", "https://localhost", "https://push.example.com/a", "https://push.example.com?x=1", "ftp://push.example.com"]) expect([url, pushSettings({ PUSH_URL: url, PUSH_ADMIN_KEY: "x" })]).toEqual([url, null]);
  });
});

describe("configured: one begin message per game, when the game really starts", () => {
  test("a classic game: ONE call, to /send, with the admin key, the game's scope, the message and the game link", async () => {
    const sent = fakePush(); const h = await game("PU-1");
    expect(sent.length).toBe(0); // nothing before the game starts (joining is not starting)
    await begin("PU-1", h);
    expect(sent.length).toBe(1);
    expect(sent[0]).toEqual({ url: PUSH + "/send", method: "POST", auth: "Bearer " + KEY, body: { scope: "game:PU-1", kind: "game_begins", title: BEGIN_TITLE, body: BEGIN_BODY, url: `${ORIGIN}/z.html?e=PU-1` } });
    expect(flagRows("PU-1")).toBe(1);
  });
  test("pressing Start again, or sending the draw again, never sends a second message", async () => {
    const sent = fakePush(); const h = await game("PU-2"); await begin("PU-2", h);
    expect((await call("POST", "/api/z/PU-2/ttt/start", {}, h)).status).toBe(409); // already started
    const con = new TttConsole(apiFor(call, { t: T }, h), "PU-2"); await con.tick(); await con.tick();
    expect(sent.length).toBe(1);
  });
  test("two sends at the same moment (the flag is one atomic claim) make one call; a later one makes none", async () => {
    const sent = fakePush(); await game("PU-3");
    const r = await Promise.all([announceBegin(env, "PU-3"), announceBegin(env, "PU-3"), announceBegin(env, "PU-3")]);
    expect(r.filter(Boolean).length).toBe(1); expect(sent.length).toBe(1);
    expect(await announceBegin(env, "PU-3")).toBe(false); expect(sent.length).toBe(1);
  });
  test("a game id the service would refuse is never sent, and no flag is written", async () => {
    const sent = fakePush();
    for (const id of ["", "a b", "x".repeat(129), "a/b", "é"]) expect(await announceBegin(env, id)).toBe(false);
    expect(sent.length).toBe(0); expect((raw.prepare("SELECT COUNT(*) c FROM kv WHERE k LIKE 'pushbegin/%'").get() as any).c).toBe(0);
  });
  test("the link is the game page on the public address; with no public setting it is the company address, never a relative link", () => {
    expect(gameLink(env, "AB-1")).toBe(`${ORIGIN}/z.html?e=AB-1`);
    expect(gameLink({ ...env, PUBLIC_ORIGIN: undefined } as any, "AB-1")).toBe(`${ORIGIN}/z.html?e=AB-1`);
    expect(gameLink({ ...env, PUBLIC_ORIGIN: "https://tictactoe.corporatetambola.com/" } as any, "a b")).toBe(`${ORIGIN}/z.html?e=a%20b`);
  });
  test("a link that is not https is never sent (the service would refuse it) and the one send is not used up", async () => {
    const sent = fakePush(); Object.assign(env, { PUBLIC_ORIGIN: "http://localhost" }); await game("PU-4");
    expect(await announceBegin(env, "PU-4")).toBe(false); expect(sent.length).toBe(0); expect(flagRows("PU-4")).toBe(0);
  });
  test("the words are short and kind, and use no my / mine / your / yours", () => {
    for (const t of [BEGIN_TITLE, BEGIN_BODY]) { expect(t.length).toBeGreaterThan(5); expect(t.length).toBeLessThan(80); expect(t).not.toMatch(/\b(my|mine|your|yours|we|our|us)\b/i); }
  });
});

describe("the new flow: sent when the published start comes, once", () => {
  async function stageGame(id: string, startMs?: number) {
    const h = await game(id);
    expect((await call("POST", `/api/z/${id}/ttt/stageon`, {}, h)).status).toBe(200);
    const r = await call("POST", `/api/z/${id}/ttt/stagego`, startMs === undefined ? {} : { startMs }, h); expect(r.status).toBe(200);
    return h;
  }
  test("started for now: one message at once", async () => {
    const sent = fakePush(); await stageGame("PU-S1");
    expect(sent.length).toBe(1); expect(sent[0]!.body.scope).toBe("game:PU-S1"); expect(sent[0]!.url).toBe(PUSH + "/send");
  });
  test("started for a later published time: nothing at the press, one message when the time comes (the minute job), and never a second", async () => {
    const sent = fakePush(); const later = T + 30 * 60_000;
    await stageGame("PU-S2", later);
    expect(stateOf("PU-S2")).toBe("running"); expect(sent.length).toBe(0);
    expect(await announceDueGames(env, T + 10 * 60_000)).toBe(0); expect(sent.length).toBe(0); // before the time: nothing
    await lifecycleTick(env as any, later + 1000); expect(sent.length).toBe(1); expect(sent[0]!.body.scope).toBe("game:PU-S2"); // the real minute job
    await lifecycleTick(env as any, later + 61_000); expect(await announceDueGames(env, later + 120_000)).toBe(0); expect(sent.length).toBe(1);
  });
  test("a game that began more than six hours ago is not announced late", async () => {
    const sent = fakePush(); await stageGame("PU-S3", T + 60_000);
    expect(await announceDueGames(env, T + 7 * 3_600_000)).toBe(0); expect(sent.length).toBe(0);
  });
});

describe("a purge whenever the game's data is deleted", () => {
  test("the Organizer's delete, the 24-hour job and the erase of everything each tell the service to forget exactly this game; the flag goes", async () => {
    const sent = fakePush(); const h = await game("PU-P1"); await announceBegin(env, "PU-P1"); sent.length = 0;
    expect(flagRows("PU-P1")).toBe(1);
    expect((await call("POST", "/api/z/PU-P1/erase", {}, h, T + 8 * 3_600_000)).status).toBe(200); // the Organizer's button, after the game
    expect(sent.length).toBe(1); expect(sent[0]).toEqual({ url: PUSH + "/purge", method: "POST", auth: "Bearer " + KEY, body: { scope: "game:PU-P1" } });
    expect(flagRows("PU-P1")).toBe(0);
    expect((raw.prepare("SELECT COUNT(*) c FROM participant WHERE eid=?").get("PU-P1") as any).c).toBe(0);
    await game("PU-P2"); sent.length = 0;
    await erasePersonal(env, "PU-P2", T, "auto"); // what the 24-hour job calls
    expect(sent.map((s) => [s.url, s.body])).toEqual([[PUSH + "/purge", { scope: "game:PU-P2" }]]);
  });
  test("a delete the person asked for by e-mail goes through the same function (erasePersonal), so it purges too", async () => {
    const src = await Bun.file(new URL("../src/worker.ts", import.meta.url)).text();
    expect(src).toMatch(/await erasePersonal\(env, tok, now, "email"\)/); expect(src).toMatch(/await erasePersonal\(env, eid!, now, "organizer"\)/);
    const life = await Bun.file(new URL("../src/lifecycle.ts", import.meta.url)).text();
    for (const by of ["retention", "test-purge", "unplayed", "cancel", "auto"]) expect([by, new RegExp("erasePersonal\\(env, [^)]*\"" + by + "\"\\)").test(life)]).toEqual([by, true]);
  });
});

describe("a service that is down or slow never stops a game, or the deletion of people's data", () => {
  test("a network failure at the start: the game still starts, nothing is shown, no secret is logged", async () => {
    const sent = fakePush({ throws: true }); const logs = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error")];
    try {
      const h = await game("PU-F1"); await begin("PU-F1", h);
      expect(stateOf("PU-F1")).toBe("running"); expect(sent.length).toBe(1);
      for (const l of logs) for (const c of l.mock.calls) expect(JSON.stringify(c)).not.toContain(KEY);
    } finally { for (const l of logs) l.mockRestore(); }
  });
  test("an error answer (500) does not stop the start either, and the one send is not repeated", async () => {
    const sent = fakePush({ status: 500 }); const h = await game("PU-F2"); await begin("PU-F2", h);
    expect(stateOf("PU-F2")).toBe("running"); expect(await announceBegin(env, "PU-F2")).toBe(false); expect(sent.length).toBe(1);
  });
  test("a failed purge does not stop the deletion; the next calls pause for a moment, so the job that deletes many games is not slowed", async () => {
    const sent = fakePush({ throws: true }); await game("PU-F3"); await game("PU-F4");
    await erasePersonal(env, "PU-F3", T, "auto"); await erasePersonal(env, "PU-F4", T, "auto");
    expect((raw.prepare("SELECT COUNT(*) c FROM participant WHERE eid IN ('PU-F3','PU-F4')").get() as any).c).toBe(0);
    expect(sent.length).toBe(1); // one failed try, then a pause
  });
  test("a wrong admin key is refused by the service and nothing breaks", async () => {
    const sent = fakePush(); Object.assign(env, { PUSH_ADMIN_KEY: "wrong-key" });
    const h = await game("PU-F5"); await begin("PU-F5", h); expect(stateOf("PU-F5")).toBe("running"); expect(sent.length).toBe(1);
  });
  test("the answers of the game's own routes never carry the key or the service address", async () => {
    fakePush(); const h = await game("PU-F6");
    const a = await (await call("POST", "/api/z/PU-F6/ttt/start", {}, h)).text(); const b = await (await call("GET", "/api/z/PU-F6/ttt/setup")).text();
    for (const t of [a, b]) { expect(t).not.toContain(KEY); expect(t).not.toContain("push.example.com"); }
  });
});
