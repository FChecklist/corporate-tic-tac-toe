// AI enablement: this test PLAYS AN OUTSIDE AI. It has only the pasted link, opens only addresses it was given (never builds one), reads only the words it is shown,
// and walks the guided path end to end. It also checks that the list of functions (src/ai-functions.ts) is true: every function behaves the way it is classified
// (the AI does it / the organizer taps once / only the organizer), so the front door, the map, the long manual and the software can never silently disagree again.
import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { handle } from "./with-terms";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";
import { FACTS } from "../src/ai-facts";
import { FUNCTIONS } from "../src/ai-functions";
import { nextHint } from "../src/ai-link";
import { llmsTxt, trustHtml } from "../src/trust-page";

const T = Date.UTC(2026, 9, 1, 10, 0, 0); // Thu 1 Oct 2026, 15:30 India time
const ORIGIN = "https://bingo.test";
let env: PayEnv;
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, T);
const j = async (r: Response) => (await r.json()) as any;
const root = join(import.meta.dir, "..", "..", "..");

beforeEach(() => { const d = makeD1(); env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: ORIGIN, DATA_KEY: "test-data-key" }; });
async function organizer() {
  const x = await j(await call("POST", "/api/start", { email: "boss@acme.com" }, { "cf-connecting-ip": "1.1.1.1" }));
  return { key: x.aiKey as string, token: x.token as string, base: `${ORIGIN}/ai/${x.aiKey}` };
}

// ---- the outside AI's only abilities: open an address it was given, read the text it gets back
const open = async (url: string) => { const u = new URL(url); const r = await call("GET", u.pathname + u.search); return { status: r.status, text: await r.text() }; };
type Choice = { n: number; label: string; url: string; rec: boolean };
const choicesOf = (t: string): Choice[] => {
  const out: Choice[] = []; const lines = t.split("\n");
  for (let i = 0; i < lines.length; i++) { const m = /^(\d+)\. (.*?)(  \(recommended\))?$/.exec(lines[i]!); const l = /^\s+LINK: (\S+)$/.exec(lines[i + 1] ?? ""); if (m && l) out.push({ n: Number(m[1]), label: m[2]!, url: l[1]!, rec: !!m[3] }); }
  return out;
};
/** Follows the choice whose label matches, exactly as an AI would after the organizer picked it. Every address it follows must have been given to it. */
const given = new Set<string>();
async function pick(from: string, label: RegExp) {
  const cs = choicesOf(from); for (const c of cs) given.add(c.url);
  const c = cs.find((x) => label.test(x.label)); if (!c) throw new Error(`no choice matching ${label} in:\n${from}`);
  expect(given.has(c.url)).toBe(true); expect(c.url.length).toBeLessThan(250); // short enough for any chatbot, and one the AI was handed
  const r = await open(c.url); expect(r.status).toBe(200); return r.text;
}

