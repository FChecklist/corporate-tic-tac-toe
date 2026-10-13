// Group 8: every public page, the game pages and the console at 360 / 768 / 1280 / 1920 px: horizontal overflow, text under 12 px, console errors, screenshots (test-results/sim-ui/).
// 12 scenarios: three families (public pages, game-state pages, console views) x four widths.
import { H, openConsole, openStep, guestJoinUi, nextPhone, WIDTHS, cohostUrl, joinForm, passK5Gate, openHostPage, startTournament, tapOnce, smallTargets } from "./kit.mjs";

const DEV = { 360: ["mobile", 360, 740], 768: ["tablet", 768, 1024], 1280: ["laptop", 1280, 800], 1920: ["wide", 1920, 1080] };
const PUBLIC = ["/", "/signin.html", "/organizer-guide.html", "/trust.html", "/terms.html", "/legal.html", "/dpa.html", "/subprocessors.html", "/partner.html", "/partner-terms.html", "/demo.html", "/brochure.html", "/ai-link.html", "/pricing.html", "/about.html", "/contact.html", "/refund-policy.html", "/legal-position.html", "/this-page-does-not-exist"];
const label = (u) => (u === "/" ? "home" : u.replace(/[^\w]+/g, "_").replace(/^_|_$/g, ""));

