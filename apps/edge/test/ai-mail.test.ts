// The AI work link travels ONLY in its own dedicated e-mail, and can be replaced from the console (old link dies at once).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withDevice } from "./device";
import { housekeeping, type Env } from "../src/worker";
import { handle } from "./with-terms";
import { AI_SUBJECT, AI_WARNING, HOST_LINK_SUBJECT, HOST_SUBJECT, HOST_WARNING, aiLinkMail, coHostLinkMail } from "../src/mails";
import { footerText } from "../src/brand";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const ORIGIN = "https://bingo.test";
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const j = async (r: Response) => (await r.json()) as any;
const contact = { email: "boss@acme.com", phone: "98765 43210" };
const mailedKey = (b: string) => b.match(/cba_[0-9a-f]{48}/)![0];
const outbox = () => raw.prepare("SELECT to_addr, subject, body FROM outbox ORDER BY id").all() as { to_addr: string; subject: string; body: string }[];
const LEAK = /cba_[0-9a-f]|cbh_[0-9a-f]|\/ai\//;
const DEDICATED = new Set([AI_SUBJECT, HOST_SUBJECT, HOST_LINK_SUBJECT]); // HOST_LINK_SUBJECT: the Host's OWN console link, e-mailed to the Host only

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: ORIGIN, DATA_KEY: "test-data-key" };
});

async function organizer() {
  const x = await j(await call("POST", "/api/start", { email: "boss@acme.com" }, { "cf-connecting-ip": "1.1.1.1" }));
  return { h: { "x-organizer": x.token as string }, ai: x.aiKey as string, msg: x.aiMessage as string };
}

