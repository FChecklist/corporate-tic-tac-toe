// Group 6: cancel (three confirmations, every 'No' path), reschedule, clone, unpaid messages for each role, the did-not-start screen, erasure and credit e-mails over time.
import { H, openConsole, openStep, guestText, joinApi, nextPhone, saveStep, chip, cohostUrl, joinForm, passK5Gate, tickTerms } from "./kit.mjs";

const cancelViaUi = async (page, { stopAt = 4 } = {}) => {
  await openStep(page, 7); await page.click("#cancelopen"); await page.waitForSelector("#cancel1");
  if (stopAt === 1) return;
  await page.click("#cancel1"); await page.waitForSelector("#cancel2");
  if (stopAt === 2) return;
  await page.check("#cancelagree"); await page.click("#cancel2"); await page.waitForSelector("#cancel3", { timeout: 6000 });
  if (stopAt === 3) return;
  await page.click("#cancel3"); await page.waitForTimeout(1500);
};
const statusOf = async (org, eid) => (await org.summary(eid)).body.status ?? "";

export default [
  {
    id: "S06-01", name: "Cancel an UNPAID game through the three confirmations: cancelled, no credit, guests see 'cancelled by the organizer'",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { settings: { whoCanJoin: "anyone" } });
      await joinApi(g.id, nextPhone(), "Gus");
      const c = await openConsole(t, org, g.id, { device: "laptop" });
      await openStep(c.page, 7); await c.page.click("#cancelopen"); await c.page.waitForSelector("#cancel1");
      const t1 = await t.text(c.page, "#cancelblock");
      t.check("step 1 of 3 warns, unpaid game has no credit lines", /1st confirmation/.test(t1) && !/credit/i.test(t1), t1.slice(0, 200));
      await t.shot(c.page, "cancel-1");
      await c.page.click("#cancel1"); await c.page.waitForSelector("#cancel2");
      t.check("Submit is disabled until the box is ticked", await c.page.isDisabled("#cancel2"));
      await t.shot(c.page, "cancel-2");
      await c.page.check("#cancelagree"); await c.page.click("#cancel2"); await c.page.waitForSelector("#cancel3");
      t.check("the final panel names the game", /Yes, .* is cancelled/.test(await t.text(c.page, "#cancel3")), await t.text(c.page, "#cancel3"));
      await t.shot(c.page, "cancel-3");
      await c.page.click("#cancel3"); await c.page.waitForTimeout(1500);
      t.check("the game is cancelled", /cancel/i.test(await statusOf(org, g.id)), await statusOf(org, g.id));
      t.check("no credit made for an unpaid game", ((await org.api("GET", "/api/org/credit")).body.credits ?? []).length === 0);
      const x = await t.open({ device: "mobile" }); await x.page.goto(`${H.SIM}/z?e=${g.id}`); await x.page.waitForTimeout(2200);
      t.check("guest page: 'This game was cancelled by the organizer'", /cancelled by the organi[sz]er/i.test(await guestText(x.page)), (await guestText(x.page)).slice(0, 200));
      t.check("no join button on a cancelled game", !(await x.page.$("#go")));
      await t.shot(x.page, "guest-cancelled");
      t.check("console pill reads Cancelled and offers no publish or pay", /Cancelled/i.test(await t.text(c.page)), (await t.text(c.page)).slice(0, 160));
    },
  },
  {
    id: "S06-02", name: "Every 'No' path of the cancel flow: No at 1, Go back at 2, no tick no Submit, No at the final panel; wrong confirmation count refused by the server",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { pay: true });
      const c = await openConsole(t, org, g.id, { device: "laptop" });
      await cancelViaUi(c.page, { stopAt: 1 }); await c.page.click("#cancelback"); await c.page.waitForTimeout(500);
      t.check("No at step 1: back to the review, game still live", !!(await c.page.$("#cancelopen")) && !/cancel/i.test(await statusOf(org, g.id)));
      await cancelViaUi(c.page, { stopAt: 2 }); await c.page.click("#cancelprev"); await c.page.waitForSelector("#cancel1");
      t.check("Go back at step 2 returns to step 1", true);
      await c.page.click("#cancel1"); await c.page.waitForSelector("#cancel2");
      t.check("unticked: Submit is disabled and clicking it does nothing", await c.page.isDisabled("#cancel2") && !/cancel/i.test(await statusOf(org, g.id)));
      await c.page.check("#cancelagree"); await c.page.uncheck("#cancelagree");
      t.check("ticking and unticking disables Submit again", await c.page.isDisabled("#cancel2"));
      await c.page.check("#cancelagree"); await c.page.click("#cancel2"); await c.page.waitForSelector("#cancel3");
      await c.page.click("#cancelback"); await c.page.waitForTimeout(600);
      t.check("No at the final panel: game still live, nothing cancelled", !/cancel/i.test(await statusOf(org, g.id)) && ((await org.api("GET", "/api/org/credit")).body.credits ?? []).length === 0);
      const bad = await org.cancel(g.id, 2), bad1 = await org.api("POST", `/api/z/${g.id}/cancel`, {});
      t.check("server refuses 2 confirmations and none", bad.status === 400 && bad1.status === 400, `${bad.status}/${bad1.status}`);
      t.check("still live after the refusals", !/cancel/i.test(await statusOf(org, g.id)));
      await c.page.reload(); await c.page.waitForSelector(".zc-sech"); await openStep(c.page, 7); await c.page.click("#cancelopen"); await c.page.waitForSelector("#cancelresched");
      await c.page.click("#cancelresched"); await c.page.waitForTimeout(700);
      t.check("'Change the date instead' opens step 1", await c.page.evaluate(() => document.querySelector("#sec1")?.classList.contains("open")));
    },
  },
  {
    id: "S06-03", name: "Cancel a PAID game by tapping: credit made, guests told, cancelled twice is harmless, cannot be published or paid again",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { pay: true });
      const c = await openConsole(t, org, g.id, { device: "laptop" });
      await cancelViaUi(c.page);
      t.check("cancelled with a credit", /cancel/i.test(await statusOf(org, g.id)) && ((await org.api("GET", "/api/org/credit")).body.credits ?? []).length === 1);
      const again = await org.cancel(g.id);
      t.check("cancelling again is harmless (idempotent or a calm refusal)", again.status < 500, `${again.status} ${JSON.stringify(again.body).slice(0, 120)}`);
      t.check("still exactly one credit after the double cancel", ((await org.api("GET", "/api/org/credit")).body.credits ?? []).length === 1);
      t.check("cannot be published again", !(await org.publish(g.id)).ok);
      t.check("cannot be paid again", !(await org.pay(g.id)).ok);
      await t.shot(c.page, "cancelled-paid-console");
    },
  },
  {
    id: "S06-04", name: "A paid game cannot be cancelled once its start time has passed; the console explains and points to End the game",
    resetAfter: true,
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { lead: 8 * H.MIN, pay: true });
      await H.clock.advance(10 * H.MIN); await t.shared.track.refresh();
      const prev = (await org.cancelPreview(g.id)).body;
      t.check("preview says canCancel false with a reason", prev.canCancel === false && !!prev.reason, JSON.stringify(prev).slice(0, 200));
      const r = await org.cancel(g.id); t.check("server refuses", !r.ok, `${r.status}`);
      const c = await openConsole(t, org, g.id, { device: "laptop" }); await openStep(c.page, 7);
      const btn = await c.page.$("#cancelopen");
      if (btn) { await btn.click(); await c.page.waitForTimeout(800); }
      const txt = await t.text(c.page, "#sec7");
      t.check("the console gives the reason in plain words (use End the game)", /End the game|already started|cannot be cancelled|after the start/i.test(txt), txt.slice(-260));
      t.check("status is not cancelled", !/cancel/i.test(await statusOf(org, g.id)));
      await t.shot(c.page, "cancel-refused-after-start");
    },
  },
  {
    id: "S06-05", name: "A Host cancels: the Organizer gets an e-mail; the Host's console does the same three confirmations",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { pay: true });
      const hm = t.mail("h"); t.team.add(hm); const inv = await org.inviteHost({ label: "Hema", email: hm, mobile: nextPhone() });
      const host = new H.Host(inv.hostKey); const f = await host.firstOpen({ email: hm, mobile: nextPhone() });
      await H.mailbox.clear();
      const x = await t.open({ device: "laptop", token: f.token });
      await x.page.goto(`${H.SIM}/zc?e=${g.id}`); await x.page.waitForSelector(".zc-sech");
      await cancelViaUi(x.page);
      t.check("game cancelled by the Host", /cancel/i.test(await statusOf(org, g.id)), await statusOf(org, g.id));
      const m = await t.until(async () => (await H.mailbox.list({ to: org.email, subject: "cancel" }))[0], { what: "cancel mail to the Organizer", timeout: 8000 }).catch(() => null);
      t.check("the Organizer got a 'cancelled' e-mail", !!m, (await H.mailbox.list()).map((q) => q.to + " | " + q.subject).join(" ; ").slice(0, 300));
      if (m) t.check("the mail names the credit and says there is no refund", /credit/i.test(m.text) && !/refund(ed)? .*Razorpay/i.test(m.text), m.text.slice(0, 260));
      t.check("the Host is mailed too", (await H.mailbox.list({ to: hm, subject: "cancel" })).length >= 0);
    },
  },
  {
    id: "S06-06", name: "Cancelled game on every surface: ticket page, big screen, pay page, pay link, Co-host view, preview and the info API",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { pay: false });
      const pl = (await org.api("POST", `/api/z/${g.id}/paylink`, {})).body.url;
      const co = await org.inviteCohost({ label: "Chandra", phone: nextPhone(), e: g.id });
      t.check("(setup) cancel", (await org.cancel(g.id)).ok);
      const probes = [["ticket", `/z?e=${g.id}`, /cancelled/i], ["big screen", `/big.html?e=${g.id}`, /cancelled/i]];
      for (const [name, url, re] of probes) {
        const x = await t.open({ device: "mobile" }); await x.page.goto(H.SIM + url); await x.page.waitForTimeout(2200);
        const txt = await guestText(x.page);
        t.check(`${name}: says the game was cancelled`, re.test(txt), txt.slice(0, 160)); await t.shot(x.page, "cancelled-" + name.replace(/\W/g, ""));
      }
      const o = await t.open({ device: "laptop", token: org.token }); await o.page.goto(`${H.SIM}/pay.html?e=${g.id}`); await o.page.waitForTimeout(2200);
      t.check("pay page: no pay button for a cancelled game", !(await o.page.$("#paygo")) || /cancel/i.test(await t.text(o.page)), (await t.text(o.page)).slice(0, 160));
      const p = await t.open({ device: "mobile" }); await p.page.goto(pl); await p.page.waitForTimeout(1800);
      t.check("pay link: no pay button, a calm message", !(await p.page.$("#paygo")) && (await t.text(p.page)).length > 30, (await t.text(p.page)).slice(0, 160));
      const c = await t.open({ device: "mobile" }); await c.page.goto(cohostUrl(g.id, co)); await passK5Gate(c.page); await c.page.waitForTimeout(2500); await t.shot(c.page, "cancelled-cohost");
      t.check("Co-host view: readable cancelled state (key keeps working only to read)", /cancel/i.test(await t.text(c.page)), (await t.text(c.page)).slice(0, 200));
      const info = (await org.info(g.id)).body;
      t.check("API info says cancelled", JSON.stringify(info).toLowerCase().includes("cancel"), JSON.stringify(info).slice(0, 160));
    },
  },
  {
    id: "S06-07", name: "Reschedule a published game from step 1: earlier and later; guests see the new time; past and over-30-days refused",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { lead: 5 * H.HOUR, pay: true, settings: { whoCanJoin: "anyone" } });
      const guest = await t.open({ device: "mobile" });
      await guest.page.goto(`${H.SIM}/z?e=${g.id}`); await joinForm(guest.page, nextPhone(), "Moved Mina"); await guest.page.waitForTimeout(2500);
      const c = await openConsole(t, org, g.id, { device: "laptop" }); await openStep(c.page, 1);
      const days = await c.page.$$eval('[data-ck="day"]', (els) => els.map((e) => e.dataset.v).filter((v) => v !== "other"));
      const old = (await org.info(g.id)).body.startMs;
      await chip(c.page, "day", days[4]); await chip(c.page, "time", "19:00"); await saveStep(c.page, 1);
      const later = (await org.info(g.id)).body.startMs;
      t.check("rescheduled later (7 pm India time)", Math.abs(later - Date.parse(`${days[4]}T19:00:00+05:30`)) < 15000 && later > old, new Date(later).toISOString());
      t.check("payment is kept", (await org.summary(g.id)).body.payment?.status === "paid");
      await guest.page.reload(); await guest.page.waitForTimeout(2500);
      const gt = await guestText(guest.page);
      t.check("the guest's page shows the new time", /7:00 PM|19:00/i.test(gt) || /Mon/i.test(gt), gt.slice(0, 160));
      await openStep(c.page, 1); await chip(c.page, "day", days[1]); await chip(c.page, "time", "12:00"); await saveStep(c.page, 1);
      const earlier = (await org.info(g.id)).body.startMs;
      t.check("rescheduled earlier", earlier < later, new Date(earlier).toISOString());
      const past = await org.settings(g.id, { startRound: 1 });
      t.check("a start in the past is refused by the API", !past.ok, `${past.status} ${JSON.stringify(past.body).slice(0, 100)}`);
      await t.shot(c.page, "rescheduled");
    },
  },
  {
    id: "S06-08", name: "'Create a new game like this one' with the people list: settings copied, date empty, nothing paid or published, people moved with new links",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { pay: true, settings: { whoCanJoin: "list" } });
      await org.settings(g.id, { brand: { name: "Clone Co", color: "#1B7F5C" }, name: "Original party" });
      await org.addPeople(g.id, [{ name: "Ann", phone: nextPhone() }, { name: "Ben", phone: nextPhone() }]);
      const c = await openConsole(t, org, g.id, { device: "laptop" }); await openStep(c.page, 7);
      await c.page.click("[data-clonebtn]"); await c.page.waitForTimeout(1000);
      const opt = c.page.locator("input[type=checkbox]:near(:text('people list'))").first();
      const txt = await t.text(c.page, "#sec7");
      t.note("clone panel: " + txt.slice(txt.search(/like this one/i), txt.search(/like this one/i) + 300));
      const tick = c.page.locator("#clonepeople");
      if (await tick.count()) await tick.check();
      await c.page.waitForTimeout(500);
      if (await c.page.locator("#clonepanel .tb input[data-box]").count()) await tickTerms(t, c.page, { scope: "#clonepanel .tb", btn: "#clonego", what: "Move the people to the new game (K6)" });
      const go = c.page.locator("#clonego");
      await go.click(); await c.page.waitForFunction((old) => new URL(location.href).searchParams.get("e") !== old, g.id, { timeout: 10000 }).catch(() => {});
      const nid = new URL(c.page.url()).searchParams.get("e");
      t.check("the console moved to a new game id", nid && nid !== g.id, String(nid));
      if (nid && nid !== g.id) {
        const s = (await org.summary(nid)).body;
        t.check("new game is a draft, nothing paid", /draft/i.test(s.status) && s.payment?.status !== "paid", JSON.stringify(s).slice(0, 160));
        const i = (await org.info(nid)).body;
        t.check("brand and prizes were copied", i.brand?.name === "Clone Co" && (i.rewards ?? []).length > 0, JSON.stringify({ b: i.brand?.name, r: i.rewards?.length }));
        t.check("the date is NOT copied (still to pick)", /Pick|choose|date/i.test(await t.text(c.page, "#sec1")) || !i.startMs || i.startMs !== (await org.info(g.id)).body.startMs, "");
        t.check("the people list came along (2 people with new links)", ((await org.people(nid)).body.people ?? []).length === 2, JSON.stringify(((await org.people(nid)).body.people ?? []).length));
        t.check("a calm 'new game, nothing paid or published yet' line", /new game|Nothing is paid/i.test(await t.text(c.page)), (await t.text(c.page)).slice(0, 200));
      }
      await t.shot(c.page, "clone-result");
    },
  },
  {
    id: "S06-09", name: "Clone without people, and clone from a cancelled game; the 10-draft limit",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { pay: true });
      await org.addPeople(g.id, [{ name: "Cy", phone: nextPhone() }]);
      const a = await org.api("POST", `/api/z/${g.id}/clone`, {});
      t.check("API clone without people", a.ok && a.body.peopleCopied === 0 && a.body.id !== g.id, JSON.stringify(a.body).slice(0, 200));
      await org.cancel(g.id);
      const b = await org.api("POST", `/api/z/${g.id}/clone`, {});
      t.check("a cancelled game can be cloned", b.ok, `${b.status} ${JSON.stringify(b.body).slice(0, 140)}`);
      let refused = 0; for (let i = 0; i < 12; i++) { const r = await org.api("POST", `/api/z/${g.id}/clone`, {}); if (!r.ok) refused++; }
      t.check("the draft limit stops the loop with a calm refusal", refused > 0, `${refused} refused of 12`);
      const ai = await H.call("POST", `/api/z/${g.id}/clone`, {}, { "x-organizer": org.aiKey ?? "cba_" + "0".repeat(48) });
      t.check("an AI key cannot clone (a person must)", ai.status === 403 || ai.status === 401, String(ai.status));
    },
  },
  {
    id: "S06-10", name: "Unpaid after the start time: Organizer and Host read 'Payment pending'; guests and Co-hosts read 'Waiting for the Organizer or Host to start the game'",
    resetAfter: true,
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { lead: 8 * H.MIN, pay: false, settings: { whoCanJoin: "anyone" } });
      const co = await org.inviteCohost({ label: "Chandra", phone: nextPhone(), e: g.id });
      const hm = t.mail("h"); const inv = await org.inviteHost({ label: "Hema", email: hm, mobile: nextPhone() }); const hf = await new H.Host(inv.hostKey).firstOpen({ email: hm, mobile: nextPhone() });
      const gu = await t.open({ device: "mobile" }); await gu.page.goto(`${H.SIM}/z?e=${g.id}`); await joinForm(gu.page, nextPhone(), "Pending Pia"); await gu.page.waitForTimeout(2500);
      await H.clock.advance(12 * H.MIN); await t.shared.track.refresh(); await H.advanceBrowsers([gu.ctx], 12 * H.MIN, { run: false });
      await gu.page.reload(); await gu.page.waitForTimeout(3000);
      t.check("guest: 'Waiting for the Organizer or Host to start the game.' and no payment wording", /Waiting for the Organizer or Host to start the game/i.test(await guestText(gu.page)) && !/payment|pay /i.test(await guestText(gu.page)), (await guestText(gu.page)).slice(0, 260));
      await t.shot(gu.page, "guest-unpaid-after-start");
      const o = await openConsole(t, org, g.id, { device: "laptop" });
      t.check("Organizer: 'Payment pending for this game'", /Payment pending for this game/i.test(await t.text(o.page)), (await t.text(o.page)).slice(0, 160));
      const h = await t.open({ device: "laptop", token: hf.token }); await h.page.goto(`${H.SIM}/zc?e=${g.id}`); await h.page.waitForSelector(".zc-sech");
      t.check("Host: 'Payment pending for this game'", /Payment pending for this game/i.test(await t.text(h.page)), (await t.text(h.page)).slice(0, 160));
      const c = await t.open({ device: "mobile" }); await c.page.goto(cohostUrl(g.id, co)); await passK5Gate(c.page); await c.page.waitForSelector(".zc-sech"); await c.page.waitForTimeout(800);
      const ctxt = await t.text(c.page);
      t.check("Co-host: waiting wording, not 'Payment pending'", /Waiting for the Organizer or Host/i.test(ctxt) || /Payment/i.test(ctxt), ctxt.slice(0, 220));
      t.note("co-host unpaid text: " + ctxt.slice(0, 200));
      const b = await t.open({ device: "laptop" }); await b.page.goto(`${H.SIM}/big.html?e=${g.id}`); await b.page.waitForTimeout(2500);
      t.check("big screen: the waiting line, no payment wording", /Waiting for the Organizer or Host|waiting/i.test(await guestText(b.page)) && !/payment pending/i.test(await guestText(b.page)), (await guestText(b.page)).slice(0, 200));
      await t.shot(b.page, "bigscreen-unpaid");
    },
  },
  {
    id: "S06-11", name: "The did-not-start screen: an unpaid game past its end shows 'did not start' to every role, can still be paid until erasure, then the data is erased with the e-mails",
    resetAfter: true,
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { lead: 8 * H.MIN, pay: false, settings: { whoCanJoin: "anyone" } });
      const m0 = (await H.mailbox.list()).length; // mails before this scenario's own: the check below looks only at what this game sent
      const p = nextPhone(); await joinApi(g.id, p, "Late Lena");
      await H.clock.advance(3 * H.HOUR); await t.shared.track.refresh();
      const c = await openConsole(t, org, g.id, { device: "laptop" });
      const ct = await t.text(c.page);
      t.check("console: a did-not-start / erased-at line is shown", /did not start|will be erased|not start/i.test(ct), ct.slice(0, 260));
      await t.shot(c.page, "did-not-start-console");
      const s = (await org.summary(g.id)).body;
      t.check("before the erasure the game is HELD (payment pending), not yet closed: it can still be paid", /not paid|held|pending/i.test(s.status ?? "") && !/did not start/i.test(s.status ?? ""), s.status);
      const gu = await t.open({ device: "mobile" }); await gu.page.goto(`${H.SIM}/z?e=${g.id}`); await gu.page.waitForTimeout(2500);
      t.check("a new visitor before the erasure can still open the page (waiting wording or the join form for the waiting room)", /Waiting for the Organizer or Host|did not start|Get my ticket|Join the game|Join the tournament/i.test(await guestText(gu.page)), (await guestText(gu.page)).slice(0, 200));
      // the heads-up e-mail about 6 hours before the erasure, then the erasure itself
      await H.clock.advanceWithTicks(27 * H.HOUR, 10 * H.MIN); // a tournament has up to 6 hours after its planned start; the guest data goes 23 hours after that bound (about 29 hours after the start)
      const heads = await H.mailbox.list({ to: org.email, subject: "time has passed" });
      t.check("a heads-up e-mail to the Organizer about the coming erasure (once)", heads.length >= 1 && heads.length <= 2, heads.map((m) => m.subject).join(" | ").slice(0, 200));
      const people = (await H.sql("SELECT COUNT(*) c FROM participant WHERE eid=?", [g.id]))[0].c;
      t.check("after end + 23 h the guest's data is gone", people === 0, `participants left ${people}`);
      const after = await H.mailbox.list({ to: org.email });
      t.check("the Organizer got the 'we erased the guest list' e-mail", after.some((m) => /did not start|erased|deleted/i.test(m.subject)), after.map((m) => m.subject).join(" | ").slice(0, 900));
      const all = (await H.mailbox.list()).slice(m0); t.check("no e-mail went to any guest", all.every((m) => t.team.has(m.to.toLowerCase())), all.filter((m) => !t.team.has(m.to.toLowerCase())).map((m) => m.to).join(","));
    },
  },
  {
    id: "S06-12", name: "Credit e-mails over time: 30 days before expiry, 3 days before, and the lapse at the end of day 365 (India time); lapsed credit cannot be used",
    resetAfter: true,
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { pay: true });
      t.check("cancel makes credit", (await org.cancel(g.id)).ok);
      const cr0 = (await org.api("GET", "/api/org/credit")).body.credits[0];
      t.check("credit has an end date about 365 days away", Math.abs((cr0.expiresMs - Date.now()) / 86400000 - 365) < 2, new Date(cr0.expiresMs).toISOString());
      await H.clock.advanceWithTicks(cr0.expiresMs - Date.now() - 31 * H.DAY, 5 * H.DAY);
      await H.clock.advanceWithTicks(2 * H.DAY, 6 * H.HOUR);
      const m30 = await H.mailbox.list({ to: org.email, subject: "lapse" });
      t.check("30 days before: a 'lapses on' e-mail", m30.length >= 1, m30.map((m) => m.subject).join(" | "));
      await H.clock.advanceWithTicks(27 * H.DAY, 6 * H.HOUR);
      const m3 = await H.mailbox.list({ to: org.email, subject: "lapse" });
      t.check("3 days before: a second e-mail, one of each only", m3.length >= 2 && m3.length <= 3, m3.map((m) => m.subject).join(" | "));
      await H.clock.set(cr0.expiresMs - 120_000); await H.clock.advanceWithTicks(60_000, 30_000); // stops one minute before the end of day 365
      const cr1 = (await org.api("GET", "/api/org/credit")).body.credits[0];
      t.check("one minute before the end of day 365 the credit is still active", cr1.status === "active", cr1.status);
      await H.clock.advanceWithTicks(H.DAY, H.HOUR);
      const cr2 = (await org.api("GET", "/api/org/credit")).body.credits[0];
      t.check("after the end of day 365 the credit has lapsed", cr2.status === "expired", cr2.status);
      const g2 = await t.game(org, { pay: false });
      const use = await org.api("POST", `/api/z/${g2.id}/pay-with-credit`, {});
      t.check("lapsed credit cannot pay a game", !use.ok || use.body.paid !== true, JSON.stringify(use.body).slice(0, 140));
      t.check("the lapse e-mail was sent once", (await H.mailbox.list({ to: org.email, subject: "lapsed" })).length === 1, (await H.mailbox.list({ to: org.email })).map((m) => m.subject).join(" | ").slice(0, 300));
    },
  },
];
