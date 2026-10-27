// POST /api/z/:id/who ("Is this you?"): once an employee ID is typed and the K4 boxes are ticked the page shows the name the organizer gave (first name + last initial).
// Review finding 1 of the join-redesign WIP: the route was written but not in the worker's action list, so every call was a 404. These tests go through the real handle().
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { consentFor } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const GEN = 1692803367;
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
const START = roundAt(T) + 1200;
let env: PayEnv; let ipN = 0;
const realFetch = globalThis.fetch;
const call = (method: string, path: string, body?: unknown, key?: string, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const who = (id: string, body: Record<string, unknown>) => call("POST", `/api/z/${id}/who`, body);

async function setup(opts: { publish?: boolean; verify?: string; employeesOnly?: boolean } = {}) {
  const st = await j(await handle(new Request("http://x/api/start", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": `7.7.7.${++ipN}` }, body: JSON.stringify({ email: `o${ipN}@acme.com` }) }), env as Env, T));
  const master = st.token as string;
  await call("POST", "/api/z", { id: "WHO-1", startRound: START, callSeconds: 6, cap: 100, whoCanJoin: "list" }, master);
  if (opts.publish !== false) await call("POST", "/api/z/WHO-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, master);
  if (opts.verify || opts.employeesOnly !== undefined) {
    const patch = { ...(opts.verify ? { verify: opts.verify } : {}), ...(opts.employeesOnly !== undefined ? { employeesOnly: opts.employeesOnly } : {}) };
    expect((await call("PATCH", "/api/z/WHO-1/settings", patch, master)).status).toBe(200);
  }
  return { master };
}
const add = (key: string, people: unknown[]) => call("POST", "/api/z/WHO-1/people", { people }, key);

beforeEach(() => { const d = makeD1(); env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "https://tictactoe.test", PHONE_SALT: "salt" } as any; (globalThis as any).fetch = async () => new Response("{}"); });
afterEach(() => { globalThis.fetch = realFetch; });

describe("POST /api/z/:id/who", () => {
  test("a listed employee ID gets the name as the organizer gave it: first name and last initial", async () => {
    const t = await setup({ verify: "id", employeesOnly: true });
    await add(t.master, [{ name: "Asha Rao", empId: "E101" }, { name: "Ravi", empId: "E102" }]);
    const r = await who("WHO-1", { empId: "E101", consent: consentFor("K4") });
    expect(r.status).toBe(200);
    expect(await j(r)).toEqual({ known: true, name: "Asha R." });
    expect(await j(await who("WHO-1", { empId: "e102", consent: consentFor("K4") }))).toEqual({ known: true, name: "Ravi" }); // lower case is the same ID; a single name is shown whole
  });
  test("an ID that is not on the list is not known, and nothing is revealed", async () => {
    const t = await setup({ verify: "id", employeesOnly: true });
    await add(t.master, [{ name: "Asha Rao", empId: "E101" }]);
    const r = await who("WHO-1", { empId: "E999", consent: consentFor("K4") });
    expect(r.status).toBe(200);
    expect(await j(r)).toEqual({ known: false });
  });
  test("without the ticked boxes it is refused (400), even for a listed ID", async () => {
    const t = await setup({ verify: "id", employeesOnly: true });
    await add(t.master, [{ name: "Asha Rao", empId: "E101" }]);
    const r = await who("WHO-1", { empId: "E101" });
    expect(r.status).toBe(400);
    expect((await j(r)).name).toBeUndefined();
  });
  test("a game that is still a draft answers 403, like the join", async () => {
    await setup({ publish: false });
    const r = await who("WHO-1", { empId: "E101", consent: consentFor("K4") });
    expect(r.status).toBe(403);
  });
  test("in a mobile-number game there is no name to show", async () => {
    const t = await setup({});
    await add(t.master, [{ name: "Asha Rao", phone: "9100000001" }]);
    expect(await j(await who("WHO-1", { empId: "E101", consent: consentFor("K4") }))).toEqual({ known: false });
  });
  test("a blank ID is 'not known', never an error", async () => {
    const t = await setup({ verify: "id", employeesOnly: true });
    await add(t.master, [{ name: "Asha Rao", empId: "E101" }]);
    expect(await j(await who("WHO-1", { empId: "", consent: consentFor("K4") }))).toEqual({ known: false });
  });
});
