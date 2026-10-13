// Playwright helpers: real Chrome (channel exe), mobile and laptop contexts that cannot reach the internet, the fake beacon, the WhatsApp redirect, role sign-in through
// sessionStorage (what the console does), simulated clock in the page, screenshots and layout checks. Max 6 contexts at once on this 8 GB laptop (`limit` below enforces it).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CHROME, SHOTS, SIM, playwright } from "./env.mjs";
import { routeBeacon } from "./beacon.mjs";
import { routeWhatsApp } from "./whatsapp.mjs";

export async function launchChrome({ headless = true } = {}) { return playwright().chromium.launch({ executablePath: CHROME, headless, args: ["--disable-extensions", "--no-first-run", "--disable-gpu"] }); }

/** The simulated UTC as a function the beacon route can call. Re-sync with refresh() after moving the server clock. */
export async function trackClock() {
  let base = 0, frozen = null;
  const refresh = async () => { const c = await (await fetch(SIM + "/__sim/clock")).json(); frozen = c.frozen ? c.now : null; base = c.now - Date.now(); };
  await refresh();
  return { now: () => (frozen ?? Date.now() + base), refresh, bump: (ms) => { if (frozen !== null) frozen += ms; else base += ms; } };
}

export const DEVICES = { mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, laptop: { viewport: { width: 1280, height: 800 } }, wide: { viewport: { width: 1920, height: 1080 } }, tablet: { viewport: { width: 768, height: 1024 }, hasTouch: true } };
const MAX_CONTEXTS = 6;

/**
 * A factory: const open = opener(browser, { track, ... });  const { ctx, page, mon } = await open({ device: "mobile", token, ip, sender, clock: true });
 * Every context: no access outside localhost, fake beacon (patched bundles + drand mirrors), WhatsApp redirect, Google script blocked, per-context simulated address.
 */
export function opener(browser, { track, seed = "sim", beaconOn = true } = {}) {
  const live = new Set();
  return async function open({ device = "mobile", w, h, ip, token, sender = "", clock = true, beacon = beaconOn, viewport } = {}) {
    if (live.size >= MAX_CONTEXTS) throw new Error(`more than ${MAX_CONTEXTS} browser contexts open at once: close one first (8 GB laptop rule)`);
    const d = { ...(DEVICES[device] ?? DEVICES.mobile) }; if (w && h) d.viewport = { width: w, height: h }; if (viewport) d.viewport = viewport;
    const ctx = await browser.newContext({ ...d, reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata", extraHTTPHeaders: ip ? { "x-sim-ip": ip } : {} });
    live.add(ctx); ctx.on("close", () => live.delete(ctx));
    await ctx.route((url) => !["localhost", "127.0.0.1"].includes(url.hostname), (route) => route.abort("blockedbyclient")); // lowest priority: anything not matched below goes nowhere
    await ctx.route(/^https:\/\/accounts\.google\.com\//, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "/* google blocked in the sim */" }));
    let patched = {};
    if (beacon && track) ({ patched } = await routeBeacon(ctx, { nowMs: track.now, seed }));
    await routeWhatsApp(ctx, { sender });
    if (token) await ctx.addInitScript((k) => { try { if (location.hostname === "localhost" && !sessionStorage.getItem("cbz-org")) sessionStorage.setItem("cbz-org", k); } catch { /* storage blocked */ } }, token);
    if (clock && track && ctx.clock) await ctx.clock.install({ time: track.now() }); // the page's Date follows the simulated time and then runs on at normal speed
    const page = await ctx.newPage(); const mon = monitor(page);
    return { ctx, page, mon, patched, close: () => ctx.close() };
  };
}

/** Collects what a tester must see: JS errors, console errors, failed local requests, 5xx answers. */
export function monitor(page) {
  const m = { pageErrors: [], console: [], failed: [], http5xx: [] };
  page.on("pageerror", (e) => m.pageErrors.push(String(e.message ?? e).slice(0, 300)));
  page.on("console", (c) => { if (c.type() === "error") m.console.push(c.text().slice(0, 300)); });
  page.on("requestfailed", (r) => { if (/localhost/.test(r.url())) m.failed.push(r.url() + " " + (r.failure()?.errorText ?? "")); });
  page.on("response", (r) => { if (r.status() >= 500 && /localhost/.test(r.url())) m.http5xx.push(r.status() + " " + r.url()); });
  m.clear = () => { m.pageErrors.length = m.console.length = m.failed.length = m.http5xx.length = 0; };
  m.count = () => m.pageErrors.length + m.console.length + m.http5xx.length;
  return m;
}

/** Move browsers' time with the server's: call after clock.advance(ms). */
export async function advanceBrowsers(ctxs, ms, { run = ms <= 120_000 } = {}) { for (const c of ctxs) if (c.clock) await (run ? c.clock.runFor(ms) : c.clock.fastForward(ms)); }

export async function shot(page, name) { mkdirSync(SHOTS, { recursive: true }); const f = join(SHOTS, name.replace(/[^\w.-]+/g, "_") + ".png"); await page.screenshot({ path: f, fullPage: false }); return f; }

/** Layout facts of the current page: horizontal overflow, text smaller than `minPx` (visible text only), counts. */
export async function measure(page, { minPx = 12 } = {}) {
  return page.evaluate((minPx) => {
    const de = document.documentElement, vw = window.innerWidth;
    const small = new Map();
    for (const el of document.body.querySelectorAll("*")) {
      if (!el.childNodes.length) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own) continue;
      const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || !el.getClientRects().length) continue;
      const fs = parseFloat(cs.fontSize); if (fs < minPx) small.set(el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""), fs);
    }
    const wide = [...document.body.querySelectorAll("*")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.right > vw + 1 && getComputedStyle(el).position !== "fixed"; }).slice(0, 5).map((el) => el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0]);
    return { viewport: vw, scrollWidth: de.scrollWidth, overflowX: de.scrollWidth > vw + 1, smallText: [...small].slice(0, 8), wideElements: wide, title: document.title };
  }, minPx);
}

/**
 * Plays a whole game in real Chrome in seconds: every `stepMs` of simulated time the server clock, the beacon and every page clock move together (page.clock.runFor), until every page's
 * phone runtime (window.__rt) reports phase "ended" or `maxSteps` is used up. Returns { steps, ended: [bool], views: [{ log, results }] }.
 */
export async function playBrowserGame(opens, { track, stepMs = 3000, maxSteps = 420, settleMs = 70 } = {}) {
  const { clock } = await import("./clock.mjs");
  const phase = (p) => p.evaluate(() => (window.__rt ? window.__rt.phase : "none")).catch(() => "none");
  let n = 0;
  for (; n < maxSteps; n++) {
    await clock.advance(stepMs); track.bump(stepMs);
    for (const o of opens) await o.ctx.clock.runFor(stepMs);
    await new Promise((r) => setTimeout(r, settleMs));
    if (n > 60 && (await Promise.all(opens.map((o) => phase(o.page)))).every((x) => x === "ended")) { n++; break; }
  }
  const views = [];
  for (const o of opens) views.push(await o.page.evaluate(() => { const v = window.__rt.view(); return { phase: v.phase, log: v.log, results: v.results.map((x) => ({ pattern: x.pattern, ordinal: x.ordinal, idx: x.idx, count: x.count, round: x.round ?? 1 })) }; }).catch(() => ({ phase: "none", log: [], results: [] })));
  return { steps: n, ended: views.map((v) => v.phase === "ended"), views };
}
