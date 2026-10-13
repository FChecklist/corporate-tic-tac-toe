// An AI key (the organizer's, or a co-host's link) never receives a participant's name or mobile number, on any route it can read. The owner's console still can.
import { beforeEach, describe, expect, test } from "bun:test";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { manualJson, manualText } from "../src/ai-link";
import { sealPii } from "../src/pii";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const ORIGIN = "https://bingo.test";
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: ORIGIN, DATA_KEY: "test-data-key" }; });

const PLANTED = [{ name: "Plantina Zyxwvu", phone: "9123456789" }, { name: "Rosterio Quuxbar", phone: "9345678901" }, { name: "Winnerella Blorptag", phone: "9456789012" }];
const needles = () => PLANTED.flatMap((p) => [p.name, p.name.split(" ")[0]!, p.phone, p.phone.slice(-4), "XXXXXXXX" + p.phone.slice(-2), p.phone.replace(/(\d{5})(\d{5})/, "$1 $2")]);

async function setup() {
  const x = await j(await call("POST", "/api/start", { email: "boss@acme.com" }, { "cf-connecting-ip": "1.1.1.1" }));
  const h = { "x-organizer": x.token as string };
  await call("POST", "/api/z", { id: "PLANT-1", startRound: roundAt(T) + 1200, callSeconds: 6, cap: 100 }, h);
  await call("POST", "/api/z/PLANT-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, h);
  await call("POST", "/api/z/PLANT-1/join", { phone: PLANTED[0]!.phone, name: PLANTED[0]!.name });
  await call("POST", "/api/z/PLANT-1/roster", { people: [PLANTED[1]] }, h); // the owner loads a list in the console
  const sealed = await sealPii(env as any, { phone: PLANTED[2]!.phone, name: PLANTED[2]!.name });
  raw.prepare("INSERT INTO prize(eid,round,pattern,ordinal,seat,pii,orig,trail,confirmed_ms) VALUES('PLANT-1',1,'blackout',1,1,?,?,?,?)").run(sealed, sealed, null, T);
  const host = await j(await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, h));
  return { h, ai: x.aiKey as string, host: host.hostKey as string };
}

