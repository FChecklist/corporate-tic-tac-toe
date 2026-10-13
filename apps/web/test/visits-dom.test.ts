// The visit-tracking script (v.js) as a browser runs it: section views with time, the participants drop-down, the create button, the exit message, privacy signals, and the pages it must stay out of.
// The messages it sends are also handed to the real Worker, so what the owner would read is checked end to end.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { handle } from "../../edge/test/with-terms";
import { resetRate } from "../../edge/src/visits";
import { newWorld, openPage, T, type Page } from "./harness";

setDefaultTimeout(30_000);
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

type Sent = { body: any };
/** Opens a page of the public site with a recording sendBeacon and a fake IntersectionObserver the test can drive. */
async function site(url = "/", html = "index.html", o: { gpc?: boolean; scripts?: string[]; storage?: Record<string, string> } = {}) {
  resetRate();
  const w = newWorld({ DATA_KEY: "k" });
  const sent: Sent[] = [], pending: Promise<unknown>[] = [], observed: { cb: (e: any[]) => void; els: any[] }[] = [];
  const clock = { now: T };
  w.world.now = clock.now;
  const p = await openPage(w.world, {
    url: "http://localhost" + url, html, scripts: o.scripts ?? ["common.js", "site.js", "v.js"],
    afterLoad: (win, file) => {
      if (file !== "common.js") return;
      class IO { cb: (e: any[]) => void; els: any[] = []; constructor(cb: any) { this.cb = cb; observed.push(this as any); } observe(el: any) { this.els.push(el); } disconnect() {} unobserve() {} }
      win.IntersectionObserver = IO;
      Object.defineProperty(win.navigator, "sendBeacon", { configurable: true, value: (_u: string, blob: Blob) => { pending.push(blob.text().then((t) => { const b = JSON.parse(t); sent.push({ body: b }); return handle(new Request("http://localhost/api/v/b", { method: "POST", headers: { origin: "http://localhost", "user-agent": "Mozilla/5.0 (X11; Linux) Chrome/126.0", "cf-connecting-ip": "203.0.113.9" }, body: t }), w.world.env, w.world.now); })); return true; } });
      if (o.gpc) Object.defineProperty(win.navigator, "globalPrivacyControl", { configurable: true, value: true });
      for (const [k, v] of Object.entries(o.storage ?? {})) win.localStorage.setItem(k, v);
    },
  });
  open.push(p);
  const drain = async () => { await new Promise((r) => setTimeout(r, 5)); await Promise.all(pending.splice(0)); };
  const see = (id: string, on: boolean, ratio = 0.8) => { const el = p.win.document.getElementById(id); for (const io of observed) io.cb([{ target: el, isIntersecting: on, intersectionRatio: on ? ratio : 0, intersectionRect: { height: 500 }, rootBounds: { height: 800 } }]); };
  const rows = (sql: string, ...a: unknown[]) => w.world.raw.prepare(sql).all(...a) as any[];
  return { p, w, sent, drain, see, observed, clock, rows, flush: async () => { p.win.TBV.flush(); await drain(); } };
}
const hidden = (p: Page, on = true) => { Object.defineProperty(p.win.document, "visibilityState", { configurable: true, get: () => (on ? "hidden" : "visible") }); p.win.document.dispatchEvent(new p.win.Event("visibilitychange")); };

