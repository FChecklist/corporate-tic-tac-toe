// Group 8: every public page, the game pages and the console at 360 / 768 / 1280 / 1920 px: horizontal overflow, text under 12 px, console errors, screenshots (test-results/sim-ui/).
// 12 scenarios: three families (public pages, game-state pages, console views) x four widths.
import { H, openConsole, openStep, guestJoinUi, nextPhone, WIDTHS, cohostUrl } from "./kit.mjs";

const DEV = { 360: ["mobile", 360, 740], 768: ["tablet", 768, 1024], 1280: ["laptop", 1280, 800], 1920: ["wide", 1920, 1080] };
const PUBLIC = ["/", "/signin.html", "/organizer-guide.html", "/trust.html", "/terms.html", "/legal.html", "/dpa.html", "/subprocessors.html", "/partner.html", "/partner-terms.html", "/demo.html", "/brochure.html", "/ai-link.html", "/this-page-does-not-exist"];
const label = (u) => (u === "/" ? "home" : u.replace(/[^\w]+/g, "_").replace(/^_|_$/g, ""));

/** visits each url in the open page; returns rows and records the checks. `min` = smallest allowed text in px. */
async function pass(t, x, w, urls, { wait = 700, min = 12, after } = {}) {
  const rows = [];
  for (const u of urls) {
    x.mon.clear();
    await x.page.goto(H.SIM + u, { waitUntil: "domcontentloaded" }).catch(() => {}); await x.page.waitForTimeout(wait);
    if (after) await after(x.page, u);
    const m = await H.measure(x.page, { minPx: min });
    await t.shot(x.page, `${label(u)}-${w}`);
    rows.push({ u, overflowX: m.overflowX, scrollWidth: m.scrollWidth, vw: m.viewport, small: m.smallText, wide: m.wideElements, errs: x.mon.pageErrors.length + x.mon.console.filter((c) => !/Failed to load resource/.test(c)).length, e5: x.mon.http5xx.length });
  }
  const over = rows.filter((r) => r.overflowX), errs = rows.filter((r) => r.errs || r.e5), small = rows.filter((r) => r.small.length);
  t.check(`no horizontal overflow at ${w} px (${rows.length} views)`, over.length === 0, over.map((r) => `${r.u} (${r.scrollWidth}>${r.vw}: ${r.wide.join(",")})`).join(" ; ").slice(0, 380));
  t.check(`no JavaScript or console errors at ${w} px`, errs.length === 0, errs.map((r) => r.u).join(" ; ").slice(0, 300));
  t.check(`no text under ${min} px at ${w} px`, small.length === 0, small.map((r) => `${r.u}: ${r.small.map(([k, v]) => k + "=" + v).join(",")}`).join(" ; ").slice(0, 400));
  for (const r of small) t.note(`small text ${w}px ${r.u}: ${JSON.stringify(r.small)}`);
  return rows;
}

