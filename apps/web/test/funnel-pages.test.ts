// Sales funnel on the public pages (funnel-pages.js with the common reporter tttfunnel.js, owner order 1 Nov 2026). The REAL scripts run against a small stand-in for the browser:
// each page step fires from the page code (a look, a size, a sign-up tap, the payment page); Do Not Track and Global Privacy Control send nothing; no payload carries a name, a mobile
// number, an e-mail or an ID; the endpoint is our own; every page that should report loads both scripts; the owner page is hidden from search and from the public pages.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const PUB = new URL("../public/", import.meta.url), rd = (f: string) => readFileSync(new URL(f, PUB), "utf8");
const BUNDLE = rd("tttfunnel.js"), GLUE = rd("funnel-pages.js");
const WIRED = ["index.html", "pricing.html", "how-it-works.html", "brochure.html", "pay.html"];

type Sent = { url: string; body: any };
/** runs both scripts as a page would: the reporter first, then the page code */
function page(path: string, nav: Record<string, unknown> = {}) {
  const sent: Sent[] = [], handlers: Record<string, ((e: any) => void)[]> = {};
  const ctx: any = {
    navigator: { sendBeacon: (url: string, data: string) => { sent.push({ url, body: JSON.parse(data) }); return true; }, ...nav },
    location: { pathname: path },
    document: { addEventListener: (t: string, f: (e: any) => void) => (handlers[t] ??= []).push(f) },
    fetch: () => { throw new Error("the page must use the beacon"); },
    Date, Math, JSON, Array, Number, RegExp, String, Object, Uint8Array,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx); vm.runInContext(BUNDLE, ctx); vm.runInContext(GLUE, ctx);
  const fire = (type: string, target: any) => { for (const f of handlers[type] ?? []) f({ target }); };
  const el = (o: Record<string, unknown>) => { const t: any = { ...o, hasAttribute: (a: string) => a in ((o.attrs as any) ?? {}), getAttribute: (a: string) => ((o.attrs as any) ?? {})[a] ?? null }; t.closest = () => t; return t; };
  return { sent, fire, el, ctx };
}

describe("each step fires from the page code", () => {
  test("a look is reported once on every page the owner listed, and on no other page", () => {
    for (const p of ["/", "/pricing", "/pricing.html", "/how-it-works", "/brochure", "/pay"]) { const x = page(p); expect(x.sent.map((s) => s.body.event)).toContain("viewed"); expect(x.sent.filter((s) => s.body.event === "viewed").length).toBe(1); }
    for (const p of ["/signin", "/z.html", "/zc.html", "/report.html", "/owner-funnel.html", "/legal"]) expect(page(p).sent.length).toBe(0);
  });
  test("the payment page reports that it was opened", () => {
    expect(page("/pay").sent.map((s) => s.body.event).sort()).toEqual(["payment_page_opened", "viewed"]);
    expect(page("/pricing").sent.map((s) => s.body.event)).toEqual(["viewed"]);
  });
  test("choosing a size reports the number of players, from the picker or from a price button; nothing else", () => {
    const x = page("/pricing");
    x.fire("change", x.el({ id: "pack", value: "200" })); x.fire("change", x.el({ id: "pack2", value: "500" })); x.fire("click", x.el({ attrs: { "data-buy": "1000" } }));
    x.fire("change", x.el({ id: "pack", value: "lots" })); x.fire("change", x.el({ id: "orgName", value: "Acme" })); x.fire("click", x.el({ attrs: { "data-buy": "-5" } }));
    expect(x.sent.filter((s) => s.body.event === "size_chosen").map((s) => s.body.size)).toEqual([200, 500, 1000]);
  });
  test("tapping the way into the console reports a sign-up start; other links do not", () => {
    const x = page("/");
    for (const h of ["/zc?demo=1", "/zc", "/#login", "/signin"]) x.fire("click", x.el({ attrs: { href: h } }));
    for (const h of ["/guide", "/how-it-works", "https://elsewhere.test/zc", "/zcx"]) x.fire("click", x.el({ attrs: { href: h } }));
    expect(x.sent.filter((s) => s.body.event === "signup_started").length).toBe(4);
  });
});

