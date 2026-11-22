// Shared set-up for the new-flow tests: the real Worker routes over the in-memory D1 stand-in (the same kit the edge tests use).
import { expect } from "bun:test";
import type { Env } from "../../apps/edge/src/worker";
import { handle } from "../../apps/edge/test/with-terms";
import { makeD1 } from "../../apps/edge/test/d1-sqlite";

export const T = Date.UTC(2026, 9, 31, 10, 0, 0);
const GEN = 1692803367;
export const START_ROUND = Math.floor((T / 1000 - GEN) / 3) + 1 + 1200;
export const dev = (i: number) => i.toString(16).padStart(4, "0").repeat(8);
export const j = async (r: Response) => (await r.json().catch(() => ({}))) as any;
export interface P { pid: string; device: string; name: string }
export interface World { env: Env; raw: ReturnType<typeof makeD1>["raw"]; n: number }
export const newWorld = (): World => { const d = makeD1(); return { env: { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000000", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k" } as Env, raw: d.raw, n: 0 }; };
export const callIn = (w: World) => (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), w.env, now);
export type Call = ReturnType<typeof callIn>;

/** A published, paid Tic Tac Toe game; returns the Organizer's key header. */
export async function makeGame(w: World, call: Call, id: string, over: Record<string, unknown> = {}) {
  const r = await j(await call("POST", "/api/start", { email: `o${++w.n}@acme.com` }, { "cf-connecting-ip": `10.0.0.${w.n}` }));
  const h = { "x-organizer": r.token as string };
  expect((await call("POST", "/api/z", { id, startRound: START_ROUND, callSeconds: 6, cap: 100, ...over }, h)).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, h)).status).toBe(200);
  w.raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]);
  return h;
}
export async function join(call: Call, id: string, count: number, from = 1): Promise<P[]> {
  const out: P[] = [];
  for (let i = from; i < from + count; i++) {
    const name = `Player ${i}`, r = await call("POST", `/api/z/${id}/join`, { name, device: dev(i) }, { "cf-connecting-ip": `10.${(i >> 8) & 255}.${i & 255}.9` }); expect(r.status).toBe(200);
    out.push({ pid: (await j(r)).pid, device: dev(i), name });
  }
  return out;
}
/** Flag ON and started: stageon, then stagego with the published start. */
export async function startStages(call: Call, id: string, h: Record<string, string>, body: Record<string, unknown> = {}, now = T) {
  expect((await call("POST", `/api/z/${id}/ttt/stageon`, {}, h, now)).status).toBe(200);
  return call("POST", `/api/z/${id}/ttt/stagego`, body, h, now);
}
export const write = (call: Call, id: string, p: P, e: { slot: string; kind: string; seq: number; body: string }, now = T) =>
  call("POST", `/api/z/${id}/ttt/stagelog`, { pid: p.pid, device: p.device, ...e }, {}, now);