const scen = [];
for (const w of WIDTHS) {
  const [dev, vw, vh] = DEV[w];
  scen.push({
    id: `S08-P${w}`, name: `Public pages at ${w} px: home, sign-in, guide, trust, legal pages, partner, demo, brochure, AI link, 404`,
    async run(t) { const x = await t.open({ device: dev, w: vw, h: vh }); await pass(t, x, w, PUBLIC); },
  });
}
for (const w of WIDTHS) {
  const [dev, vw, vh] = DEV[w];
  scen.push({
    id: `S08-G${w}`, name: `Game pages at ${w} px: join form, ticket, waiting, big screen, preview, pay page, pay link, cancelled game`,
    async run(t) {
      const org = await t.org("o");
      const g = await t.game(org, { settings: { whoCanJoin: "list", invites: { on: true, per: 2, cats: ["family"] }, brand: { name: "Sim Industries", color: "#6A1B9A" } }, cfg: { opening: [{ kind: "speech", title: "Hello from the sim", seconds: 15 }] }, pay: true });
      const unpaid = await t.game(org, { pay: false, settings: { whoCanJoin: "anyone" } });
      const link = (await org.api("POST", `/api/z/${unpaid.id}/paylink`, {})).body.url;
      const dead = await t.game(org, { pay: false }); await org.cancel(dead.id);
      const listed = nextPhone(); await org.addPeople(g.id, [{ name: "Listed Lia", phone: listed }]);
      const x = await t.open({ device: dev, w: vw, h: vh });
      await pass(t, x, w, [`/z?e=${g.id}`], { wait: 900 });
      // waiting room page
      await x.page.fill("#ph", nextPhone()); await x.page.fill("#nm", "Waiting Wes"); await x.page.click("#go"); await x.page.waitForTimeout(2000); await t.shot(x.page, `waiting-${w}`);
      const m1 = await H.measure(x.page); t.check(`waiting page: no overflow at ${w}`, !m1.overflowX, JSON.stringify(m1.wideElements));
      // the listed guest's ticket page
      const y = await t.open({ device: dev, w: vw, h: vh });
      await guestJoinUi(y.page, g.id, listed, "Listed Lia"); await y.page.waitForTimeout(3000); await t.shot(y.page, `ticket-${w}`);
      const m2 = await H.measure(y.page); t.check(`ticket page: no overflow at ${w}`, !m2.overflowX, JSON.stringify(m2.wideElements));
      t.check(`ticket page: text size at ${w}`, m2.smallText.length === 0, JSON.stringify(m2.smallText));
      const z = await t.open({ device: dev, w: vw, h: vh, token: org.token });
      await pass(t, z, w, [`/big.html?e=${g.id}`, `/preview.html#w=ticket&e=${g.id}`, `/pay.html?e=${unpaid.id}`, `/z?e=${dead.id}`], { wait: 1400 });
      const p = await t.open({ device: dev, w: vw, h: vh });
      const rows = await pass(t, p, w, [new URL(link).pathname + new URL(link).search], { wait: 1200 });
    },
  });
}
for (const w of WIDTHS) {
  const [dev, vw, vh] = DEV[w];
  scen.push({
    id: `S08-C${w}`, name: `Console at ${w} px: empty console, a game with each of the ten steps open, Host and Co-host views`,
    async run(t) {
      const org = await t.org("o");
      const g = await t.game(org, { settings: { whoCanJoin: "list", brand: { name: "Sim Industries", color: "#1B7F5C" } }, pay: true });
      const hm = t.mail("h"); const inv = await org.inviteHost({ label: "Hema", email: hm, mobile: nextPhone() }); const hf = await new H.Host(inv.hostKey).firstOpen({ email: hm, mobile: nextPhone() });
      const co = await org.inviteCohost({ label: "Chandra", phone: nextPhone(), e: g.id });
      const empty = await t.org("e");
      const x = await t.open({ device: dev, w: vw, h: vh, token: empty.token });
      await pass(t, x, w, ["/zc"], { wait: 1500 });
      const c = await t.open({ device: dev, w: vw, h: vh, token: org.token });
      await c.page.goto(`${H.SIM}/zc?e=${g.id}`); await c.page.waitForSelector(".zc-sech"); await c.page.waitForTimeout(800);
      const rows = [];
      for (let n = 1; n <= 10; n++) {
        await openStep(c.page, n).catch(() => {}); await c.page.waitForTimeout(350);
        const m = await H.measure(c.page, { minPx: 12 }); await t.shot(c.page, `console-step${n}-${w}`);
        rows.push({ n, overflowX: m.overflowX, w: m.wideElements, small: m.smallText });
      }
      t.check(`console: no horizontal overflow in any of the ten steps at ${w} px`, rows.every((r) => !r.overflowX), rows.filter((r) => r.overflowX).map((r) => `step ${r.n}: ${r.w.join(",")}`).join(" ; "));
      t.check(`console: no text under 12 px at ${w} px`, rows.every((r) => !r.small.length), rows.filter((r) => r.small.length).map((r) => `step ${r.n}: ${r.small.map(([k, v]) => k + "=" + v).join(",")}`).join(" ; ").slice(0, 400));
      const h = await t.open({ device: dev, w: vw, h: vh, token: hf.token });
      await pass(t, h, w, [`/zc?e=${g.id}`], { wait: 1500 });
      const k = await t.open({ device: dev, w: vw, h: vh });
      await k.page.goto(cohostUrl(g.id, co)); await k.page.waitForTimeout(2200);
      const m = await H.measure(k.page); await t.shot(k.page, `cohost-${w}`);
      t.check(`Co-host view: no overflow at ${w}`, !m.overflowX, JSON.stringify(m.wideElements));
      t.check(`Co-host view: no text under 12 px at ${w}`, m.smallText.length === 0, JSON.stringify(m.smallText));
    },
  });
}
export default scen;
