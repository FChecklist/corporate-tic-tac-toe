// Branding: every e-mail carries the same header (logo + wordmark) and footer (name, support address, legal link); every page has the same title pattern and icons; the name is exactly "Corporate Tic Tac Toe".
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withDevice } from "./device";
import { housekeeping, type Env } from "../src/worker";
import { handle } from "./with-terms";
import * as Mails from "../src/mails";
import { BRAND, footerText, hasFooter, plainToHtml } from "../src/brand";
import { sendMail, sendReportMail, sentReports, type PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
const ORIGIN = "https://bingo.test";
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const roundAt = (ms: number) => Math.floor((ms / 1000 - 1692803367) / 3) + 1;
const root = join(import.meta.dir, "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

beforeEach(() => {
  const d = makeD1(); raw = d.raw;
  env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: ORIGIN, DATA_KEY: "test-data-key", TEST_MODE: "1" };
  sentReports.length = 0;
});
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** One sample call for every exported e-mail builder in mails.ts (a function whose name ends in "Mail"). A NEW builder with no entry here fails the test below, so it cannot ship unchecked. */
const SAMPLES: Record<string, () => Mails.BuiltMail> = {
  aiLinkMail: () => Mails.aiLinkMail(ORIGIN, "cba_" + "a".repeat(48), "start", T + 86_400_000),
  coHostLinkMail: () => Mails.coHostLinkMail(ORIGIN, "cbh_" + "b".repeat(48), "boss@acme.com", T + 86_400_000),
  hostLinkMail: () => Mails.hostLinkMail(ORIGIN, "cbh_" + "e".repeat(48), "Priya"),
  newUseAlertMail: () => Mails.newUseAlertMail({ when: "now", country: "IN", program: "x", kind: "AI", origin: ORIGIN }),
  signInMail: () => Mails.signInMail(ORIGIN, "123456", "c".repeat(48)),
};

describe("every e-mail builder has the brand header and footer", () => {
  const builders = Object.entries(Mails).filter(([k, v]) => typeof v === "function" && /Mail$/.test(k)).map(([k]) => k);
  test("every exported *Mail builder has a sample here (a new builder must be added, so it is checked)", () => {
    expect(builders.length).toBeGreaterThanOrEqual(4);
    for (const b of builders) expect(Object.keys(SAMPLES)).toContain(b);
  });
  for (const name of Object.keys(SAMPLES)) {
    test(`${name}: header (logo + Corporate Tic Tac Toe), footer (name, support address, legal link) in both the HTML and the plain-text part`, () => {
      const m = SAMPLES[name]!();
      expect(m.html).toContain('data-brand="header"'); expect(m.html).toContain('data-brand="footer"');
      expect(m.html.indexOf('data-brand="header"')).toBeLessThan(m.html.indexOf('data-brand="footer"'));
      expect(m.html).toContain(`${ORIGIN}/icon-192.png`); expect(m.html).toContain(BRAND.name);
      expect(m.html).toContain(`mailto:${BRAND.support}`); expect(m.html).toContain(`${ORIGIN}${BRAND.legalPath}`);
      expect(hasFooter(m.text)).toBe(true); expect(m.text).toContain(footerText(ORIGIN)); expect(m.text).toContain(`Write to ${BRAND.support}`); expect(m.text).toContain(`${ORIGIN}${BRAND.legalPath}`);
      expect(m.html + m.text + m.subject).not.toMatch(/CORPORATE TIC TAC TOE(?!:)|Corporate  Bingo|Bingo Corporate/); // the name is spelled one way (the all-capitals label inside a heading is allowed only as CSS-free text in the AI-link warnings)
    });
  }
});

describe("mail that is not built by mails.ts gets the same brand when it is sent", () => {
  test("a plain mail is wrapped in the branded HTML and gets the footer once; sending the same text twice does not double the footer", async () => {
    const calls: any[] = []; globalThis.fetch = (async (_u: any, init: any) => { calls.push(JSON.parse(init.body)); return new Response("{}", { status: 200 }); }) as any;
    env.RESEND_API_KEY = "re_test";
    await sendMail(env, env.DB, "a@b.com", "Payment due", "Pay now: https://bingo.test/pay.html?e=X-1", T);
    const m = calls[0]; expect(m.html).toContain('data-brand="header"'); expect(m.html).toContain('data-brand="footer"'); expect(m.html).toContain('href="https://bingo.test/pay.html?e=X-1"');
    expect(hasFooter(m.text)).toBe(true); expect(m.text.split(`Write to ${BRAND.support}`).length).toBe(2);
    await sendMail(env, env.DB, "a@b.com", "x", `Hello\n\n${footerText(ORIGIN)}`, T); expect(calls[1].text.split(`Write to ${BRAND.support}`).length).toBe(2);
    const ok = await sendReportMail(env, "a@b.com", "Report", "Open it: https://bingo.test/report.html?e=X&k=1", []); expect(ok).toBe(true);
    const r = calls[2]; expect(r.html).toContain('data-brand="header"'); expect(r.html).toContain('data-brand="footer"'); expect(hasFooter(r.text)).toBe(true);
  });
  test("the HTML for plain text escapes markup", () => {
    const h = plainToHtml("t", "<script>alert(1)</script>\n\nhttps://x.test/a?b=1&c=2", ORIGIN);
    expect(h).not.toContain("<script>"); expect(h).toContain("&lt;script&gt;"); expect(h).toContain('data-brand="header"');
  });
  test("every mail a whole unpaid lifecycle sends (sign-up, publish, co-host, reminder, could-not-begin, sign-in, replace, alert) carries the footer, and the name is spelled right", async () => {
    const o = await j(await call("POST", "/api/start", { email: "boss@acme.com" }, { "cf-connecting-ip": "1.1.1.1" })); const h = { "x-organizer": o.token };
    await call("POST", "/api/z", { id: "BRAND-1", startRound: roundAt(T + 30 * 3_600_000), callSeconds: 6, cap: 500 }, h);
    await call("POST", "/api/z/BRAND-1/publish", { email: "boss@acme.com", phone: "98765 43210" }, h);
    const use = (ip: string, c: string, now: number) => call("GET", `/ai/${o.aiKey}`, undefined, { "cf-connecting-ip": ip, "cf-ipcountry": c, "user-agent": "ChatGPT-User/1" }, now);
    await use("1.2.3.4", "US", T); await use("5.6.7.8", "DE", T + 1000);
    await call("POST", "/api/org/host", { mobile: "9876500009", email: "host@acme.com" }, h); await call("POST", "/api/org/ai/replace", {}, h); await call("POST", "/api/org/ai/fresh", {}, h);
    await call("POST", "/api/auth/email", { email: "boss@acme.com" });
    await housekeeping(env as Env, T + 86_400_000);
    await call("GET", "/api/z/BRAND-1/info", undefined, {}, T + 40 * 3_600_000);
    const rows = raw.prepare("SELECT subject, body FROM outbox").all() as { subject: string; body: string }[];
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const r of rows) { expect([r.subject, hasFooter(r.body)]).toEqual([r.subject, true]); expect(r.body + r.subject).not.toMatch(/CORPORATE TIC TAC TOE|Corporate Tic Tac Toe Bingo/); }
    expect(rows.some((r) => /Someone new used/.test(r.subject))).toBe(true); expect(rows.some((r) => /could not begin/.test(r.subject))).toBe(true); expect(rows.some((r) => /^Payment pending for your game/.test(r.subject))).toBe(true);
  });
  test("pay.ts and nothing else talks to the mail service, and both senders add the brand", () => {
    const pay = read("apps/edge/src/pay.ts");
    expect(pay).toMatch(/async function sendMail[\s\S]*?withFooter[\s\S]*?async function sendReportMail/); expect(pay).toMatch(/async function sendReportMail[\s\S]*?withFooter/); expect(pay).toMatch(/plainToHtml/);
    for (const f of ["worker.ts", "lifecycle.ts", "partners.ts", "winners.ts", "mails.ts"]) { let t = ""; try { t = read("apps/edge/src", f); } catch { continue; } expect(t).not.toContain("api.resend.com"); }
  });
});

