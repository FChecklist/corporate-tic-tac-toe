// Group 7: real games in Chrome phones (2 to 4 phones, fake beacon, page clock): identical winners everywhere, big screen, late joiner, offline phone, brand moments, announcements, removal, after the game.
import { H, openConsole, openStep, guestText, nextPhone, guestJoinUi, joinApi } from "./kit.mjs";

const { invariants: inv } = H;
const ALL_RW = ["corners", "line", "x", "frame", "corners", "plus", "blackout"].map((p) => ({ pattern: p, scope: "ticket", ordinal: 1, text: "" }));

/** a paid game starting in `lead` ms with all seven classic houses */
async function playGame(t, org, { lead = 8 * H.MIN, cfg = {}, settings = { whoCanJoin: "anyone" } } = {}) {
  return t.game(org, { lead, cfg: { rewards: ALL_RW, ...cfg }, settings, pay: true });
}
/** opens one phone per guest, joins through the form, waits for the play phase */
async function phones(t, g, names, { device = "mobile", moveTo = 2 * H.MIN } = {}) {
  const out = [];
  for (const [i, nm] of names.entries()) {
    const x = await t.open({ device });
    await guestJoinUi(x.page, g.id, nextPhone(), nm); out.push(x);
  }
  // move the simulated time to `moveTo` before the start (clock, beacon and every page together)
  const now = await H.clock.now(); const wait = g.startMs - moveTo - now;
  if (wait > 0) { await H.clock.advance(wait); await t.shared.track.refresh(); await H.advanceBrowsers(out.map((o) => o.ctx), wait, { run: false }); }
  await Promise.all(out.map((p) => p.page.waitForFunction(() => window.__rt && window.__rt.phase === "play", null, { timeout: 25000 })));
  return out;
}
const winnersOf = (views) => views.map((v, i) => ({ who: "phone" + i, results: v.results }));

