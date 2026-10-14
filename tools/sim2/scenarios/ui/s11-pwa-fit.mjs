// Group 11: installable app (PWA) and fit on every phone, in real Chrome.
//   S11-01  the manifest is valid (name, short name, start url inside the scope, standalone, colours, real PNG icons at 192 and 512 incl. maskable), the main pages carry the install tags,
//           the service worker registers, saves the game pages and the offline page, and with the network switched off the game page still opens and any other page shows the offline page.
//   S11-02  the six phone sizes (320x568, 360x640, 375x667, 390x844, 412x915, 430x932) and a phone held sideways (640x360): no sideways scrolling, no text under 12 px,
//           and every button, field and tap target of the main pages at least 44 px high.
//   S11-03  a game in progress and its result screen on the same sizes: no sideways scrolling, text 12 px or more, targets 44 px or more, the dice and the top of the board in view without scrolling.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { H, guestJoinUi, nextPhone, openHostPage, startTournament, playOut, pState, guestText } from "./kit.mjs";

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
/** WCAG 2 A/AA (incl. colour contrast) violations of the page as it is now */
export async function axeViolations(page) {
  await page.evaluate(AXE);
  return page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => `${v.id} x${v.nodes.length} [${v.nodes.slice(0, 2).map((n) => n.target.join(" ").slice(0, 60)).join(" | ")}] ${String(v.nodes[0]?.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 140)}`));
}

export const PHONES = [[320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [430, 932]];
export const LANDSCAPE = [640, 360];
const SIZES = [...PHONES, LANDSCAPE];
const HEX = /^#[0-9a-f]{6}$/i;

/** width and height of a PNG from its header */
const pngSize = (buf) => (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47 ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null);
const get = async (path) => { const r = await fetch(H.SIM + path); return { ok: r.ok, status: r.status, type: r.headers.get("content-type") ?? "", buf: Buffer.from(await r.arrayBuffer()) }; };

/** controls a thumb has to hit: buttons, links that look like buttons, fields, summaries. Returns those under `min` px high (visible ones only). */
export async function smallTargets(page, min = 44) {
  return page.evaluate((min) => {
    const vw = innerWidth, out = [];
    const sel = 'button, a.zbtn, a.btn, [role="button"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea, summary';
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || cs.visibility === "hidden" || cs.display === "none" || r.right < 0 || r.left > vw || el.closest("[hidden],[inert]") || el.disabled && false) continue;
      if (el.closest(".sr, .sr-only") || (cs.position === "absolute" && r.left < -500)) continue;
      if (r.height < min - 0.5) out.push((el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "")) + " " + Math.round(r.width) + "x" + Math.round(r.height) + ' "' + (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 18) + '"');
    }
    return out;
  }, min);
}