describe("the dedicated mail builders", () => {
  const KEY = "cba_" + "ab".repeat(24);
  test("organizer mail: own subject, warning at the top and the bottom, plain-text part, numbered steps, the paste as plain text (no hyperlink)", () => {
    const m = aiLinkMail(ORIGIN, KEY, "start", T + 86_400_000);
    expect(m.subject).toBe(AI_SUBJECT); expect(m.subject).toMatch(/personal AI work link/i);
    expect(AI_WARNING).toBe("DO NOT FORWARD: this email holds your personal AI work link"); expect(AI_WARNING.length).toBeLessThan(70); // one line
    expect(m.text.startsWith(AI_WARNING)).toBe(true); expect(m.text.replace(footerText(ORIGIN), "").trim().endsWith(AI_WARNING)).toBe(true); // plain-text part, warning top and bottom
    expect(m.text.split(AI_WARNING).length).toBe(3);
    const h = m.html; const first = h.indexOf(AI_WARNING), last = h.lastIndexOf(AI_WARNING);
    expect(first).toBeGreaterThan(0); expect(last).toBeGreaterThan(first);
    expect(first).toBeLessThan(h.indexOf("<h1")); expect(last).toBeGreaterThan(h.indexOf("WHAT TO DO")); expect(h.split(AI_WARNING).length).toBe(3);
    expect(h).toMatch(/#b71c1c/); // red
    const hrefs = [...h.matchAll(/href\s*=\s*"([^"]*)"/gi)].map((x) => x[1]).filter((h) => !/^mailto:|legal.html$/.test(h!)); expect(hrefs).toEqual([`${ORIGIN}/ai-link.html`]); expect(h).toContain("Show my AI work link"); // the only link is the button to the sign-in page, never the key; the paste box is not a link
    expect(h).toContain(`${ORIGIN}/ai/${KEY}`); // but the text is in the box, to copy
    for (const t of ["ChatGPT", "Claude", "Gemini", "Grok", "DeepSeek", "z.ai"]) { expect(m.text).toContain(t); expect(h).toContain(t); }
    expect(m.text).toMatch(/1\. Copy the box/); expect(m.text).toMatch(/2\. Paste it into any AI chat/); expect(m.text).toMatch(/3\. Answer its questions/); expect(m.text).toMatch(/does the work/);
    for (const t of [/payment/, /publishing/, /erasing/, /pause or stop/, /Replace my AI link/, /stops at once/]) { expect(m.text).toMatch(t); expect(h).toMatch(t); }
    expect(m.text.split(KEY).length).toBe(2); expect(h.split(KEY).length).toBe(2); // the key appears once, inside the paste
    expect(m.text).toContain("MY OWN Corporate Tic Tac Toe account");
  });
  test("a replacement mail says the old link has stopped", () => {
    const m = aiLinkMail(ORIGIN, KEY, "replace", T + 86_400_000);
    expect(m.text).toMatch(/NEW personal AI work link/i); expect(m.text).toMatch(/Every older link stopped at once/);
    expect(m.text).toMatch(/WORKS FOR 24 HOURS ONLY/); expect(m.text).toMatch(/Show my AI work link/i); expect(m.html).toMatch(/WORKS FOR 24 HOURS ONLY/);
  });
  test("co-host mail: whose engagement, a watch and announce role, own warning top and bottom, plain-text part, no hyperlink", () => {
    const k = "cbh_" + "cd".repeat(24), m = coHostLinkMail(ORIGIN, k, "boss@acme.com", T + 86_400_000);
    expect(m.text).toMatch(/WORKS FOR 24 HOURS ONLY/);
    expect(m.subject).toBe(HOST_SUBJECT);
    expect(m.text.startsWith(HOST_WARNING)).toBe(true); expect(m.text.replace(footerText(ORIGIN), "").trim().endsWith(HOST_WARNING)).toBe(true); expect(m.html.split(HOST_WARNING).length).toBe(3);
    expect(m.text).toContain("boss@acme.com"); expect(m.text).toMatch(/watch and announce/i); expect(m.text).toMatch(/host/i);
    expect([...m.html.matchAll(/href\s*=\s*"([^"]*)"/gi)].map((x) => x[1]).filter((h) => !/^mailto:|legal.html$/.test(h!))).toEqual([`${ORIGIN}/zc.html`]); expect(m.text).toContain(`${ORIGIN}/ai/${k}`);
    expect(m.text).toMatch(/cannot change settings/);
  });
});

describe("the AI link is in the dedicated mails and nowhere else", () => {
  test("sign-up sends exactly one mail, the dedicated one; the console shows the same paste", async () => {
    const o = await organizer();
    const sent = outbox();
    expect(sent.length).toBe(1); expect(sent[0]!.to_addr).toBe("boss@acme.com"); expect(sent[0]!.subject).toBe("[Tic Tac Toe] " + AI_SUBJECT);
    expect(sent[0]!.body.startsWith(AI_WARNING)).toBe(true); expect(sent[0]!.body).toMatch(/WORKS FOR 24 HOURS ONLY/);
    expect(sent[0]!.body).not.toContain(o.ai); expect(sent[0]!.body).not.toContain(o.msg); // the lasting key stays in the console; the mail has its own 24-hour key
    const mk = mailedKey(sent[0]!.body); expect(mk).not.toBe(o.ai); expect((await call("GET", `/ai/${mk}`)).status).toBe(200);
  });
  test("publish, reminder, could-not-begin and every other mail of a full unpaid lifecycle carry no AI link; only the dedicated mails do", async () => {
    const { h } = await organizer();
    await call("POST", "/api/z", { id: "MAIL-1", startRound: roundAt(T + 30 * 3_600_000), callSeconds: 6, cap: 500 }, h);
    expect((await call("POST", "/api/z/MAIL-1/publish", contact, h)).status).toBe(200);
    expect((await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, h)).status).toBe(200);
    expect((await call("POST", "/api/org/ai/replace", {}, h)).status).toBe(200);
    await housekeeping(env as Env, T + 86_400_000); // payment reminder
    await call("GET", "/api/z/MAIL-1/info", undefined, {}, T + 40 * 3_600_000); // start passed unpaid: the "could not begin" mail
    const sent = outbox(); const subjects = sent.map((m) => m.subject);
    expect(subjects.some((s) => /published/i.test(s))).toBe(true); expect(subjects.some((s) => /^\[Tic Tac Toe\] Payment pending for your game/.test(s))).toBe(true); expect(subjects.some((s) => /could not begin/i.test(s))).toBe(true);
    for (const m of sent) {
      if (DEDICATED.has(m.subject.replace("[Tic Tac Toe] ", ""))) { expect(m.body).toMatch(LEAK); continue; }
      expect(m.body + "\n" + m.subject).not.toMatch(LEAK); // forwardable
    }
    expect(sent.filter((m) => m.subject === "[Tic Tac Toe] " + AI_SUBJECT).length).toBe(2); // sign-up and replace
    expect(sent.filter((m) => m.subject === "[Tic Tac Toe] " + HOST_SUBJECT).length).toBe(1);
    const pub = sent.find((m) => /published/i.test(m.subject))!;
    expect(pub.body).toContain("/z.html?e=MAIL-1"); expect(pub.body).toContain("/pay.html?e=MAIL-1");
    expect(pub.body).not.toMatch(/AI work link|Option 1|\/ai\//);
  });
  test("no other source that builds a mail, a PDF, a report or a guest page can carry an AI link", () => {
    const root = join(import.meta.dir, "..", "..", "..");
    const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
    const edge = readdirSync(join(root, "apps/edge/src")).filter((f) => f.endsWith(".ts") && !["ai-link.ts", "ai-facts.ts", "ai-functions.ts", "ai-go.ts", "trust-page.ts", "mails.ts", "worker.ts", "local.ts"].includes(f));
    for (const f of edge) expect(read("apps/edge/src", f)).not.toMatch(/aiPaste|aiMessage|aiLinkMail|coHostLinkMail|cba_|cbh_|\/ai\//);
    const pages = ["report.html", "report.js", "reportgen.js", "z.html", "z.js", "zgame.js", "big.html", "big.js", "play.html", "play.js", "pay.html", "pay.js", "partner.html", "partner.js", "screen.js"];
    for (const f of pages) { let t = ""; try { t = read("apps/web/public", f); } catch { continue; } expect(t).not.toMatch(/cba_|cbh_|\/ai\/|aiMessage/); }
    const w = read("apps/edge/src/worker.ts");
    expect(w).not.toMatch(/aiMailBody/); expect((w.match(/aiLinkMail\(/g) ?? []).length).toBe(1); expect((w.match(/coHostLinkMail\(/g) ?? []).length).toBe(1); // start + replace; co-host creation
  });
});

describe("Replace my AI link", () => {
  test("the signed-in organizer replaces it: the old link answers 404 at once, the new one works, the new link is e-mailed, and the call is audited", async () => {
    const o = await organizer();
    expect((await call("GET", `/ai/${o.ai}`)).status).toBe(200);
    const r = await call("POST", "/api/org/ai/replace", {}, o.h); const x = await j(r);
    expect(r.status).toBe(200); expect(x.aiKey).toMatch(/^cba_[0-9a-f]{48}$/); expect(x.aiKey).not.toBe(o.ai); expect(x.mailed).toBe(true);
    expect(x.aiMessage).toContain(`/ai/${x.aiKey}`); expect(x.aiMessage.split("\n").length).toBe(2);
    expect((await call("GET", `/ai/${o.ai}`)).status).toBe(404); expect((await call("GET", `/ai/${o.ai}/whoami`)).status).toBe(404);
    expect((await call("GET", "/api/whoami", undefined, { "x-organizer": o.ai })).status).toBe(403);
    expect((await call("GET", `/ai/${x.aiKey}`)).status).toBe(200); expect(await j(await call("GET", `/ai/${x.aiKey}/whoami`))).toEqual({ kind: "ai" });
    const last = outbox().at(-1)!; expect(last.subject).toBe("[Tic Tac Toe] " + AI_SUBJECT); expect(last.body).toMatch(/NEW personal AI work link/i);
    expect(last.body).not.toContain(x.aiKey); expect(last.body).not.toContain(o.ai); // the mail carries its own 24-hour key, not the lasting one
    const mk = mailedKey(last.body); expect(mk).not.toBe(x.aiKey); expect((await call("GET", `/ai/${mk}`)).status).toBe(200);
    const rows = raw.prepare("SELECT method, path, status FROM ai_audit WHERE path='/api/org/ai/replace'").all() as any[];
    expect(rows).toEqual([{ method: "POST", path: "/api/org/ai/replace", status: 200 }]);
    expect(JSON.stringify(raw.prepare("SELECT * FROM ai_audit").all())).not.toContain(x.aiKey);
  });
  test("the old route /api/org/ai does the same (mints a fresh link, kills the old one)", async () => {
    const o = await organizer();
    const x = await j(await call("POST", "/api/org/ai", {}, o.h));
    expect((await call("GET", `/ai/${o.ai}`)).status).toBe(404); expect((await call("GET", `/ai/${x.aiKey}`)).status).toBe(200); expect(x.mailed).toBe(true);
  });
  test("an AI key, a co-host key, the platform key and strangers cannot replace it", async () => {
    const o = await organizer();
    const hk = await j(await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h));
    for (const hdr of <Record<string, string>[]>[{ "x-organizer": o.ai }, { "x-organizer": hk.hostKey }, { "x-organizer": "plat" }, {}, { "x-organizer": "cba_" + "0".repeat(48) }])
      for (const path of ["/api/org/ai/replace", "/api/org/ai"]) expect((await call("POST", path, {}, hdr)).status).toBe(403);
    expect((await call("POST", `/ai/${o.ai}/org/ai/replace`, {})).status).toBe(403); // not through the AI link either
    expect((await call("POST", `/ai/${o.ai}/org/ai`, {})).status).toBe(403);
    expect((await call("GET", `/ai/${o.ai}`)).status).toBe(200); // nothing was replaced
  });
  test("an organizer with no known e-mail address still gets the new paste in the console (mailed: false)", async () => {
    const mk = await j(await call("POST", "/api/org", {}, { "x-organizer": "plat" })); // minted by the platform: no sign-up e-mail
    const x = await j(await call("POST", "/api/org/ai/replace", {}, { "x-organizer": mk.organizerKey }));
    expect(x.ok).toBe(true); expect(x.mailed).toBe(false); expect((await call("GET", `/ai/${x.aiKey}`)).status).toBe(200); expect(outbox().length).toBe(0);
  });
  test("a co-host key made later is e-mailed to the organizer in its own mail", async () => {
    const o = await organizer();
    const hk = await j(await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, o.h)); expect(hk.mailed).toBe(true);
    const m = outbox().at(-1)!; expect(m.subject).toBe("[Tic Tac Toe] " + HOST_SUBJECT); expect(m.to_addr).toBe("boss@acme.com"); expect(m.body).not.toContain(hk.hostKey); expect(m.body).toContain("boss@acme.com"); expect(m.body).toMatch(/WORKS FOR 24 HOURS ONLY/);
    const ck = m.body.match(/cbh_[0-9a-f]{48}/)![0]; expect(ck).not.toBe(hk.hostKey); expect((await call("GET", `/ai/${ck}`)).status).toBe(200); expect((await call("GET", `/ai/${hk.hostKey}`)).status).toBe(200);
  });
});

describe("opening the manual never changes anything", () => {
  test("GET and HEAD on /ai/<key> (a mail scanner or a chat AI) leave keys, engagements, people and mail untouched", async () => {
    const o = await organizer();
    await call("POST", "/api/z", { id: "SAFE-1", startRound: roundAt(T) + 1200, callSeconds: 6, cap: 100 }, o.h);
    const snap = () => {
      const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('ai_audit','sqlite_sequence')").all() as { name: string }[]).map((t) => t.name).sort();
      return JSON.stringify(tables.map((n) => [n, raw.prepare(n === "kv" ? `SELECT * FROM kv WHERE k NOT LIKE 'seen/%'` : `SELECT * FROM "${n}"`).all()])); // the only bookkeeping a read leaves is the unfamiliar-use baseline (seen/) and the audit line
    };
    const before = snap();
    for (let i = 0; i < 3; i++) {
      expect((await call("GET", `/ai/${o.ai}`)).status).toBe(200);
      expect((await call("GET", `/ai/${o.ai}?format=json`)).status).toBe(200);
      expect((await call("HEAD", `/ai/${o.ai}`)).status).toBe(200);
    }
    expect(snap()).toBe(before);
    expect((await call("GET", `/ai/${o.ai}`)).status).toBe(200); // still the same working link
  });
});

describe("sending", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });
  test("the service gets both an HTML and a plain-text part; a mail that could not be sent keeps no body (nothing with a key is retried later)", async () => {
    const calls: any[] = []; let ok = true;
    globalThis.fetch = (async (_u: any, init: any) => { calls.push(JSON.parse(init.body)); return new Response("{}", { status: ok ? 200 : 500 }); }) as any;
    env.RESEND_API_KEY = "re_test";
    await organizer();
    expect(calls.length).toBe(1); expect(calls[0].subject).toBe("[Tic Tac Toe] " + AI_SUBJECT); expect(calls[0].html).toContain("<h1"); expect(calls[0].text).toContain(AI_WARNING); expect(calls[0].html).toContain(AI_WARNING);
    ok = false;
    const mk = await j(await call("POST", "/api/start", { email: "second@acme.com" }, { "cf-connecting-ip": "2.2.2.2" }));
    expect(mk.aiKey).toMatch(/^cba_/);
    const failed = raw.prepare("SELECT body, sent FROM outbox WHERE to_addr='second@acme.com'").get() as any;
    expect(failed).toEqual({ body: "", sent: 0 }); expect(JSON.stringify(raw.prepare("SELECT * FROM outbox").all())).not.toContain(mk.aiKey);
  });
});
