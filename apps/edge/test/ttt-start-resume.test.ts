// R3 (5 Nov 2026 audit): starting a tournament of more than 89 players writes in several steps. A passing database hiccup between the steps must never leave a started tournament with missing players:
// the players are written first, the tournament is switched on last, so a failed press leaves it open and the next press does it all again.
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { makeD1 } from "./d1-sqlite";
import { ENDED_MESSAGE, TttConsole, TttPhone } from "../../../packages/ttt/src/phone";
import { apiFor } from "../../../tools/sim2/phones";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200;
let env: Env; let raw: ReturnType<typeof makeD1>["raw"]; let n = 0;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
const dev = (i: number) => (i.toString(16).padStart(4, "0")).repeat(8);
interface P { pid: string; device: string; name: string }
const sql = (q: string, ...a: unknown[]) => raw.query(q).all(...(a as any[])) as any[];

async function game(id: string) {
  const r = await j(await call("POST", "/api/start", { email: `o${++n}@acme.com` }, { "cf-connecting-ip": `10.0.0.${n}` }));
  const org = { "x-organizer": r.token as string };
  expect((await call("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, org)).status).toBe(200);
  expect((await call("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, org)).status).toBe(200);
  raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]);
  return { org, ai: r.aiKey as string };
}
async function joinAll(id: string, count: number): Promise<P[]> {
  const out: P[] = [];
  for (let i = 1; i <= count; i++) { const name = `Player ${i}`; const r = await call("POST", `/api/z/${id}/join`, { name, device: dev(i) }); expect(r.status).toBe(200); out.push({ pid: (await j(r)).pid, device: dev(i), name }); }
  return out;
}
async function begin(id: string, org: Record<string, string>) {
  expect((await call("POST", `/api/z/${id}/ttt/start`, {}, org)).status).toBe(200);
  const clock = { t: T }; const con = new TttConsole(apiFor(call, clock, org), id);
  expect((await con.tick()).sentPlan).toBe(true);
  return { clock };
}
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", RUNNER_KEY: "test-runner-key-test-runner-key-test0000", DAILY_WRITE_BUDGET: "100000000", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k" } as Env; n = 0; });

const OVERLOAD = "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window";
/** Plays the overload once, on the batch that follows the first full 90-statement step (the second step of a big start). Returns whether it fired. */
function failBatch() { const real = env.DB as any; let big = false, fired = false; env = { ...env, DB: new Proxy(real, { get(t, p) { if (p === "batch") return async (xs: any[]) => { if (big && !fired) { fired = true; throw new Error(OVERLOAD); } if (xs.length === 90) big = true; return t.batch(xs); }; const v = t[p]; return typeof v === "function" ? v.bind(t) : v; } }) } as Env; return () => fired; }

describe("R3: starting a big tournament (more than 89 players) is resumable", () => {
  test("a hiccup after the first step: it stays open, the next press finishes it with every player", async () => {
    const h = await game("RS-1"); await joinAll("RS-1", 95);
    const before = env; const fired = failBatch();
    const r1 = await call("POST", "/api/z/RS-1/ttt/start", {}, h.org);
    expect(fired()).toBe(true); expect(r1.status).toBe(503); expect((await j(r1)).code).toBe("busy");
    expect(sql("SELECT state FROM ttt_t WHERE eid='RS-1'")[0].state).toBe("open"); // not "starting" with a part of the players
    env = before;
    const r2 = await j(await call("POST", "/api/z/RS-1/ttt/start", {}, h.org)); expect(r2.ok).toBe(true); expect(r2.players).toBe(95);
    expect(sql("SELECT state, players FROM ttt_t WHERE eid='RS-1'")[0]).toEqual({ state: "starting", players: 95 });
    expect(sql("SELECT COUNT(*) c FROM ttt_p WHERE eid='RS-1'")[0].c).toBe(95);
  });
  test("an ordinary big start (no hiccup) seats everyone once", async () => {
    const h = await game("RS-2"); await joinAll("RS-2", 95);
    expect((await j(await call("POST", "/api/z/RS-2/ttt/start", {}, h.org))).ok).toBe(true);
    expect(sql("SELECT COUNT(*) c FROM ttt_p WHERE eid='RS-2'")[0].c).toBe(95);
  });
});
