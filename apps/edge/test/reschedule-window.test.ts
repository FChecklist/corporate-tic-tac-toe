// Paid per game, no refund; a paid game can be moved to any date within 365 days from the day of payment; a game not yet paid stays capped at 30 days.
import { beforeEach, describe, expect, test } from "bun:test";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { RESCHEDULE_WINDOW_MS } from "../src/cancel";
import { MAX_AHEAD_MS, PAID_WINDOW_MS } from "../src/lifecycle";
import { makeD1 } from "./d1-sqlite";

const DAY = 86_400_000, GEN = 1692803367;
const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
let env: Env; let raw: ReturnType<typeof makeD1>["raw"]; let ip = 0;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", "cf-connecting-ip": `6.6.6.${++ip}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
const j = async (r: Response) => (await r.json()) as any;
beforeEach(() => { const d = makeD1(); raw = d.raw; ip = 0; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000000", PUBLIC_ORIGIN: "https://ttt.test", PHONE_SALT: "salt", DATA_KEY: "k" } as Env; });

async function game(id: string, paidAt: number | null) {
  const o = await j(await call("POST", "/api/start", { email: `o${ip}@acme.com` })); const h = { "x-organizer": o.token as string };
  expect((await call("POST", "/api/z", { id, startRound: roundAt(T + 10 * DAY), callSeconds: 6, cap: 100 }, h)).status).toBe(200);
  if (paidAt !== null) {
    raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]);
    raw.run("INSERT INTO payment(id,org,email,pack,currency,amount,tax,status,created_ms,paid_ms,meta,eid) VALUES('pay_w1','o','b@acme.com',100,'INR',100,0,'paid',?,?,'{}',?)", [paidAt, paidAt, id]);
  }
  return h;
}
const move = (h: Record<string, string>, id: string, atMs: number, now = T + 5 * DAY) => call("PATCH", `/api/z/${id}/settings`, { startRound: roundAt(atMs) }, h, now);

describe("the paid window is 365 days from payment", () => {
  test("the constants: 365 days for a paid game and a cancelled paid game, 30 days for a game that is not paid", () => {
    expect(PAID_WINDOW_MS).toBe(365 * DAY); expect(RESCHEDULE_WINDOW_MS).toBe(365 * DAY); expect(MAX_AHEAD_MS).toBe(30 * DAY);
  });
  test("a paid game can be moved to day 364 after payment (counted from the payment, not from today) and not to day 366", async () => {
    const h = await game("WIN-1", T);
    const now = T + 5 * DAY; // today is days after the payment: the window still ends 365 days after the payment
    expect((await move(h, "WIN-1", T + 364 * DAY, now)).status).toBe(200);
    expect((raw.query("SELECT start_round FROM engagement WHERE id='WIN-1'").get() as any).start_round).toBe(roundAt(T + 364 * DAY));
    const late = await move(h, "WIN-1", T + 366 * DAY, now); expect(late.status).toBe(400); const b = await j(late);
    expect(b.code).toBe("too-far"); expect(b.error).toContain("365 days of the payment"); expect(b.error).not.toContain("30 days");
    expect((raw.query("SELECT start_round FROM engagement WHERE id='WIN-1'").get() as any).start_round).toBe(roundAt(T + 364 * DAY)); // unchanged by the refusal
  });
  test("a paid game can be moved well past 30 days from today (day 200 from payment)", async () => {
    const h = await game("WIN-2", T);
    expect((await move(h, "WIN-2", T + 200 * DAY)).status).toBe(200);
  });
  test("a game that is not paid stays capped at 30 days from today: day 29 allowed, day 31 refused", async () => {
    const h = await game("WIN-3", null);
    expect((await move(h, "WIN-3", T + 5 * DAY + 29 * DAY)).status).toBe(200);
    const r = await move(h, "WIN-3", T + 5 * DAY + 31 * DAY); expect(r.status).toBe(400); expect((await j(r)).error).toContain("30 days");
  });
  test("the 365 days follow the day the payment was made: a later payment gives a later last day", async () => {
    const h = await game("WIN-4", T + 50 * DAY);
    expect((await move(h, "WIN-4", T + 50 * DAY + 364 * DAY)).status).toBe(200);
    expect((await move(h, "WIN-4", T + 50 * DAY + 366 * DAY)).status).toBe(400);
  });
  test("no sentence about a 30-day move window is left on the refund pages, the facts or the AI manual", async () => {
    const { readFileSync } = await import("node:fs");
    const files = ["apps/web/public/refund-policy.html", "apps/edge/src/ai-facts.ts", "apps/edge/src/ai-link.ts", "apps/edge/src/ai-functions.ts"].map((f) => readFileSync(new URL("../../../" + f, import.meta.url), "utf8"));
    for (const t of files) {
      expect(/(moved?|reschedul\w*)[^.]{0,80}(within|for|in) 30 days|30 days (after|from) the cancel|within 30 days of the cancel/i.test(t)).toBe(false);
    }
    expect(files[0]).toContain("365 days");
  });
});
