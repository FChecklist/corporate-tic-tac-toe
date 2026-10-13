// Terms, data-processing terms, sub-processors, partner terms, organizer guide: short pages in the site style; organizer acceptance without a tick box, stored with the organizer.
import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withDevice } from "./device";
import { type Env } from "../src/worker";
import { handle } from "./with-terms";
import { TERMS_VERSION } from "../src/brand";
import type { PayEnv } from "../src/pay";
import { makeD1 } from "./d1-sqlite";

const T = Date.UTC(2026, 9, 1, 10, 0, 0);
let env: PayEnv; let raw: ReturnType<typeof makeD1>["raw"];
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = T) =>
  handle(new Request("http://x" + path, { method, headers: { "content-type": "application/json", ...headers }, body: withDevice(method, path, body) }), env as Env, now);
const j = async (r: Response) => (await r.json()) as any;
const rd = (f: string) => readFileSync(new URL("../../web/public/" + f, import.meta.url), "utf8");
const rows = () => raw.prepare("SELECT org, version, via, at_ms FROM organizer_terms ORDER BY at_ms, via").all() as { org: string; version: string; via: string; at_ms: number }[];
beforeEach(() => { const d = makeD1(); raw = d.raw; env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "100000", PUBLIC_ORIGIN: "https://bingo.test", DATA_KEY: "k", TEST_MODE: "1" }; });
const LINKS = ["/terms.html", "/dpa.html", "/subprocessors.html", "/organizer-guide.html", "/partner-terms.html"];

describe("the document pages", () => {
  const DOCS: Record<string, string[]> = {
    "terms.html": ["In short", "We do not collect any money, deposit, contribution or other consideration from any Participant", "We erase Participant Personal Data from our systems within twenty-four (24) hours", "Every personal link records who sent it and to whom", "Grievance Officer", "Version 2026-10-13", "IT SERVICES BY RAJAT AGARWAL"],
    "dpa.html": ["controller", "processor", "All player data is deleted within 24 hours", "Backups clear within 7 days", "365 days", "without undue delay", "/subprocessors.html"],
    "subprocessors.html": ["Cloudflare", "Resend", "Razorpay", "Google", "drand", "YouTube"],
    "partner-terms.html": ["independent partner", "No spam", "Tax may be deducted at source", "You are responsible for your own taxes", "No payment from the buyer, no commission"],
    "organizer-guide.html": ["Never ask for a fee", "Players are 18 or older", "INR 10,000", "tax deducted at source", "Check your state", "The game does not begin until it is paid for"],
  };
  for (const [f, needles] of Object.entries(DOCS)) test(`${f}: brand header and footer, title pattern, the right statements, no draft mark, no tick box, short lines`, () => {
    const h = rd(f);
    expect(h).toMatch(/<title>[^<]+ \| Corporate Tic Tac Toe<\/title>/); expect(h).toContain('class="legaltop"'); expect(h).toContain('class="foot"'); expect(h).toContain('rel="icon"');
    for (const n of needles) expect(h).toContain(n);
    expect(h).not.toMatch(/DRAFT|adviser review|type="checkbox"/i);
    expect(h).not.toMatch(/\bcompliant\b|certified by/i);
    for (const l of f === "terms.html" ? [] : h.match(/<li>[\s\S]*?<\/li>/g) ?? []) expect(l.replace(/<[^>]+>/g, "").split(/\s+/).length).toBeLessThanOrEqual(36); // 36: the owner's credit sentence ("We do not give refunds. If you cancel a paid game before it starts, ... lapses at the end of day 365.") is 35 words
    for (const l of LINKS) expect(h).toContain(`href="${l}"`);
  });
  test("the home page and the legal page link every document in the footer; the build ships them with headers; the sitemap lists them", () => {
    for (const f of ["index.html", "legal.html"]) for (const l of LINKS) expect(rd(f)).toContain(`href="${l}"`);
    const b = readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8");
    for (const n of ["terms", "dpa", "subprocessors", "partner-terms", "organizer-guide"]) { expect(b).toContain(`"${n}.html"`); expect(b).toContain(`["/${n}", PLAINCSP`); expect(rd("sitemap.xml")).toContain(`/${n}.html`); }
  });
  test("the public website pages describe Bingo only: no words of the game this product was copied from, and the software-only line is on the key pages", () => {
    const files = ["index.html", "pricing.html", "about.html", "contact.html", "legal.html", "terms.html", "refund-policy.html", "dpa.html", "subprocessors.html", "partner.html", "partner-terms.html", "organizer-guide.html", "brochure.html", "404.html", "site.js"];
    for (const f of files) expect([f, /tambola|housie|early five|full house|top line|\bIST\b|90 numbers/i.test(rd(f)) || (f !== "terms.html" && /\bticket/i.test(rd(f).replace(/i-ticket|ic\("ticket"\)/g, "")))]).toEqual([f, false]);
    for (const f of ["index.html", "terms.html", "organizer-guide.html"]) expect([f, /we never hold or pay prize money|we never hold prizes|we do not hold, pay, guarantee, transfer or deliver any prize/i.test(rd(f))]).toEqual([f, true]);
  });
});