/** visits each url in the open page; returns rows and records the checks. `min` = smallest allowed text in px. */
async function pass(t, x, w, urls, { wait = 700, min = 12, after } = {}) {
  const rows = [];
  for (const u of urls) {
    x.mon.clear();
    await x.page.goto(H.SIM + u, { waitUntil: "domcontentloaded" }).catch(() => {}); await x.page.waitForTimeout(wait);
    if (after) await after(x.page, u);
    const m = await H.measure(x.page, { minPx: min }); const tg = w <= 768 ? await smallTargets(x.page, 32) : [];
    await t.shot(x.page, `${label(u)}-${w}`);
    rows.push({ u, tg, overflowX: m.overflowX, scrollWidth: m.scrollWidth, vw: m.viewport, small: m.smallText, wide: m.wideElements, errs: x.mon.pageErrors.length + x.mon.console.filter((c) => !/Failed to load resource/.test(c)).length, e5: x.mon.http5xx.length });
  }
  const over = rows.filter((r) => r.overflowX), errs = rows.filter((r) => r.errs || r.e5), small = rows.filter((r) => r.small.length);
  t.check(`no horizontal overflow at ${w} px (${rows.length} views)`, over.length === 0, over.map((r) => `${r.u} (${r.scrollWidth}>${r.vw}: ${r.wide.join(",")})`).join(" ; ").slice(0, 380));
  t.check(`no JavaScript or console errors at ${w} px`, errs.length === 0, errs.map((r) => r.u).join(" ; ").slice(0, 300));
  t.check(`no text under ${min} px at ${w} px`, small.length === 0, small.map((r) => `${r.u}: ${r.small.map(([k, v]) => k + "=" + v).join(",")}`).join(" ; ").slice(0, 400));
  for (const r of small) t.note(`small text ${w}px ${r.u}: ${JSON.stringify(r.small)}`);
  if (w <= 768) { const bad = rows.filter((r) => r.tg.length); t.check(`buttons, fields and tick boxes are at least 32 px high and wide at ${w} px`, bad.length === 0, bad.map((r) => `${r.u}: ${r.tg.join(",")}`).join(" ; ").slice(0, 420)); }
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
    id: `S08-G${w}`, name: `Game pages at ${w} px: join form, waiting room, "you are in", big screen, preview, pay page, pay link, cancelled game`,
    async run(t) {
      const org = await t.org("o");
      const g = await t.game(org, { settings: { whoCanJoin: "list", brand: { name: "Sim Industries", color: "#6A1B9A" } }, pay: true });
      const open = await t.game(org, { settings: { whoCanJoin: "anyone" }, pay: true });
      const unpaid = await t.game(org, { pay: false, settings: { whoCanJoin: "anyone" } });
      const link = (await org.api("POST", `/api/z/${unpaid.id}/paylink`, {})).body.url;
      const dead = await t.game(org, { pay: false }); await org.cancel(dead.id);
      const x = await t.open({ device: dev, w: vw, h: vh });
      await pass(t, x, w, [`/z?e=${g.id}`], { wait: 900 });
      // waiting room page (the game is by invitation and this person is not on the list)
      await joinForm(x.page, "", "Waiting Wes"); await x.page.waitForTimeout(2000); await t.shot(x.page, `waiting-${w}`);
      const m1 = await H.measure(x.page); t.check(`waiting page: no overflow at ${w}`, !m1.overflowX, JSON.stringify(m1.wideElements));
      t.check(`waiting page: text size at ${w}`, m1.smallText.length === 0, JSON.stringify(m1.smallText));
      // "You are in" (anyone with the link)
      const y = await t.open({ device: dev, w: vw, h: vh });
      await guestJoinUi(y.page, open.id, "", "Listed Lia"); await y.page.waitForTimeout(3000); await t.shot(y.page, `youarein-${w}`);
      const m2 = await H.measure(y.page); t.check(`"You are in" page: no overflow at ${w}`, !m2.overflowX, JSON.stringify(m2.wideElements));
      t.check(`"You are in" page: text size at ${w}`, m2.smallText.length === 0, JSON.stringify(m2.smallText));
      const z = await t.open({ device: dev, w: vw, h: vh, token: org.token });
      await pass(t, z, w, [`/big.html?e=${g.id}`, `/preview.html#w=player&e=${g.id}`, `/pay.html?e=${unpaid.id}`, `/z?e=${dead.id}`], { wait: 1400 });
      const p = await t.open({ device: dev, w: vw, h: vh });
      await pass(t, p, w, [new URL(link).pathname + new URL(link).search], { wait: 1200 });
    },
  });
}
for (const w of WIDTHS) {
  const [dev, vw, vh] = DEV[w];
  scen.push({
    id: `S08-T${w}`, name: `Tournament pages at ${w} px: the Organizer's tournament page before and during the tournament, the player's board, the big screen while it runs and at the end`,
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { settings: { whoCanJoin: "anyone" }, pay: true });
      const a = await t.open({ device: dev, w: vw, h: vh }), b = await t.open({ device: "mobile" });
      await guestJoinUi(a.page, g.id, "", "Board Bea"); await guestJoinUi(b.page, g.id, "", "Board Bo");
      await a.page.waitForSelector(".zcard h2"); await b.page.waitForSelector(".zcard h2");
      const h = await t.open({ device: dev, w: vw, h: vh, token: org.token });
      await pass(t, h, w, [`/host.html?e=${g.id}`], { wait: 1500 });
      h.page.on("dialog", (d) => d.accept().catch(() => {}));
      await startTournament(h, { moveSecs: 30 });
      await Promise.all([a, b].map((p) => p.page.waitForSelector(".tboard", { timeout: 30000 })));
      await a.page.waitForTimeout(800);
      const m = await H.measure(a.page); await t.shot(a.page, `board-${w}`);
      t.check(`player's board: no horizontal overflow at ${w}`, !m.overflowX, JSON.stringify(m.wideElements));
      t.check(`player's board: no text under 12 px at ${w}`, m.smallText.length === 0, JSON.stringify(m.smallText));
      const sq = await a.page.$$eval(".tsq", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); }));
      t.check(`player's board: the nine squares are at least 44 px wide and high at ${w}`, sq.length === 9 && sq.every((n) => n >= 44), JSON.stringify(sq));
      if (w <= 768) { const tg = await smallTargets(a.page, 32); t.check(`player's board: buttons are at least 32 px at ${w}`, tg.length === 0, tg.join(",")); }
      const big = await t.open({ device: dev, w: vw, h: vh });
      await pass(t, big, w, [`/big.html?e=${g.id}`], { wait: 3000 });
      await pass(t, h, w, [`/host.html?e=${g.id}`], { wait: 1500 });
      const live = await t.text(h.page);
      t.check("the tournament page shows it is running with a Pause button", /Running/i.test(live) && !!(await h.page.$("#pause")), live.slice(0, 200));
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
        rows.push({ n, overflowX: m.overflowX, w: m.wideElements, small: m.smallText, tg: w <= 768 ? await smallTargets(c.page, 32) : [] });
      }
      t.check(`console: no horizontal overflow in any of the ten steps at ${w} px`, rows.every((r) => !r.overflowX), rows.filter((r) => r.overflowX).map((r) => `step ${r.n}: ${r.w.join(",")}`).join(" ; "));
      if (w <= 768) t.check(`console: buttons, fields and tick boxes are at least 32 px high and wide in all ten steps at ${w} px`, rows.every((r) => !r.tg.length), rows.filter((r) => r.tg.length).map((r) => `step ${r.n}: ${r.tg.join(",")}`).join(" ; ").slice(0, 420));
      t.check(`console: no text under 12 px at ${w} px`, rows.every((r) => !r.small.length), rows.filter((r) => r.small.length).map((r) => `step ${r.n}: ${r.small.map(([k, v]) => k + "=" + v).join(",")}`).join(" ; ").slice(0, 400));
      const h = await t.open({ device: dev, w: vw, h: vh, token: hf.token });
      await pass(t, h, w, [`/zc?e=${g.id}`], { wait: 1500 });
      const k = await t.open({ device: dev, w: vw, h: vh });
      await k.page.goto(cohostUrl(g.id, co)); await passK5Gate(k.page); await k.page.waitForTimeout(2200);
      const m = await H.measure(k.page); await t.shot(k.page, `cohost-${w}`);
      t.check(`Co-host view: no overflow at ${w}`, !m.overflowX, JSON.stringify(m.wideElements));
      t.check(`Co-host view: no text under 12 px at ${w}`, m.smallText.length === 0, JSON.stringify(m.smallText));
    },
  });
}
export default scen;