describe("privacy", () => {
  test("Do Not Track and Global Privacy Control: nothing is sent and the page code does not even start", () => {
    for (const nav of [{ globalPrivacyControl: true }, { doNotTrack: "1" }, { msDoNotTrack: "1" }]) { const x = page("/pay", nav); x.fire("click", x.el({ attrs: { href: "/zc" } })); expect(x.sent.length).toBe(0); expect(x.ctx.TTTFUNNEL).toBeUndefined(); }
  });
  test("every payload is only the step, a time, a random id for this page load, the game name and a number of players: no name, mobile number, e-mail or ID, and nothing is stored", () => {
    const x = page("/pricing");
    // personal details typed on the page, and links that carry them
    x.fire("change", x.el({ id: "name", value: "Ravi Kumar" })); x.fire("change", x.el({ id: "phone", value: "9876543210" })); x.fire("change", x.el({ id: "email", value: "ravi@acme.com" })); x.fire("change", x.el({ id: "empId", value: "E12345" }));
    x.fire("click", x.el({ attrs: { href: "/zc?email=ravi@acme.com&phone=9876543210" } })); x.fire("change", x.el({ id: "pack", value: "100" }));
    const all = JSON.stringify(x.sent);
    expect(all).not.toMatch(/ravi|kumar|acme|9876543210|E12345|@|email|phone/i);
    for (const s of x.sent) { expect(Object.keys(s.body).every((k) => ["event", "at", "visit", "game", "size"].includes(k))).toBe(true); expect(s.body.visit).toMatch(/^[a-z0-9]{12}$/); expect(s.body.game).toBe("tictactoe"); }
    expect(new Set(x.sent.map((s) => s.body.visit)).size).toBe(1); // one id for the whole page load
    expect(GLUE).not.toMatch(/localStorage|sessionStorage|document\.cookie|\.value\b.*(name|phone|mail)/);
    expect(BUNDLE).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
  test("the endpoint is a path on our own site", () => {
    const x = page("/"); expect(x.sent[0]!.url).toBe("/api/f"); expect(GLUE).toContain('endpoint: "/api/f"'); expect(GLUE).not.toMatch(/https?:\/\//);
  });
});

describe("the pages and the owner page", () => {
  test("every page that reports loads the reporter first and then the page code, and both files are shipped", () => {
    for (const f of WIRED) { const h = rd(f), a = h.indexOf('src="/tttfunnel.js'), b = h.indexOf('src="/funnel-pages.js'); expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a); }
    const build = readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8");
    for (const f of ["tttfunnel.js", "funnel-pages.js", "owner-funnel.html", "owner-funnel.js"]) expect(build).toContain(`"${f}"`);
    for (const f of ["signin.html", "z.html", "zc.html", "big.html", "report.html"]) expect(rd(f)).not.toContain("funnel-pages.js"); // never inside the game or the console
  });
  test("the reporter bundle names no other game", () => { expect(BUNDLE).not.toMatch(/tambola|bingo|housie|snakes|luck/i); });
  test("the owner page is hidden from search engines, not in the sitemap, not linked from a public page, and served with noindex", () => {
    const h = rd("owner-funnel.html"); expect(h).toMatch(/name="robots" content="noindex, nofollow"/); expect(h).toContain('src="/owner-funnel.js"');
    expect(rd("sitemap.xml")).not.toContain("owner-funnel"); expect(rd("robots.txt")).not.toContain("owner-funnel");
    for (const f of [...WIRED, "legal.html", "privacy.html", "terms.html", "guide.html", "refer.html", "signin.html"]) expect(rd(f)).not.toContain("owner-funnel");
    expect(readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8")).toContain('["/owner-funnel", PLAINCSP, true]');
  });
  test("the owner page's script uses only ids the page has, and writes with textContent", () => {
    const h = rd("owner-funnel.html"), js = rd("owner-funnel.js"), ids = new Set([...h.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!));
    for (const m of js.matchAll(/\$\("([^"]+)"\)/g)) expect(ids.has(m[1]!)).toBe(true);
    expect(js).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });
});