describe("pages: one title pattern, icons, manifest, theme colour", () => {
  const PAGES = ["index.html", "report.html", "legal.html", "terms.html", "dpa.html", "subprocessors.html", "partner-terms.html", "organizer-guide.html", "partner.html", "pay.html", "big.html", "zc.html", "z.html", "ai-link.html", "signin.html", "404.html"];
  for (const f of PAGES) {
    test(`${f}: title names Corporate Tic Tac Toe exactly; favicon, touch icon, manifest and theme colour`, () => {
      const s = read("apps/web/public", f); const title = (s.match(/<title>([^<]*)<\/title>/) ?? [])[1]!;
      expect(title).toMatch(/(^Corporate Tic Tac Toe|\| Corporate Tic Tac Toe$)/); expect(title).not.toMatch(/CORPORATE|Bingo Corporate/);
      for (const needle of ['rel="icon"', "apple-touch-icon", 'rel="manifest"', 'name="theme-color" content="#0B5D5B"']) expect(s).toContain(needle);
    });
  }
  test("the PWA manifest and the build ship the brand", () => {
    const m = JSON.parse(read("apps/web/public/manifest.webmanifest")); expect(m.name).toBe("Corporate Tic Tac Toe"); expect(m.short_name).toBe("Corporate Tic Tac Toe"); expect(m.theme_color).toBe("#0B5D5B");
    expect(read("pages/build.mjs")).toContain('"404.html"');
  });
  test("every page header uses the Corporate Tic Tac Toe name; the report PDF names it and carries the support address and legal link", () => {
    for (const f of ["zc.js", "pay.js", "ai-link.js", "signin.js", "ttt.js", "partner.js"]) for (const m of read("apps/web/public", f).matchAll(/<div class="zhead"><b>([^<]*)<\/b>/g)) expect(m[1]).toMatch(/^Corporate Tic Tac Toe/);
    const lay = read("apps/edge/src/report-layout.ts"); expect(lay).toContain("BRAND.support"); expect(lay).toContain("BRAND.legalPath"); expect(lay).toMatch(/pdf\.footer = `Corporate Tic Tac Toe/);
  });
});

describe("claims register: customer-facing text never says what the build does not do", () => {
  const FILES = ["apps/web/public/trust.html", "apps/web/public/llms.txt", "apps/web/public/demo.js", "apps/edge/src/ai-facts.ts", "apps/edge/src/ai-go.ts", "apps/web/public/index.html", "apps/web/public/legal.html", "apps/web/public/partner.html", "apps/web/public/zc.js", "apps/web/public/pay.js", "apps/web/public/site.js", "apps/web/public/partner.js", "apps/web/public/ai-link.js", "apps/edge/src/worker.ts", "apps/edge/src/lifecycle.ts", "apps/edge/src/report-layout.ts", "apps/edge/src/mails.ts", "apps/edge/src/ai-link.ts", "apps/edge/src/pay.ts"];
  test("every mention of 365 days sits next to winners, prize, organizer, retention or AI-log wording", () => {
    for (const f of FILES) {
      const t = read(f);
      for (const m of t.matchAll(/365[ -]?days?|365 DAY|365\s*\*\s*DAY|RETENTION_DAYS/gi)) {
        const ctx = t.slice(Math.max(0, m.index! - 260), m.index! + 260).toLowerCase();
        expect([f, /winner|prize|credit|payment|paid|organi[sz]er|retention|retain|ai assistant|hand|record|engagement|deleted|purge|delete|everything|keep|kept/.test(ctx)]).toEqual([f, true]);
        expect([f, /names and numbers are kept 365|contacts kept 365|reuse your list|reuse the data.{0,40}365/.test(ctx)]).toEqual([f, false]);
      }
    }
  });
  test("banned claims are gone", () => {
    const BAN: [RegExp, string][] = [[/discount applied/i, "implies a past sale"], [/ISO\/IEC 27001/i, "unsupported certification"], [/Most popular/i, "popularity without data"], [/Nobody else sees it/i, "the organizer sees it"], [/We follow India/i, "soft wording only"], [/Built in line with/i, "soft wording only"], [/\b(fully |is |are )?compliant\b/i, "never claim compliance"], [/does not contain names or mobile/i, "winners' details are kept sealed"], [/We do not keep your participants' data/i, "prize details are kept"], [/\bterms, privacy/i, "no terms page yet"]];
    for (const f of FILES) { const t = read(f); for (const [re, why] of BAN) expect([f, why, re.test(t)]).toEqual([f, why, false]); }
  });
  test("structured data prices equal the real packs", () => {
    const h = read("apps/web/public/index.html"); const { PACKS } = require("../../../packages/shared/src/pricing") as typeof import("../../../packages/shared/src/pricing");
    expect(h).toContain(`"lowPrice":"${Math.min(...PACKS.map((p) => p[1]))}"`); expect(h).toContain(`"highPrice":"${Math.max(...PACKS.map((p) => p[1]))}"`); expect(h).toContain(`"offerCount":"${PACKS.length}"`);
    const site = read("apps/web/public/site.js"); expect(site).toContain("Festive offer: 50% off"); expect(site).toContain("Regular price after the festive offer"); expect(h).toContain("Festive offer: 50% off"); // product decision: keep the offer, worded as a festive offer
    expect(`${h}${site}`).not.toMatch(/Most popular|2nd most popular/); // the offer price is what is charged, and equals the structured-data price (lowPrice above)
  });
});