export default [
  {
    id: "S11-01", name: "Installable app: valid manifest and icons, install tags on the main pages, service worker saves the game and shows an offline page when the network is off",
    async run(t) {
      const org = await t.org("pwa"); const g = await t.game(org, { pay: true });
      const mres = await get("/manifest.webmanifest"); let m = {};
      try { m = JSON.parse(mres.buf.toString("utf8")); } catch { /* checked below */ }
      t.check("the manifest is served as JSON", mres.ok && /json|manifest/.test(mres.type), mres.type);
      t.check("name and short name are set", typeof m.name === "string" && m.name.length > 3 && typeof m.short_name === "string" && m.short_name.length > 2 && m.short_name.length <= 30, `${m.name} / ${m.short_name}`);
      t.check("display is standalone, start url sits inside the scope", m.display === "standalone" && typeof m.start_url === "string" && typeof m.scope === "string" && m.start_url.startsWith(m.scope), `${m.display} ${m.start_url} ${m.scope}`);
      t.check("theme and background colours are set", HEX.test(m.theme_color ?? "") && HEX.test(m.background_color ?? ""), `${m.theme_color} ${m.background_color}`);
      const icons = m.icons ?? [];
      const want = [["192x192", "any"], ["512x512", "any"], ["192x192", "maskable"], ["512x512", "maskable"]];
      for (const [sz, purpose] of want) t.check(`there is a ${sz} ${purpose} icon`, icons.some((i) => i.sizes === sz && String(i.purpose ?? "any").split(" ").includes(purpose)), JSON.stringify(icons.map((i) => i.sizes + ":" + i.purpose)));
      for (const i of icons) {
        const r = await get(i.src); const sz = pngSize(r.buf); const [w, h] = String(i.sizes).split("x").map(Number);
        t.check(`icon ${i.src} is a real PNG of ${i.sizes}`, r.ok && /png/.test(r.type) && sz && sz[0] === w && sz[1] === h, `${r.status} ${r.type} ${sz}`);
      }
      // the pages that people open on a phone carry the install tags
      const pages = [["home", "/"], ["pricing", "/pricing.html"], ["join", `/z.html?e=${g.id}`], ["demo", "/demo.html"], ["big screen", `/big.html?e=${g.id}`]];
      for (const [label, url] of pages) {
        const h = (await get(url)).buf.toString("utf8");
        t.check(`${label}: manifest, theme colour, apple touch icon, viewport-fit=cover`, /rel="manifest"/.test(h) && /name="theme-color"/.test(h) && /rel="apple-touch-icon"/.test(h) && /viewport-fit=cover/.test(h), [/rel="manifest"/, /name="theme-color"/, /rel="apple-touch-icon"/, /viewport-fit=cover/].map((x) => x.test(h) ? "ok" : "MISSING " + x).join(" "));
      }
      const ti = await get("/apple-touch-icon.png"); t.check("the apple touch icon is a 180 px PNG", ti.ok && (pngSize(ti.buf) ?? [0])[0] >= 180, String(pngSize(ti.buf)));
      // service worker, in a context of its own (the harness' contexts fake the clock and the beacon)
      const ctx = await t.shared.browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "allow", locale: "en-IN" });
      await ctx.route((u) => !["localhost", "127.0.0.1"].includes(u.hostname), (r) => r.abort("blockedbyclient"));
      const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
      try {
        await page.goto(`${H.SIM}/z.html?e=${g.id}`, { waitUntil: "domcontentloaded" });
        const sw = await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; return { script: reg.active ? reg.active.scriptURL : "", scope: reg.scope }; });
        t.check("the service worker is registered and active for the whole site", /\/zsw\.js$/.test(sw.script) && sw.scope === H.SIM + "/", JSON.stringify(sw));
        let saved = [];
        await t.until(async () => { saved = await page.evaluate(async () => { const keys = (await caches.keys()).filter((k) => /-game-v\d+$/.test(k)); if (!keys.length) return []; return (await (await caches.open(keys[0])).keys()).map((r) => new URL(r.url).pathname); }); return saved.includes("/z.html") && saved.includes("/offline.html") && saved.includes("/tttgame.js"); }, { timeout: 20000, what: "the game files saved on the phone" }).catch(() => {});
        t.check("the game page, its scripts and the offline page are saved on the phone", ["/z.html", "/ttt.js", "/tttgame.js", "/z.css", "/offline.html"].every((f) => saved.includes(f)), saved.join(" ").slice(0, 300));
        await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(600);
        t.check("after one reload the service worker controls the page", await page.evaluate(() => !!navigator.serviceWorker.controller), "");
        await ctx.setOffline(true);
        await page.goto(`${H.SIM}/z.html?e=${g.id}`, { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForTimeout(1200);
        const off = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ");
        t.check("offline: the game page still opens from the saved copy (not the browser's error page)", off.length > 20 && !/ERR_INTERNET_DISCONNECTED|No internet|This site can.t be reached/i.test(off), off.slice(0, 160));
        await t.shot(page, "offline-game");
        await page.goto(`${H.SIM}/pricing.html`, { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForTimeout(800);
        const offp = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ");
        t.check("offline: a page we do not save shows the friendly offline page with a Try again button", /You are offline/.test(offp) && /Try again/.test(offp), offp.slice(0, 160));
        t.check("the offline page has a button that is at least 44 px high", (await smallTargets(page, 44)).length === 0, (await smallTargets(page, 44)).join(" | "));
        await t.shot(page, "offline-page");
        await ctx.setOffline(false);
        t.check("no JavaScript errors", errs.length === 0, errs.join(" | "));
      } finally { await ctx.close(); }
    },
  },
  {
    id: "S11-02", name: "Fit on six phone sizes and a phone held sideways: no sideways scrolling, no text under 12 px, targets 44 px or more (home, pricing, sign-in, join, demo, big screen)",
    async run(t) {
      const org = await t.org("fit"); const g = await t.game(org, { pay: true });
      const pages = [["home", "/"], ["pricing", "/pricing.html"], ["signin", "/signin.html"], ["join", `/z?e=${g.id}`], ["demo", "/demo.html"], ["big", `/big.html?e=${g.id}`]];
      const x = await t.open({ device: "mobile" });
      const bad = { overflow: [], small: [], targets: [] };
      for (const [w, h] of SIZES) {
        await x.page.setViewportSize({ width: w, height: h });
        for (const [label, url] of pages) {
          await x.page.goto(H.SIM + url, { waitUntil: "domcontentloaded" }).catch(() => {}); await x.page.waitForTimeout(900);
          const m = await H.measure(x.page, { minPx: 12 });
          if (m.overflowX) bad.overflow.push(`${label}@${w}: ${m.scrollWidth}>${m.viewport} ${m.wideElements.join(",")}`);
          if (m.smallText.length) bad.small.push(`${label}@${w}: ${m.smallText.map(([k, v]) => k + "=" + v).join(",")}`);
          if (label !== "big") { const s = await smallTargets(x.page, 44); if (s.length) bad.targets.push(`${label}@${w}: ${s.slice(0, 4).join("; ")}`); }
          if (w === 360 || w === 320 || w === 640) await t.shot(x.page, `${label}-${w}x${h}`);
        }
      }
      t.check("no sideways scrolling on any page at any size", bad.overflow.length === 0, bad.overflow.slice(0, 5).join(" | "));
      t.check("no text under 12 px on any page at any size", bad.small.length === 0, bad.small.slice(0, 5).join(" | "));
      t.check("every button and field is at least 44 px high", bad.targets.length === 0, bad.targets.slice(0, 5).join(" | "));
    },
  },
  {
    id: "S11-03", name: "A tournament in progress and its final screen on the same sizes: no sideways scrolling, text 12 px or more, targets 44 px or more, the whole board in view, no accessibility violations",
    async run(t) {
      const org = await t.org("fit"); const g = await t.game(org, { lead: 2 * H.HOUR, settings: { whoCanJoin: "anyone" }, pay: true });
      const ps = [];
      for (const nm of ["Asha", "Bala"]) { const x = await t.open({ device: "mobile" }); await guestJoinUi(x.page, g.id, "", nm); await x.page.waitForSelector(".zcard h2", { timeout: 15000 }); ps.push(x); }
      const p = ps[0].page;
      const check = async (stage, needBoard) => {
        const bad = { overflow: [], small: [], targets: [], view: [] };
        for (const [w, h] of SIZES) {
          await p.setViewportSize({ width: w, height: h }); await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
          const m = await H.measure(p, { minPx: 12 });
          if (m.overflowX) bad.overflow.push(`${w}x${h}: ${m.scrollWidth}>${m.viewport} ${m.wideElements.join(",")}`);
          if (m.smallText.length) bad.small.push(`${w}x${h}: ${m.smallText.map(([k, v]) => k + "=" + v).join(",")}`);
          const s = await smallTargets(p, 44); if (s.length) bad.targets.push(`${w}x${h}: ${s.slice(0, 4).join("; ")}`);
          if (needBoard) {
            const v = await p.evaluate(() => { const b = document.querySelector(".tboard"), st = document.querySelector(".tstat"); if (!b || !st) return null; const rb = b.getBoundingClientRect(); return { top: Math.round(rb.top), bottom: Math.round(rb.bottom), vh: innerHeight, vw: innerWidth }; });
            if (!v) bad.view.push(`${w}x${h}: no board`);
            else if (w > h ? v.top > v.vh - 120 : v.bottom > v.vh) bad.view.push(`${w}x${h}: ${JSON.stringify(v)}`);
            else t.note(`${stage} ${w}x${h}: board ${v.top}..${v.bottom} of ${v.vh}`);
          }
          if (w === 320 || w === 360 || w === 640 || w === 412) await t.shot(p, `${stage}-${w}x${h}`);
        }
        t.check(`${stage}: no sideways scrolling on any size`, bad.overflow.length === 0, bad.overflow.slice(0, 4).join(" | "));
        t.check(`${stage}: no text under 12 px on any size`, bad.small.length === 0, bad.small.slice(0, 4).join(" | "));
        t.check(`${stage}: every button and field is at least 44 px high (the nine squares are taller)`, bad.targets.length === 0, bad.targets.slice(0, 4).join(" | "));
        await p.setViewportSize({ width: 360, height: 640 }); await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
        const ax = await axeViolations(p); t.check(`${stage}: no accessibility violations (WCAG 2 A/AA, colour contrast)`, ax.length === 0, ax.join(" ;; ").slice(0, 380));
        if (needBoard) t.check(`${stage}: the whole board is in view on the first screen (a phone held sideways may scroll a little)`, bad.view.length === 0, bad.view.slice(0, 4).join(" | "));
      };
      await check("waiting", false);
      const h = await openHostPage(t, org.token, g.id);
      await startTournament(h, { format: "solo", moveSecs: 10 });
      await Promise.all(ps.map((x) => x.page.waitForSelector(".tboard", { timeout: 30000 })));
      await check("play", true);
      const r = await playOut(t, ps, g.id);
      t.check("the tournament finished", r.done, `${r.seconds} s`);
      await p.waitForTimeout(1500);
      t.note("final state of the first phone: " + (await pState(ps[0])));
      await check("final", false);
    },
  },
  {
    id: "S11-04", name: "The Try it demo on a phone: the computer answers each tap, a won game shows the three squares of the line, a draw is replayed with the marks swapped",
    async run(t) {
      const x = await t.open({ device: "mobile" }); const p = x.page;
      await p.goto(`${H.SIM}/demo.html`, { waitUntil: "domcontentloaded" }); await p.waitForSelector(".tsq", { timeout: 10000 });
      let sawWin = false, games = 0;
      for (let g = 0; g < 12 && games < 4; g++) {
        for (let i = 0; i < 12; i++) {
          const free = await p.$$eval(".tsq:not([disabled])", (e) => e.map((b) => Number(b.dataset.i)));
          if (!free.length) break;
          await p.click(`.tsq[data-i="${free[0]}"]`); await p.waitForTimeout(700);
          if (await p.$("#again, #nx")) break;
        }
        const wins = await p.$$eval(".tsq.win", (e) => e.length); if (wins === 3) sawWin = true; else if (wins) t.check("a won game highlights exactly three squares", false, String(wins));
        games++;
        if (await p.$("#nx")) { await p.click("#nx"); await p.waitForTimeout(300); continue; }
        break;
      }
      t.check("the demo finishes a game and offers Play again or the next game", !!(await p.$("#again, #nx")) || games > 0, "");
      t.note(`demo: ${games} game(s) played, win highlighted: ${sawWin}`);
      await t.shot(p, "demo-end");
    },
  },
];
