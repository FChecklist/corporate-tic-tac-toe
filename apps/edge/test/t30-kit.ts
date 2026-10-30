// Test author helper (30 Oct 2026): one in-memory Worker world per test, with a chosen clock. Fake data only (demoN@demo-test.invalid, fake mobiles).
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";
import { EMP_CLEAN_FROM_MS } from "../src/ids";

export const GEN = 1692803367;
export const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
/** Before EMP_CLEAN_FROM_MS (31 Oct 2026 UTC): a game created at this time keeps the OLD employee-ID rule. */
export const T_OLD = EMP_CLEAN_FROM_MS - 30 * 86_400_000 + 10 * 3_600_000;
/** After it: a game created at this time uses the NEW cleaner. */
export const T_NEW = EMP_CLEAN_FROM_MS + 5 * 86_400_000 + 10 * 3_600_000; // follows the coder's deploy instant, so changing EMP_CLEAN_FROM_MS does not break the tests
export const mob = (i: number) => "9" + String(100000000 + i);
export const dev = (i: number) => (String(i).padStart(2, "0") + "b".repeat(32)).slice(0, 32);
export const j = async (r: Response) => (await r.json()) as any;

export function world(T: number, extra: Record<string, string> = {}) {
  const d = makeD1(); const raw = d.raw; let ipN = 0;
  const env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000000", PUBLIC_ORIGIN: "https://tictactoe.test", PHONE_SALT: "salt", ...extra } as unknown as PayEnv;
  const realFetch = globalThis.fetch; (globalThis as any).fetch = async () => new Response("{}", { status: 404 });
  const w: any = { env, raw, now: T, realFetch, restore: () => { globalThis.fetch = realFetch; },
    call: (method: string, path: string, body?: unknown, key?: string, now = w.now, ip?: string) =>
      handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": ip ?? `7.7.${(ipN >> 8) & 255}.${ipN & 255}`, ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env as Env, now),
    /** a new Organizer account (demoN@demo-test.invalid) -> master key */
    async organizer(n = 1) { ipN++; const r = await j(await w.call("POST", "/api/start", { email: `demo${n}@demo-test.invalid` })); return r.token as string; },
    /** a published game; opts go to PATCH settings */
    async game(id: string, opts: { who?: "list"; verify?: string; employeesOnly?: boolean; cap?: number; settings?: Record<string, unknown>; n?: number } = {}) {
      const key = await w.organizer(opts.n ?? 1);
      const start = roundAt(w.now) + 1200;
      const c = await w.call("POST", "/api/z", { id, startRound: start, callSeconds: 6, cap: opts.cap ?? 100, ...(opts.who ? { whoCanJoin: opts.who } : {}) }, key);
      if (c.status !== 200) throw new Error("create " + c.status + " " + (await c.text()));
      const p = await w.call("POST", `/api/z/${id}/publish`, { email: "demo90@demo-test.invalid", phone: "98765 43210" }, key); if (p.status !== 200) throw new Error("publish " + p.status);
      const body = { ...(opts.verify ? { verify: opts.verify } : {}), ...(opts.employeesOnly !== undefined ? { employeesOnly: opts.employeesOnly } : {}), ...(opts.settings ?? {}) };
      if (Object.keys(body).length) { const s = await w.call("PATCH", `/api/z/${id}/settings`, body, key); if (s.status !== 200) throw new Error("settings " + s.status + " " + (await s.text())); }
      return { id, key, start };
    },
    join: (id: string, body: Record<string, unknown>, now = w.now) => w.call("POST", `/api/z/${id}/join`, body, undefined, now),
  };
  return w;
}