describe("acceptance by ticking the box (consent.test.ts proves the server side)", () => {
  test("the sign-up pages draw the K2 box from termsbox.js and never type the wording themselves", () => {
    const s = rd("site.js"); expect(s).toContain("TermsBox.mount"); expect(s).not.toContain("By continuing you accept");
    expect(rd("termsbox.js")).toContain("/api/consent/text");
  });
  test("signing up stores the terms version with the organizer; the version is shown on the Terms page", async () => {
    expect(rd("terms.html")).toContain(`Version ${TERMS_VERSION.replace("&", "&amp;")}`);
    const o = await j(await call("POST", "/api/start", { email: "boss@acme.com" }, { "cf-connecting-ip": "1.1.1.1" }));
    const r = rows(); expect(r.length).toBe(1); expect(r[0]).toMatchObject({ version: TERMS_VERSION, via: "start", at_ms: T });
    const org = (raw.prepare("SELECT org FROM organizer_key WHERE kind='master'").get() as any).org; expect(r[0]!.org).toBe(org);
    const start = Math.floor((T / 1000 - 1692803367) / 3) + 1200;
    await call("POST", "/api/z", { id: "TERMS-1", startRound: start, callSeconds: 6, cap: 100 }, { "x-organizer": o.token }, T + 5000);
    expect(rows().map((x) => x.via).sort()).toEqual(["start"]);
  });
  test("a platform-made organizer has no acceptance until they continue (create engagement records it)", async () => {
    const mk = await j(await call("POST", "/api/org", {}, { "x-organizer": "plat" })); expect(rows().length).toBe(0);
    await call("POST", "/api/z", { id: "TERMS-3", startRound: Math.floor((T / 1000 - 1692803367) / 3) + 1200, callSeconds: 6, cap: 100 }, { "x-organizer": mk.organizerKey }, T + 100);
    expect(rows().map((x) => [x.via, x.at_ms])).toEqual([["engagement", T + 100]]);
  });
  test("signing in by code or by the e-mailed link records the version for that organizer", async () => {
    await call("POST", "/api/start", { email: "boss@acme.com" }, { "cf-connecting-ip": "1.1.1.1" });
    raw.prepare("DELETE FROM organizer_terms").run();
    const a = await j(await call("POST", "/api/auth/email", { email: "boss@acme.com" }, {}, T + 1000));
    await call("POST", "/api/auth/verify", { email: "boss@acme.com", code: a.devCode }, {}, T + 2000);
    expect(rows().map((x) => x.via)).toEqual(["signin-code"]);
    raw.prepare("DELETE FROM organizer_terms").run();
    const b = await j(await call("POST", "/api/auth/email", { email: "boss@acme.com" }, {}, T + 3000));
    expect((await call("POST", "/api/auth/link", { token: b.devToken }, {}, T + 4000)).status).toBe(200);
    expect(rows().map((x) => x.via)).toEqual(["signin-link"]);
  });
});