describe("no AI-readable route returns a name or a mobile number", () => {
  test("the planted identifiers are really stored (sanity), and the owner's console can read them", async () => {
    const o = await setup();
    const names = JSON.stringify(await j(await call("GET", "/api/z/PLANT-1/names?pids=" + (await j(await call("GET", "/api/z/PLANT-1/participants", undefined, o.h))).participants.map((p: any) => p.pid).join(","), undefined, o.h)));
    expect(names).toContain("Plantina"); expect(JSON.stringify(await j(await call("GET", "/api/z/PLANT-1/prizes", undefined, o.h)))).toContain("Winnerella");
  });
  for (const role of ["ai", "host"] as const) test(`${role === "ai" ? "organizer's AI link" : "co-host's AI link"}: every readable address in its own manual, plus the manifest, the manual and the audit trail, is free of the planted names and numbers`, async () => {
    const o = await setup(); const key = role === "ai" ? o.ai : o.host;
    const man = manualJson(ORIGIN, key, role, T); const bodies: string[] = [JSON.stringify(man), manualText(ORIGIN, key, role, T)];
    for (const e of man.endpoints.filter((x) => x.method === "GET")) {
      const path = e.url.replace(ORIGIN, "").replace("{id}", "PLANT-1").replace("%7Bid%7D", "PLANT-1");
      const r = await call("GET", path); expect([path, r.status < 500]).toEqual([path, true]); bodies.push(await r.text());
    }
    for (const extra of ["/z/PLANT-1/summary", "/z/PLANT-1/info", "/z/PLANT-1/participants?limit=200&offset=0", "/z/PLANT-1/prizes", "/z/PLANT-1/results", "/z/PLANT-1/claims", "/z/PLANT-1/life", "/z/PLANT-1/reportlink", "/z/PLANT-1/names?pids=1", "/org/ai/audit", "/z/ai-manifest"]) bodies.push(await (await call("GET", `/ai/${key}${extra}`)).text());
    bodies.push(await (await call("GET", "/api/z/ai-manifest", undefined, { "x-organizer": key })).text());
    bodies.push(await (await call("GET", `/ai/${key}?format=json`)).text());
    const all = bodies.join("\n");
    for (const n of needles()) expect([role, n, all.includes(n)]).toEqual([role, n, false]);
    expect(bodies.length).toBeGreaterThan(12);
  });
  test("an AI cannot send names or numbers either: roster, and mark/unbind by mobile number, are refused with a plain explanation", async () => {
    const o = await setup();
    for (const [m, p, b] of [["POST", "/z/PLANT-1/roster", { people: [{ phone: "9000000000", name: "Z" }] }], ["POST", "/z/PLANT-1/mark", { phone: PLANTED[0]!.phone, role: "host" }], ["POST", "/z/PLANT-1/unbind", { phone: PLANTED[0]!.phone }]] as const) {
      const r = await call(m, `/ai/${o.ai}${p}`, b); expect(r.status).toBe(403); expect(await r.text()).toMatch(/console/);
    }
    expect((raw.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid='PLANT-1'").get() as any).c).toBe(2); // nothing was added
    expect((await call("POST", `/ai/${o.ai}/z/PLANT-1/mark`, { seat: 1, role: "host" })).status).toBe(200); // by ticket number it works
    expect((await call("POST", `/ai/${o.ai}/z/PLANT-1/unbind`, { seat: 1 })).status).toBe(200);
  });
  test("the manual tells the AI that the owner loads the list in the console, and still teaches the same conversation", () => {
    const t = manualText(ORIGIN, "cba_" + "a".repeat(48), "ai", T);
    expect(t).toMatch(/the owner loads their list in the Participants card/); expect(t).toMatch(/names and mobile numbers never pass through you/); expect(t).not.toMatch(/roster\?_method|ask them to paste lines like/);
    for (const step of ["A. Greet the owner", "2. THE CONVERSATION", "11. When they say it is ready", "12. Afterwards"]) expect(t).toContain(step);
  });
});

describe("a player asks to see or delete their own data (console only)", () => {
  test("the organizer sees what is held and deletes that one person; the prize record loses its identity; nothing else changes; an AI or co-host cannot", async () => {
    const o = await setup();
    const prize = () => raw.prepare("SELECT pii, orig FROM prize WHERE eid='PLANT-1'").get() as any;
    raw.prepare("UPDATE prize SET seat=(SELECT seq FROM seat WHERE eid='PLANT-1' AND ph IS NOT NULL ORDER BY seq LIMIT 1) WHERE eid='PLANT-1'").run();
    const see = await j(await call("POST", "/api/z/PLANT-1/person", { phone: PLANTED[0]!.phone }, o.h, T + 40 * 86_400_000));
    expect(see).toMatchObject({ ok: true, name: PLANTED[0]!.name }); expect(see.seat).toBeGreaterThan(0);
    for (const hdr of <Record<string, string>[]>[{ "x-organizer": o.ai }, { "x-organizer": o.host, "x-cb-link": "1" }, { "x-organizer": ((await j(await call("POST", "/api/org/cohost", {}, o.h))).cohostKey) }, {}]) for (const act of ["person", "forget"]) expect((await call("POST", `/api/z/PLANT-1/${act}`, { phone: PLANTED[0]!.phone }, hdr, T + 40 * 86_400_000)).status).toBe(403);
    expect((await call("POST", `/ai/${o.ai}/z/PLANT-1/forget`, { phone: PLANTED[0]!.phone })).status).toBe(403);
    expect(prize().pii).toBeTruthy();
    const del = await call("POST", "/api/z/PLANT-1/forget", { phone: PLANTED[0]!.phone }, o.h, T + 40 * 86_400_000); expect(del.status).toBe(200);
    expect((await call("POST", "/api/z/PLANT-1/person", { phone: PLANTED[0]!.phone }, o.h, T + 40 * 86_400_000)).status).toBe(404);
    expect((raw.prepare("SELECT COUNT(*) AS c FROM participant WHERE eid='PLANT-1'").get() as any).c).toBe(1); // the other person is untouched
    expect(prize()).toMatchObject({ pii: null, orig: null });
    expect((await call("POST", "/api/z/PLANT-1/forget", { phone: "123" }, o.h)).status).toBe(400);
  });
  test("while the game is running a person cannot be deleted (it would change the game)", async () => {
    const o = await setup(); const run = T + 1200 * 3000 + 5 * 60_000; // five minutes after the first number
    expect((await call("POST", "/api/z/PLANT-1/forget", { phone: PLANTED[0]!.phone }, o.h, run)).status).toBe(409);
  });
});