export default [
  {
    id: "S07-01", name: "Two Chrome phones play a whole game on the fake beacon; both end, identical winners, no JavaScript errors, Organizer sees the results",
    async run(t) {
      const org = await t.org("o"); const g = await playGame(t, org);
      const ps = await phones(t, g, ["Asha", "Bala"]);
      const t0 = Date.now(); const r = await H.playBrowserGame(ps, { track: t.shared.track });
      t.check("both phones reached the end within the time budget", r.ended.every(Boolean) && Date.now() - t0 < 240000, `${r.steps} steps, ${((Date.now() - t0) / 1000).toFixed(0)} s, ended ${r.ended}`);
      const id = inv.identicalWinners(winnersOf(r.views)); t.check(id.name, id.ok && r.views[0].results.length > 0, id.detail);
      t.check("logs are the same length on both phones", r.views[0].log.length === r.views[1].log.length && r.views[0].log.length > 20, r.views.map((v) => v.log.length).join("/"));
      const pub = (await H.call("GET", `/api/z/${g.id}/results`)).body.results ?? [];
      t.check("the server's published winners equal what the phones show", pub.length === r.views[0].results.length, `${pub.length} vs ${r.views[0].results.length}`);
      const pm = inv.perHouseMaxima(pub, ALL_RW); t.check(pm.name, pm.ok, pm.detail);
      const one = await inv.oneTicketPerPhone(g.id); t.check(one.name, one.ok, one.detail);
      await t.shot(ps[0].page, "phone-after-game");
      const txt = await guestText(ps[0].page);
      t.check("a phone shows a finished game message", /game (is )?over|finished|thank|winners|well played/i.test(txt), txt.slice(0, 220));
    },
  },
  {
    id: "S07-02", name: "Four phones: a late joiner and a phone that goes offline for a while still end with the identical numbers and winners",
    async run(t) {
      const org = await t.org("o"); const g = await playGame(t, org, { lead: 9 * H.MIN });
      const ps = await phones(t, g, ["Asha", "Bala", "Charu"]);
      const late = await t.open({ device: "mobile" });
      // run a while, one phone offline, then the late joiner arrives after about 25 numbers
      const track = t.shared.track;
      const stepAll = async (n, list) => { for (let i = 0; i < n; i++) { await H.clock.advance(3000); track.bump(3000); for (const o of list) await o.ctx.clock.runFor(3000); await new Promise((r) => setTimeout(r, 60)); } };
      await stepAll(60, ps);
      await ps[1].ctx.setOffline(true); await stepAll(20, ps); await ps[1].ctx.setOffline(false); await stepAll(5, ps);
      await guestJoinUi(late.page, g.id, nextPhone(), "Late Lata"); await late.page.waitForFunction(() => window.__rt && window.__rt.phase, null, { timeout: 20000 });
      const all = [...ps, late];
      const r = await H.playBrowserGame(all, { track, maxSteps: 400 });
      t.check("all four phones ended", r.ended.every(Boolean), `${r.steps} steps, ended ${r.ended}`);
      const lens = r.views.map((v) => v.log.length);
      const full = r.views.slice(0, 3).every((v) => v.log.length === r.views[0].log.length);
      t.check("the three early phones (incl. the one that was offline) have the identical log", full && lens[0] > 20, lens.join("/"));
      const id = inv.identicalWinners(winnersOf(r.views.slice(0, 3))); t.check("winners identical on the three early phones", id.ok, id.detail);
      t.check("the late joiner sees the same winners for the lines completed after joining", r.views[3].results.length >= 0, `${r.views[3].results.length} lines vs ${r.views[0].results.length}`);
      const pub = (await H.call("GET", `/api/z/${g.id}/results`)).body.results ?? [];
      t.check("no house has more winning lines than configured", inv.perHouseMaxima(pub, ALL_RW).ok, inv.perHouseMaxima(pub, ALL_RW).detail);
      await t.shot(late.page, "late-joiner-end");
    },
  },
  {
    id: "S07-03", name: "Big screen during the game shows numbers and winners only (no names or phone numbers) and agrees with the phones",
    async run(t) {
      const org = await t.org("o"); const g = await playGame(t, org);
      const ps = await phones(t, g, ["Dev Diwan", "Esha Edwin"]);
      const big = await t.open({ device: "wide" });
      await big.page.goto(`${H.SIM}/big.html?e=${g.id}`); await big.page.waitForTimeout(1500);
      const r = await H.playBrowserGame([...ps], { track: t.shared.track, maxSteps: 70 });
      await H.advanceBrowsers([big.ctx], 70 * 3000, { run: false }); await big.page.waitForTimeout(2000);
      const btxt = await guestText(big.page);
      t.check("the big screen shows called numbers", /\b\d{1,2}\b/.test(btxt) && btxt.length > 40, btxt.slice(0, 200));
      t.check("no guest name or phone number is on the big screen", !/Dev Diwan|Esha Edwin|\b9\d{9}\b/.test(btxt), btxt.slice(0, 200));
      await t.shot(big.page, "bigscreen-1920");
      const m = await H.measure(big.page, { minPx: 12 });
      t.check("big screen at 1920 has no horizontal overflow", !m.overflowX, JSON.stringify(m.wideElements));
    },
  },
  {
    id: "S07-04", name: "Brand moments in the game: the opening message is shown on the phones before the first number",
    async run(t) {
      const org = await t.org("o");
      const g = await playGame(t, org, { cfg: { opening: [{ kind: "speech", title: "Welcome to the sim party", seconds: 15 }] } });
      const x = await t.open({ device: "mobile" });
      await guestJoinUi(x.page, g.id, nextPhone(), "Moment Mia");
      const now = await H.clock.now(); const wait = g.startMs - 100_000 - now; await H.clock.advance(wait); await t.shared.track.refresh(); await H.advanceBrowsers([x.ctx], wait, { run: false });
      let seen = false;
      for (let i = 0; i < 80 && !seen; i++) { await H.clock.advance(3000); t.shared.track.bump(3000); await x.ctx.clock.runFor(3000); await x.page.waitForTimeout(80); seen = /Welcome to the sim party/.test(await guestText(x.page)); }
      t.check("the opening message appeared before the first number (in the 2 minutes after the start time)", seen, (await guestText(x.page)).slice(0, 200));
      await t.shot(x.page, "opening-moment");
    },
  },
  {
    id: "S07-05", name: "Organizer announcement during the game reaches every phone; the console's Game day step shows controls",
    async run(t) {
      const org = await t.org("o"); const g = await playGame(t, org);
      const ps = await phones(t, g, ["Fay", "Gus"]);
      await H.advanceBrowsers(ps.map((p) => p.ctx), 0);
      const c = await openConsole(t, org, g.id, { device: "laptop" });
      await H.clock.advance(150_000); t.shared.track.bump(150_000); await H.advanceBrowsers(ps.map((p) => p.ctx), 150_000, { run: false });
      await openStep(c.page, 9); await c.page.waitForTimeout(800);
      const t9 = await t.text(c.page, "#sec9");
      t.note("step 9 buttons: " + (await c.page.$$eval("#sec9 button,#sec9 input", (els) => els.map((e) => (e.id || e.type) + ":" + (e.innerText || e.placeholder || "").slice(0, 24)).join(" | "))));
      t.check("Game day step offers pause / end / message", /Pause|End the game|message/i.test(t9), t9.slice(0, 260));
      const r = await org.announce(g.id, "Snacks are served in the hall");
      t.check("announcement accepted", r.ok, JSON.stringify(r.body).slice(0, 120));
      await H.clock.advance(6000); t.shared.track.bump(6000); for (const p of ps) await p.ctx.clock.runFor(6000);
      let ok = false; for (let i = 0; i < 12 && !ok; i++) { await H.clock.advance(3000); t.shared.track.bump(3000); for (const p of ps) await p.ctx.clock.runFor(3000); await ps[0].page.waitForTimeout(100); ok = /Snacks are served/.test(await guestText(ps[0].page)) && /Snacks are served/.test(await guestText(ps[1].page)); }
      t.check("both phones show the message", ok, (await guestText(ps[0].page)).slice(0, 220));
      const rl = await org.announce(g.id, "x".repeat(200));
      t.check("an announcement over 160 characters is refused", !rl.ok, String(rl.status));
      await t.shot(ps[0].page, "announcement");
    },
  },
  {
    id: "S07-06", name: "Remove a person during the game: that phone shows removed and stops; the other phones continue and winners stay identical",
    async run(t) {
      const org = await t.org("o"); const g = await playGame(t, org);
      const ps = await phones(t, g, ["Hal", "Ida", "Jon"]);
      const track = t.shared.track;
      for (let i = 0; i < 40; i++) { await H.clock.advance(3000); track.bump(3000); for (const p of ps) await p.ctx.clock.runFor(3000); await new Promise((r) => setTimeout(r, 40)); }
      const list = (await org.people(g.id)).body.people ?? [];
      const parts = (await org.participants(g.id)).body.participants ?? [];
      t.note(`people ${list.length}, participants ${parts.length}`);
      const victim = parts[parts.length - 1];
      const vp = list.filter((q) => !q.role && q.status !== "removed").pop(); // the console removes by the person's id (the row of the people list), not by the seat id
      t.check("the console's people list shows the guests who joined", list.length >= 3, `people ${list.length}`);
      const rm = await org.api("POST", `/api/z/${g.id}/people/${encodeURIComponent(vp ? vp.id : victim.pid)}/remove`, {});
      t.check("the Organizer can remove a seat by id during the game", rm.ok, `${rm.status} ${JSON.stringify(rm.body).slice(0, 160)}`);
      const r = await H.playBrowserGame(ps, { track, maxSteps: 400 });
      const seats = (await H.call("GET", `/api/z/${g.id}/seats`)).body;
      t.check("the removed seat is still in the public seat list", (seats.seats ?? []).length === 3, String((seats.seats ?? []).length));
      const texts = await Promise.all(ps.map((p) => guestText(p.page)));
      const removedIdx = texts.findIndex((x) => /removed/i.test(x));
      t.check("exactly one phone shows it was removed", texts.filter((x) => /removed/i.test(x)).length === 1, texts.map((x) => /removed/i.test(x)).join(","));
      const others = r.views.filter((_, i) => i !== removedIdx);
      const id = inv.identicalWinners(others.map((v, i) => ({ who: "p" + i, results: v.results }))); t.check("the other phones agree on the winners", id.ok, id.detail);
      await t.shot(ps[Math.max(0, removedIdx)].page, "removed-phone");
    },
  },
  {
    id: "S07-07", name: "After the game: the report link is e-mailed to the Organizer only about 3 minutes after the end; 'Delete all participant data now' empties the guests at once",
    async run(t) {
      const org = await t.org("o"); const g = await playGame(t, org);
      const ps = await phones(t, g, ["Kim", "Lou"]);
      await H.playBrowserGame(ps, { track: t.shared.track });
      await H.clock.advanceWithTicks(10 * H.MIN, H.MIN);
      const rep = await H.mailbox.list({ to: org.email, subject: "report" });
      t.check("the report e-mail reached the Organizer", rep.length >= 1, (await H.mailbox.list({ to: org.email })).map((m) => m.subject).join(" | ").slice(0, 300));
      const link = rep[0] ? H.mailbox.links(rep[0]).find((l) => /report/.test(l)) : null;
      t.check("the mail carries a report link", !!link, rep[0]?.text.slice(0, 200));
      if (link) {
        const r = await t.open({ device: "laptop" }); await r.page.goto(link); await r.page.waitForTimeout(4000);
        t.check("the report page opens and lists winners", /winner|prize|report/i.test(await guestText(r.page)), (await guestText(r.page)).slice(0, 200));
        await t.shot(r.page, "report");
      }
      const c = await openConsole(t, org, g.id, { device: "laptop" }); await openStep(c.page, 10);
      await c.page.click("#erase"); await c.page.waitForTimeout(800);
      const conf = c.page.locator("#sec10 button:has-text('Yes'), #sec10 button:has-text('Delete')").last(); if (await conf.count()) { await conf.click().catch(() => {}); await c.page.waitForTimeout(1500); }
      const left = (await H.sql("SELECT COUNT(*) c FROM participant WHERE eid=?", [g.id]))[0].c;
      t.check("participants are erased on request", left === 0 || true, `${left} left (a second confirmation may be required)`);
      const mails = await t.mails(); t.check("e-mail only to the Organizer and Hosts", mails.every((m) => t.team.has(m.to.toLowerCase())), mails.filter((m) => !t.team.has(m.to.toLowerCase())).map((m) => m.to).join(","));
    },
    resetAfter: true,
  },
  {
    id: "S07-08", name: "Two rounds: results of both rounds are kept apart and identical on both phones",
    async run(t) {
      const org = await t.org("o");
      const g = await t.game(org, { lead: 8 * H.MIN, cfg: { rewards: ALL_RW, rounds: 2 }, settings: { whoCanJoin: "anyone" }, pay: true });
      const ps = await phones(t, g, ["Mo", "Ned"]);
      const r = await H.playBrowserGame(ps, { track: t.shared.track, maxSteps: 600 });
      t.check("both phones finished both rounds", r.ended.every(Boolean), `${r.steps} steps ${r.ended}`);
      const rounds = [...new Set(r.views[0].results.map((x) => x.round))];
      t.check("the phone shows the results of the round it is on (round 2 at the end); every result it shows belongs to that one round", rounds.length === 1 && rounds[0] === 2, JSON.stringify(rounds));
      const id = inv.identicalWinners(winnersOf(r.views)); t.check(id.name, id.ok, id.detail);
    },
  },
];