describe("the front door", () => {
  test("a chatbot that reads only the first screen still gets the rules, the starting links and all 10 facts, in the owner's words", async () => {
    const o = await organizer(); const full = (await open(o.base)).text; const first = full.slice(0, 7000);
    expect(first).toMatch(/START HERE \(the organizer's AI assistant\)/); expect(first).toMatch(/Open ONLY the links you are given/); expect(first).toMatch(/Never invent an address/);
    for (const step of ["go/new", "go/games", "facts", "map"]) expect(first).toContain(`${o.base}/${step}`);
    expect(first).toContain(`${ORIGIN}/demo.html`);
    for (const f of FACTS) expect(first).toContain(f.say); // every fact, word for word
    expect(first).toMatch(/CANNOT/); expect(first).toMatch(/tap ONCE/);
    expect(full).toMatch(/LONG REFERENCE MANUAL/); // the old manual is still there, below
  });
  test("/start is the short front door alone; /facts has the 10 facts and the rules for using them; /map lists every function", async () => {
    const o = await organizer(); const s = (await open(`${o.base}/start`)).text; expect(s.length).toBeLessThan(8000); expect(s).not.toMatch(/LONG REFERENCE MANUAL/);
    const f = (await open(`${o.base}/facts`)).text; for (const x of FACTS) expect(f).toContain(x.say); expect(f).toMatch(/Never say best/); expect(f).toContain(`${ORIGIN}/trust.html`);
    const m = (await open(`${o.base}/map`)).text; for (const fn of FUNCTIONS) expect(m).toContain(fn.name);
    const mj = JSON.parse((await open(`${o.base}/map?format=json`)).text); expect(mj.functions.length).toBe(FUNCTIONS.length);
    expect(m).not.toMatch(/cbk_/);
  });
  test("a co-host's AI link gets a short front door of its own and cannot use the organizer's guided path or map", async () => {
    const o = await organizer(); const hk = await j(await call("POST", "/api/org/host", { email: "host@acme.com", mobile: "9876500009" }, { "x-organizer": o.token })); const hb = `${ORIGIN}/ai/${hk.hostKey}`;
    expect((await open(`${hb}/start`)).text).toMatch(/Host's AI assistant/);
    expect((await open(`${hb}/go/new`)).status).toBe(403); expect((await open(`${hb}/map`)).status).toBe(403);
  });
});

describe("the guided path, followed like an outside AI", () => {
  test("a second game on the same day gets its own code, never overwriting the first", async () => {
    const o = await organizer();
    const run = async () => { let t = (await open(`${o.base}/go/new`)).text; t = await pick(t, /^India time/); t = await pick(t, /^Tomorrow/); t = await pick(t, /^4 pm/); t = await pick(t, /Diwali/); t = await pick(t, /Up to 100/); t = await pick(t, /Looks good/); t = await pick(t, /^Simple/); t = await pick(t, /No lucky draw/); return pick(t, /Yes, save/); };
    expect(await run()).toMatch(/code is DIWALI-1002\./); expect(await run()).toMatch(/code is DIWALI-1002-2\./);
  });
  test("existing game: only games not yet started are listed; change the time, links, who joined, helper link, message (after publishing only), and the one-tap hand-overs", async () => {
    const o = await organizer(); given.clear();
    let t = (await open(`${o.base}/go/new`)).text; t = await pick(t, /^India time/); t = await pick(t, /^Tomorrow/); t = await pick(t, /^4 pm/); t = await pick(t, /Diwali/); t = await pick(t, /Up to 100/); t = await pick(t, /Looks good/); t = await pick(t, /^Classic/); t = await pick(t, /No lucky draw/); await pick(t, /Yes, save/);
    const start = (await open(`${o.base}/go`)).text;
    let g = await pick(start, /Change a game that has not started/); expect(g).toMatch(/DIWALI-1002/); expect(g).toMatch(/\(draft\)/);
    g = await pick(g, /DIWALI-1002/); expect(g).toMatch(/Game DIWALI-1002: draft/); expect(g).toMatch(/Publish \(free\)/);
    const menu = g; expect(menu).not.toMatch(/Send a message to every guest/); // nobody can see a draft
    expect(choicesOf(menu).find((c) => /Erase all guest data/.test(c.label))!.url).toBe(`${ORIGIN}/zc.html?e=DIWALI-1002&do=erase`);
    expect(choicesOf(menu).find((c) => /Pause or stop/.test(c.label))!.url).toBe(`${ORIGIN}/zc.html?e=DIWALI-1002&do=pause`);
    const links = await pick(menu, /Show the links/); expect(links).toContain(`${ORIGIN}/zc.html?e=DIWALI-1002`); expect(links).toMatch(/appear after you publish/);
    expect(await pick(menu, /How many have joined/)).toMatch(/0 people have joined DIWALI-1002/);
    const helper = await pick(menu, /Host link/); expect(helper).toMatch(/only the owner enters those, in the console/); expect(helper).not.toMatch(/#host=cbh_/); // the AI never handles a Host's mobile number or e-mail
    let c = await pick(menu, /Change the day or time/); c = await pick(c, /Sat 3 Oct/); expect(c).toMatch(/At what time/); c = await pick(c, /^7 pm/);
    expect(c).toMatch(/Done\. DIWALI-1002 now starts on/); expect(c).toMatch(/7 pm \(Asia\/Kolkata/);
    expect((await j(await call("GET", `/ai/${o.key}/z/DIWALI-1002/summary`))).startMs).toBe(Date.UTC(2026, 9, 3, 13, 30)); // 7 pm India time on Sat 3 Oct
    expect((await open(`${o.base}/go/say?id=DIWALI-1002`)).text).toMatch(/only after you publish/); // a draft cannot send messages
  });
  test("a bad or missing step falls back to a safe screen, never an error page; a stale start time is refused kindly", async () => {
    const o = await organizer();
    expect((await open(`${o.base}/go/nonsense`)).text).toMatch(/That step does not exist/);
    expect((await open(`${o.base}/go/time?z=in`)).text).toMatch(/Which day/); expect((await open(`${o.base}/go/time`)).text).toMatch(/Which time zone/); // time asked without a day: back to the day
    const past = (await open(`${o.base}/go/save?d=2026-09-01&t=1600&o=diwali&c=100`)).text; expect(past).toMatch(/already passed/);
    expect((await j(await call("GET", `/ai/${o.key}/history`))).engagements.length).toBe(0);
  });
});

describe("every function in the list does what the list says", () => {
  test("each function has a check here, and each check proves the classification: AI does it, organizer taps once, or only the organizer", async () => {
    const o = await organizer(); const B = `/ai/${o.key}`; const ID = "FN-TEST-1"; const FUT = Math.floor((T / 1000 - 1692803367) / 3) + 1 + 4000;
    const A = (m: string, p: string, b?: unknown) => call(m, `${B}/${p}`, b);
    const checks: Record<string, () => Promise<void>> = {
      facts: async () => { expect((await open(`${o.base}/facts`)).status).toBe(200); },
      demo: async () => { expect(existsSync(join(root, "apps/web/public/demo.html"))).toBe(true); },
      "new-game": async () => { const r = await A("POST", "z", { id: ID, startRound: FUT, callSeconds: 9, cap: 100 }); expect(r.status).toBe(200); expect((await j(r)).draft).toBe(true); },
      "list-games": async () => { expect((await j(await A("GET", "history"))).engagements.map((e: any) => e.id)).toContain(ID); },
      "read-game": async () => { const s = await j(await A("GET", `z/${ID}/summary`)); expect(s.links.console).toContain(ID); expect(s.nextSteps.length).toBe(4); },
      "change-time": async () => { const s = await j(await A("GET", "z/schedule?at=2026-10-20T16:00:00%2B05:30")); expect(s.ok).toBe(true); expect((await A("PATCH", `z/${ID}/settings`, { startRound: s.startRound })).status).toBe(200); },
      "size-speed": async () => { expect((await A("PATCH", `z/${ID}/settings`, { cap: 150, callSeconds: 12 })).status).toBe(200); },
      "tickets-rounds": async () => { expect((await A("PATCH", `z/${ID}/settings`, { tickets: 2, rounds: 2 })).status).toBe(200); },
      prizes: async () => { expect((await A("PATCH", `z/${ID}/settings`, { rewards: [{ pattern: "third", ordinal: 1, text: "Voucher" }] })).status).toBe(200); },
      "brand-moments": async () => { const r = await j(await A("PATCH", `z/${ID}/settings`, { opening: [{ kind: "speech", title: "Welcome" }], breaks: [{ kind: "speech", title: "A word" }, { kind: "lucky", title: "Lucky draw: watch", winners: 1 }], closing: [{ kind: "speech", title: "Thanks" }] })); expect(r.breaks.map((b: any) => b.after)).toEqual([25, 50]); },
      invites: async () => { expect((await A("PATCH", `z/${ID}/settings`, { closed: true, invites: { on: true, per: 4, cats: ["family"] } })).status).toBe(200); },
      "guest-list": async () => { const r = await A("POST", `z/${ID}/roster`, { people: [{ name: "Ravi", phone: "9876543210" }] }); expect(r.status).toBe(403); const b = await j(r); expect(b.error).toMatch(/owner/); expect(b.next).toMatch(/console/); expect(JSON.stringify(b)).not.toContain(o.key); },
      "reuse-list": async () => { await A("POST", "z", { id: "FN-TEST-2", startRound: FUT, callSeconds: 9, cap: 100 }); const r = await A("POST", `z/FN-TEST-2/reuse`, { from: ID }); expect(r.status).not.toBe(403); expect(r.status).not.toBe(404); },
      publish: async () => { const r = await j(await A("POST", `z/${ID}/publish`, {})); expect(r.needsOrganizer).toBe(true); expect(r.consoleUrl).toContain(ID); },
      pay: async () => { expect(existsSync(join(root, "apps/web/public/pay.html"))).toBe(true); expect((await A("POST", `z/${ID}/checkout`, {})).status).not.toBe(200); },
      links: async () => { const s = await j(await A("GET", `z/${ID}/summary`)); expect(s.links.testBrandMoment).toBe(`${ORIGIN}/preview.html`); },
      helpers: async () => { const r = await A("POST", "org/host", { email: "host@acme.com", mobile: "9876500009" }); expect(r.status).toBe(403); expect((await j(r)).error).toMatch(/console/); expect((await A("POST", "org/cohost", { label: "Ravi", phone: "9876500002", e: ID })).status).toBe(403); },
      people: async () => { for (const [m, p] of [["GET", `z/${ID}/people`], ["POST", `z/${ID}/people`], ["GET", `z/${ID}/people/export`], ["GET", `z/${ID}/waiting`], ["POST", `z/${ID}/waiting/all`]]) expect((await A(m!, p!, m === "POST" ? { people: [{ name: "X", phone: "9876543210" }], decision: "admit" } : undefined)).status).toBe(403); },
      announce: async () => { const r = await A("POST", `z/${ID}/announce`, { text: "hi" }); expect(r.status).toBe(400); expect((await j(r)).next).toMatch(/publish/i); },
      "who-joined": async () => { const r = await j(await A("GET", `z/${ID}/participants`)); expect(r.total).toBe(0); expect(JSON.stringify(r).replace(/"joinPhone":(true|false)/, "")).not.toMatch(/phone|mobile/i); },
      "mark-seat": async () => { expect((await A("POST", `z/${ID}/mark`, { seat: 1, role: "host" })).status).not.toBe(403); expect((await A("POST", `z/${ID}/unbind`, { seat: 1 })).status).not.toBe(403); expect((await A("POST", `z/${ID}/unbind`, { phone: "9876543210" })).status).toBe(403); /* a phone number is never accepted from an AI */ },
      "pause-stop": async () => { const r = await j(await A("POST", `z/${ID}/control/request`, { action: "pause", note: "x" })); expect(r.ok).toBe(true); expect(r.message).toMatch(/must approve/); },
      results: async () => { expect((await A("GET", `z/${ID}/results`)).status).toBe(200); expect((await A("GET", `z/${ID}/prizes`)).status).toBe(200); },
      "prize-given": async () => { expect((await A("POST", `z/${ID}/prizegiven`, { round: 1, pattern: "third", ordinal: 1, seat: 1, given: true })).status).not.toBe(403); },
      report: async () => { const r = await j(await A("GET", `z/${ID}/reportlink`)); expect(r.url).toBeNull(); expect(r.note).toMatch(/e-mail/); },
      erase: async () => { expect((await A("POST", `z/${ID}/erase`, {})).status).toBe(403); const r = await j(await A("POST", `z/${ID}/control/request`, { action: "erase", note: "x" })); expect(r.ok).toBe(true); },
      audit: async () => { expect((await A("GET", "org/ai/audit")).status).toBe(200); },
      ideas: async () => { expect((await A("POST", "z/suggestions", { kind: "feature", title: "A nicer thing", body: "It would help organizers a lot." })).status).toBe(200); },
      cancel: async () => { expect((await A("POST", `z/${ID}/cancel`, { confirmations: 3 })).status).toBe(403); expect((await A("GET", `z/${ID}/cancel-preview`)).status).toBe(403); expect((await j(await A("GET", `z/${ID}/summary`))).cancelled).toBeUndefined(); },
      credit: async () => { expect((await A("POST", `z/${ID}/pay-with-credit`, {})).status).toBe(403); expect((await A("GET", "org/credit")).status).toBe(403); },
      clone: async () => { expect((await A("POST", `z/${ID}/clone`, {})).status).toBe(403); },
      "sign-in": async () => { expect(existsSync(join(root, "apps/web/public/zc.html"))).toBe(true); expect((await A("POST", "org/ai/replace", {})).status).toBe(403); /* an AI can never mint or retire keys */ },
    };
    expect(Object.keys(checks).sort()).toEqual(FUNCTIONS.map((f) => f.id).sort()); // a function added to the list without a check here fails this test
    for (const f of FUNCTIONS) { try { await checks[f.id]!(); } catch (e: any) { throw new Error(`function "${f.id}" (${f.name}) does not behave as classified (${f.who}): ${e.message}`); } }
  });
  test("every refusal an AI gets also says what to do next, never contains the key, and names the console page for that game", async () => {
    const o = await organizer(); await call("POST", `/ai/${o.key}/z`, { id: "NXT-1", startRound: Math.floor((T / 1000 - 1692803367) / 3) + 1 + 4000, callSeconds: 9, cap: 100 });
    const cases: [string, string, unknown, RegExp][] = [
      ["PATCH", "z/NXT-1/settings", { startRound: 5 }, /schedule/], ["PATCH", "z/NXT-1/settings", { breaks: [{ kind: "speech", title: "x" }] }, /2 or more characters/],
      ["PATCH", "z/NXT-1/settings", { tickets: 1, breaks: [1, 2, 3, 4].map(() => ({ kind: "speech", title: "A word" })) }, /fewer brand moments/], ["POST", "z/NXT-1/erase", {}, /hand-over link/],
      ["GET", "z/NOPE-1/summary", undefined, /history/], ["POST", "z/NXT-1/announce", { text: "hello" }, /publish/i],
      ["PATCH", "z/NXT-1/settings", { breaks: [{ kind: "youtube", title: "Film", mediaUrl: "http://x.com/a" }] }, /https/],
    ];
    for (const [m, p, b, re] of cases) { const r = await call(m, `/ai/${o.key}/${p}`, b); expect(r.status).toBeGreaterThanOrEqual(400); const body = await j(r); expect([p, body.next]).toEqual([p, expect.stringMatching(re)]); expect(JSON.stringify(body)).not.toContain(o.key); }
    expect(nextHint(500, "weird", "B", ORIGIN, "z/NXT-1/summary")).toMatch(/ONCE more/);
  });
});

describe("the third route: any AI that searches the web", () => {
  const pub = (f: string) => readFileSync(join(root, "apps/web/public", f), "utf8");
  test("the public Trust page and llms.txt are exactly what the facts generate, so a person, a search engine and the AI assistant read the same words", () => {
    expect(pub("trust.html")).toBe(trustHtml()); // fails if a fact changes and tools/make-trust.ts was not run
    expect(pub("llms.txt")).toBe(llmsTxt());
    const text = pub("trust.html").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
    for (const f of FACTS) expect(text).toContain(f.say);
    expect(pub("trust.html")).not.toMatch(/<script/i); // plain page: readable by any crawler or AI, no JavaScript needed
    expect(pub("llms.txt")).toContain("https://corporate-tic-tac-toe.pages.dev/trust.html");
  });
  test("the facts never boast: no 'best', '100% safe', 'fully compliant', 'unhackable', 'cheat-proof' or 'certified' as a claim, and the honest limits are present", () => {
    const all = FACTS.map((f) => f.say).join(" ") + " " + llmsTxt();
    expect(all).not.toMatch(/best|100% safe|fully compliant|unhackable|cheat-proof|certified/i);
    expect(all).toMatch(/not a certificate/); expect(all).toMatch(/ISO 27001 or SOC 2/); expect(all).toMatch(/very hard, not impossible/); expect(all).toMatch(/designed to follow/i);
    expect(FACTS.length).toBe(10); expect(new Set(FACTS.map((f) => f.topic)).size).toBe(10); // ten facts, each its own topic
  });
  test("the Trust page and llms.txt are served as public pages (build list, headers, sitemap, not blocked for crawlers)", () => {
    const b = readFileSync(join(root, "pages/build.mjs"), "utf8"); expect(b).toContain('"trust.html"'); expect(b).toContain('"llms.txt"'); expect(b).toContain('["/trust", PLAINCSP, false]'); // indexable: no noindex header
    expect(pub("sitemap.xml")).toContain("/trust.html"); expect(pub("robots.txt")).not.toMatch(/Disallow: \/trust/); expect(pub("robots.txt")).toContain("Disallow: /ai/"); // a key address is never crawled
  });
});