describe("v.js on the home page", () => {
  test("it tells the page view first, with where the visit came from and the device, and watches the home page's sections", async () => {
    const s = await site("/?utm_source=Diwali&utm_medium=email&ref=ab3de4fg&q=secret");
    await s.flush();
    expect(s.sent.length).toBe(1); const b = s.sent[0]!.body;
    expect(b.e[0]).toEqual({ k: "pv", p: "/" }); expect(b.lp).toBe("/"); expect(b.u).toEqual({ s: "Diwali", m: "email", c: "" }); expect(b.pc).toBe("ab3de4fg");
    expect(JSON.stringify(b)).not.toContain("secret"); expect(b.d).toMatch(/^[a-f0-9]{32}$/); expect(b.s).toMatch(/^[a-f0-9]{24}$/); expect(["mobile", "tablet", "desktop"]).toContain(b.dv);
    const watched = s.observed.flatMap((o) => o.els).map((e: any) => e.id);
    for (const id of ["top", "benefits", "pricing", "faq", "how", "ai-host"]) expect(watched).toContain(id);
    expect(s.rows("SELECT src, landing, utm_source FROM visit_session")).toEqual([{ src: "campaign", landing: "/", utm_source: "Diwali" }]);
  });
  test("section views carry the time each section was on screen, and only what is new in each message", async () => {
    const s = await site(); s.see("pricing", true); s.w.world.now += 7000; s.see("pricing", false);
    s.see("faq", true); s.w.world.now += 3000;
    await s.flush();
    const sec = (b: any) => b.e.filter((e: any) => e.k === "sec").map((e: any) => [e.n, e.m]);
    expect(sec(s.sent[0]!.body)).toEqual([["pricing", 7000], ["faq", 3000]]);
    s.w.world.now += 2000; await s.flush();
    expect(sec(s.sent[1]!.body)).toEqual([["faq", 2000]]); // pricing is not repeated
    expect(s.rows("SELECT name, SUM(n) AS ms FROM visit_event WHERE kind='sec' GROUP BY name ORDER BY name")).toEqual([{ name: "faq", ms: 5000 }, { name: "pricing", ms: 7000 }]);
    expect(s.rows("SELECT stage FROM visit_session")[0]!.stage).toBe(1); // pricing seen
  });
  test("choosing a size in the price card (#pack2) and in the home drop-down (#pack) each tell the size and the price shown", async () => {
    const s = await site(); await s.flush();
    const pack2 = s.p.$("#pack2"); pack2.value = "2500"; pack2.dispatchEvent(new s.p.win.Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    const pack = s.p.$("#pack"); pack.value = "250"; pack.dispatchEvent(new s.p.win.Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    await s.flush();
    const acts = s.sent.flatMap((x) => x.body.e).filter((e: any) => e.k === "act");
    expect(acts.map((a: any) => [a.n, a.z])).toEqual([["pack", 2500], ["pack", 250]]);
    expect(acts[0].v).toMatch(/^(INR|USD) \d+(\.\d+)?$/); expect(acts[1].v).toMatch(/^(INR|USD) \d+/);
    expect(s.rows("SELECT n, val FROM visit_event WHERE name='pack' ORDER BY id").map((r) => r.n)).toEqual([2500, 250]);
    expect(s.rows("SELECT stage FROM visit_session")[0]!.stage).toBe(2);
  });
  test("pressing Create sends at once, with the size and the price; switching currency and opening Log in are actions too", async () => {
    const s = await site(); await s.flush(); const before = s.sent.length;
    s.p.click(".pcta"); await s.drain();
    expect(s.sent.length).toBe(before + 1);
    const create = s.sent[s.sent.length - 1]!.body.e.find((e: any) => e.n === "create"); expect(create).toMatchObject({ k: "act", n: "create", z: 1000 }); expect(create.v).toMatch(/^(INR|USD) /);
    s.p.click('[data-c="USD"]'); s.p.click("#loginLink"); await s.drain(); await s.flush();
    const names = s.sent.flatMap((x) => x.body.e).filter((e: any) => e.k === "act").map((e: any) => e.n);
    expect(names).toEqual(expect.arrayContaining(["create", "cur", "signin_open"]));
    expect(s.rows("SELECT stage FROM visit_session")[0]!.stage).toBe(3);
    expect(s.rows("SELECT val FROM visit_event WHERE name='cur'")).toEqual([{ val: "USD" }]);
  });
  test("when the page is hidden an exit message goes with the last section seen, the time on the page and how far it was scrolled", async () => {
    const s = await site(); s.see("pricing", true); s.w.world.now += 4000; s.see("pricing", false); s.see("faq", true); s.w.world.now += 6000;
    hidden(s.p); await s.drain();
    const b = s.sent[s.sent.length - 1]!.body, ex = b.e.find((e: any) => e.k === "exit");
    expect(ex).toMatchObject({ k: "exit", p: "/", n: "faq" }); expect(ex.m).toBeGreaterThanOrEqual(10000); expect(ex.x).toBeGreaterThanOrEqual(0); expect(ex.x).toBeLessThanOrEqual(100);
    expect(b.e.filter((e: any) => e.k === "sec").map((e: any) => e.n)).toEqual(["pricing", "faq"]);
    const n = s.sent.length; s.p.win.dispatchEvent(new s.p.win.Event("pagehide")); await s.drain(); // hidden then pagehide: no second exit
    expect(s.sent.slice(n).flatMap((x) => x.body.e).filter((e: any) => e.k === "exit").length).toBe(0);
    expect(s.rows("SELECT exit_path, exit_section, exit_ms FROM visit_session")[0]).toMatchObject({ exit_path: "/", exit_section: "faq" });
  });
  test("messages hold at most 20 events", async () => {
    const s = await site();
    for (let i = 0; i < 45; i++) s.p.click('[data-c="INR"]');
    await s.flush();
    expect(s.sent.length).toBeGreaterThanOrEqual(3); for (const m of s.sent) expect(m.body.e.length).toBeLessThanOrEqual(20);
  });
  test("the visitor id is made once, kept in browser storage and a one-year cookie, and the next page of the same visit keeps the same session", async () => {
    const s = await site(); await s.flush();
    const id = s.p.win.localStorage.getItem("cbv_id"); expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(s.p.win.document.cookie).toContain("cbv=" + id);
    const t = await site("/legal.html", "legal.html", { storage: { cbv_id: id! } }); await t.flush();
    expect(t.sent[0]!.body.d).toBe(id); expect(t.p.win.localStorage.getItem("cbv_id")).toBe(id);
  });
  test("calls to the server carry the visitor id and session id, so an account can be tied to the visit", async () => {
    const s = await site(); await s.flush();
    const calls: any[] = []; s.p.win.fetch = async (u: string, init: any) => { calls.push({ u, h: init.headers }); return new Response("{}", { headers: { "content-type": "application/json" } }); };
    await s.p.win.TB.api("GET", "/api/whoami");
    expect(calls[0].h["x-cb-vid"]).toBe(s.p.win.TBV.vid); expect(calls[0].h["x-cb-vs"]).toBe(s.p.win.TBV.sid);
  });
});

describe("privacy signal", () => {
  test("with Global Privacy Control on, no visitor id is made, nothing is stored in the browser, no id header goes out, and the server keeps counts only", async () => {
    const s = await site("/", "index.html", { gpc: true });
    s.see("pricing", true); s.w.world.now += 2000; await s.flush();
    expect(s.p.win.TBV.vid).toBe(""); expect(s.p.win.localStorage.getItem("cbv_id")).toBeNull(); expect(s.p.win.document.cookie).not.toContain("cbv=");
    expect(s.sent[0]!.body.g).toBe(1); expect(s.sent[0]!.body.d).toBeUndefined();
    const calls: any[] = []; s.p.win.fetch = async (u: string, init: any) => { calls.push(init.headers); return new Response("{}", { headers: { "content-type": "application/json" } }); };
    await s.p.win.TB.api("GET", "/api/whoami"); expect(calls[0]["x-cb-vid"]).toBeUndefined(); expect(calls[0]["x-cb-vs"]).toBeUndefined();
    expect(s.rows("SELECT COUNT(*) c FROM visit_session")[0]!.c).toBe(0);
    expect(s.rows("SELECT dim FROM visit_agg ORDER BY dim").map((r) => r.dim)).toEqual(expect.arrayContaining(["gpc_pv", "gpc_section", "gpc_src"]));
  });
});

describe("pages it must stay out of", () => {
  for (const [url, html] of [["/z.html?e=GAME-1", "z.html"], ["/zc.html", "zc.html"], ["/big.html?e=GAME-1", "big.html"], ["/play.html", "z.html"], ["/report.html", "report.html"], ["/owner-visits.html", "owner-visits.html"]] as const) test(url + ": the script does nothing", async () => {
    const s = await site(url, html, { scripts: ["common.js", "v.js"] });
    await s.drain();
    expect(s.p.win.TBV).toBeUndefined(); expect(s.sent.length).toBe(0); expect(s.p.win.localStorage.getItem("cbv_id")).toBeNull();
  });
  test("none of the game pages loads the script, and the public pages do", async () => {
    const { readFileSync } = await import("node:fs"); const rd = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
    for (const f of ["z.html", "zc.html", "big.html", "report.html", "ai-link.html", "owner-visits.html", "404.html"]) expect([f, rd(f).includes("/v.js")]).toEqual([f, false]);
    for (const f of ["index.html", "legal.html", "terms.html", "dpa.html", "subprocessors.html", "partner-terms.html", "organizer-guide.html", "partner.html", "signin.html", "pay.html"]) expect([f, rd(f).includes('<script src="/v.js" defer></script>')]).toEqual([f, true]);
    for (const f of ["ttt.js", "zc.js", "zgame.js", "big.js", "control.js"]) { const t = rd(f); expect([f, /cbv_id|TBV|\/api\/v\/b/.test(t)]).toEqual([f, false]); }
  });
});
