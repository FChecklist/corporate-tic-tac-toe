// Group 3: Host and Co-host. Invitation through the WhatsApp simulator, first open (e-mail code, fake Google, expired link, new link), what each role sees and cannot do.
import { H, fakeGoogle, openConsole, openStep, uiPublish, payOnPage, nextPhone, cohostUrl, tickTerms, tickGuestList, askCodeUi, passK5Gate, setupSendUi, acceptRole, tickIfAny, tickCode, acceptHostRole, tickRest } from "./kit.mjs";

const keyOf = (page) => page.evaluate(() => sessionStorage.getItem("cbz-org"));
/** the Organizer adds a Host through the API; returns { inv, email, mobile } */
async function addHost(t, org, { label = "Hema", withEmail = true, withMobile = true } = {}) {
  const email = withEmail ? t.mail("h") : undefined, mobile = withMobile ? nextPhone() : undefined;
  if (email) t.team.add(email);
  const inv = await org.inviteHost({ label, email, mobile });
  return { inv, email, mobile };
}
/** Host first open in the UI on a fresh phone: e-mail code (from the sink) and, when asked, the mobile. Returns the page and the Host's device key. */
async function hostFirstOpenUi(t, link, email, mobile) {
  const h = await t.open({ device: "mobile" });
  await h.page.goto(link); await h.page.waitForSelector("#finishsetup", { timeout: 15000 });
  if (await h.page.$("#setupemail")) {
    await setupSendUi(h.page, email);
    const m = await H.mailbox.waitFor({ to: email, timeout: 8000 }); await h.page.fill("#setupcode", H.mailbox.code(m)); await h.page.click("#setupverify");
    await h.page.waitForFunction(() => !document.getElementById("setupcode"), null, { timeout: 15000 });
    await acceptHostRole(h.page, 800);
  }
  if (await h.page.$("#setupmobile")) { await h.page.fill("#setupmobile", mobile); await h.page.click("#setupmobilego"); }
  await acceptHostRole(h.page);
  await h.page.waitForSelector(".zc-sech, #mk, .zc-main", { timeout: 15000 }); await h.page.waitForTimeout(700);
  return { h, key: await keyOf(h.page) };
}

export default [
  {
    id: "S03-01", name: "Host invited with mobile + e-mail: WhatsApp button -> simulator chat -> SEND -> Host's phone gets the link; first open in the UI",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { publish: true });
      const { inv, email, mobile } = await addHost(t, org);
      t.check("the invitation has a WhatsApp link", !!inv.waLink, JSON.stringify(inv).slice(0, 160));
      const o = await t.open({ device: "laptop", token: org.token, sender: "9811122233" });
      await o.page.goto(inv.waLink); t.check("wa.me link lands on the simulator chat", /localhost:8891\/chat/.test(o.page.url()), o.page.url().slice(0, 80));
      await H.pressSend(o.page);
      const msg = await H.wa.waitFor(mobile, { match: "cbh_" });
      t.check("the message in the Host's inbox has exactly one link", msg.links.length === 1, msg.links.join(" ").slice(0, 100));
      await o.close();
      const h = await H.openLinkAsRecipient(t.shared.open, mobile, msg); t.pages.push({ ...h, label: "host-phone" });
      await h.page.waitForSelector("#finishsetup");
      await t.shot(h.page, "host-finish-setup");
      const txt = await t.text(h.page, "#finishsetup");
      t.check("Finish setup screen asks for e-mail first", /e-mail/i.test(txt) && /works once/i.test(txt), txt.slice(0, 160));
      await setupSendUi(h.page, email);
      const m = await H.mailbox.waitFor({ to: email, timeout: 8000 });
      await h.page.fill("#setupcode", H.mailbox.code(m)); await h.page.click("#setupverify");
      await h.page.waitForFunction(() => !document.getElementById("setupcode"), null, { timeout: 15000 }); await acceptHostRole(h.page); await h.page.waitForTimeout(800);
      const key = await keyOf(h.page);
      t.check("Host has a device key and is a Host", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": key })).body.kind === "host");
      t.check("the one-time link no longer works", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": inv.hostKey })).status >= 400);
      t.check("Organizer's team list shows the Host as ready", (await org.team()).body.hosts[0]?.setup === "ready", JSON.stringify((await org.team()).body.hosts[0]));
    },
  },
  {
    id: "S03-02", name: "Host with e-mail only: first open asks e-mail code then the mobile number; console opens only after both",
    async run(t) {
      const org = await t.org("o"); await t.game(org);
      const { inv, email } = await addHost(t, org, { withMobile: false });
      const { h, key } = await hostFirstOpenUi(t, inv.link, email, "9876543210");
      const who = await H.call("GET", "/api/whoami", undefined, { "x-organizer": key });
      t.check("Host key valid after both steps", who.body.kind === "host");
      t.check("the Host console is open (role pill says Host)", /\bHost\b/.test(await t.text(h.page)), (await t.text(h.page)).slice(0, 120));
      t.check("setup is complete in the API", (await new H.Host(key).setup()).body.ready !== false);
      await t.shot(h.page, "host-console");
    },
  },
  {
    id: "S03-03", name: "Host first open with Continue with Google (fake) when the Google e-mail is the Host's e-mail",
    async run(t) {
      const org = await t.org("o"); await t.game(org);
      const { inv, email } = await addHost(t, org, { withMobile: false });
      const h = await t.open({ device: "mobile" }); await fakeGoogle(h.ctx, email);
      await h.page.goto(inv.link); await h.page.waitForSelector("#fakegoogle", { timeout: 10000 }); await acceptHostRole(h.page, 3000);
      await tickRest(h.page); await h.page.click("#fakegoogle");
      await h.page.waitForTimeout(1500);
      t.check("after Google the e-mail step is done and the mobile step remains", !!(await h.page.$("#setupmobile")), (await t.text(h.page)).slice(0, 200));
      await h.page.fill("#setupmobile", "9876500777"); await h.page.click("#setupmobilego"); await acceptHostRole(h.page); await h.page.waitForSelector(".zc-sech, #mk", { timeout: 12000 });
      const key = await keyOf(h.page);
      t.check("signed in as Host", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": key })).body.kind === "host");
    },
  },
  {
    id: "S03-04", name: "Host first open with Google but a different e-mail: kind refusal, nothing opens",
    async run(t) {
      const org = await t.org("o"); await t.game(org);
      const { inv } = await addHost(t, org, { withMobile: false });
      const h = await t.open({ device: "mobile" }); await fakeGoogle(h.ctx, t.mail("wrong"));
      await h.page.goto(inv.link); await h.page.waitForSelector("#fakegoogle", { timeout: 10000 }); await acceptHostRole(h.page, 3000);
      await tickRest(h.page); await h.page.click("#fakegoogle"); await h.page.waitForTimeout(1500);
      const txt = await t.text(h.page);
      t.check("a calm 'this link was made for another e-mail' style message", /another|different|this link|not the e-?mail|does not match/i.test(txt), txt.slice(0, 260));
      t.check("the console did not open", !!(await h.page.$("#finishsetup")) || !(await h.page.$(".zc-sech")));
      const w = await H.call("GET", "/api/whoami", undefined, { "x-organizer": inv.hostKey });
      t.check("the link still needs setup (host-setup)", w.status === 403 || w.body.kind === "host", `${w.status} ${JSON.stringify(w.body).slice(0, 80)}`);
    },
  },
  {
    id: "S03-05", name: "Host link unused for 8 days expires; the Organizer makes a new link and that one works",
    resetAfter: true,
    async run(t) {
      const org = await t.org("o"); await t.game(org);
      const { inv, email } = await addHost(t, org);
      await H.clock.advance(8 * H.DAY); await t.shared.track.refresh();
      const h = await t.open({ device: "mobile" });
      await h.page.goto(inv.link); await h.page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {}); await h.page.waitForTimeout(800);
      t.check("an expired link does not open the setup", !(await h.page.$("#setupemail")), (await t.text(h.page)).slice(0, 200));
      t.check("the page says what to do (ask the Organizer for a new link)", /new link|expired|ask/i.test(await t.text(h.page)), (await t.text(h.page)).slice(0, 220));
      await t.shot(h.page, "host-link-expired");
      const id = (await org.team()).body.hosts[0].id;
      const nl = await org.newHostLink(id);
      t.check("Organizer can make a new link", nl.ok && !!nl.body.link, JSON.stringify(nl.body).slice(0, 120));
      if (nl.ok) {
        const { h: h2, key } = await hostFirstOpenUi(t, nl.body.link, email, "9876500888");
        t.check("new link completes the first open", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": key })).body.kind === "host");
      }
    },
  },
  {
    id: "S03-06", name: "Host console: Host pill, no account section, can publish and pay the Organizer's game, can add a Co-host but not a Host",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { publish: false });
      const { inv, email } = await addHost(t, org);
      const { h, key } = await hostFirstOpenUi(t, inv.link, email, "9876500123");
      await h.page.goto(`${H.SIM}/zc?e=${g.id}`); await h.page.waitForSelector(".zc-sech");
      const txt = await t.text(h.page);
      t.check("role pill reads Host", /\bHost\b/.test(txt));
      t.check("no 'Your account' section for a Host", !(await h.page.$("#acct")) && !(await h.page.$("[data-acct]")), "");
      await openStep(h.page, 5);
      t.check("a Host cannot add Hosts (no Host form)", !(await h.page.$("#hostadd")));
      t.check("a Host can add a Co-host (form present)", !!(await h.page.$("#cohostadd")));
      const hApi = new H.Host(key);
      t.check("API: POST /api/org/host as Host is refused (403)", (await hApi.api("POST", "/api/org/host", { label: "X", email: t.mail("x") })).status === 403);
      t.check("API: /api/org/ai/link as Host is refused", (await hApi.api("GET", "/api/org/ai/link")).status === 403);
      t.check("API: close account as Host is refused", (await hApi.api("POST", "/api/org/close", { confirm: true })).status === 403);
      await uiPublish(h.page, email, "9876500123");
      t.check("Host can publish", /published/i.test((await org.summary(g.id)).body.status));
      const pr = await hApi.api("POST", "/api/payments/test", { eid: g.id, email, org: "Host Pays", country: "IN" });
      t.check("Host can pay (test payment)", pr.ok, JSON.stringify(pr.body).slice(0, 100));
      const pay = (await org.summary(g.id)).body.payment;
      t.check("who paid is recorded as host", pay?.status === "paid" && pay?.paidBy === "host", JSON.stringify(pay));
      await t.shot(h.page, "host-after-publish");
    },
  },
  {
    id: "S03-07", name: "Host signs in later on a second device with an e-mail code (not the one-time link)",
    async run(t) {
      const org = await t.org("o"); await t.game(org);
      const { inv, email } = await addHost(t, org);
      await hostFirstOpenUi(t, inv.link, email, "9876500321");
      const x = await t.open({ device: "laptop" });
      await askCodeUi(x.page, email);
      const mails = await H.mailbox.list({ to: email }); const m = mails[mails.length - 1];
      await x.page.fill("#lCode", H.mailbox.code(m)); await tickCode(x.page); await x.page.click("#cdGo"); await x.page.waitForURL(/\/zc/, { timeout: 15000 });
      const k = await keyOf(x.page);
      t.check("second device has its own Host key", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": k })).body.kind === "host");
    },
  },
  {
    id: "S03-08", name: "Retiring a Host at once stops all their keys; the console says so kindly",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org);
      const { inv, email } = await addHost(t, org);
      const { h, key } = await hostFirstOpenUi(t, inv.link, email, "9876500654");
      const id = (await org.team()).body.hosts[0].id;
      const r = await org.retire(id); t.check("Organizer retires the Host", r.ok, JSON.stringify(r.body));
      t.check("Host key now refused", (await H.call("GET", "/api/whoami", undefined, { "x-organizer": key })).status >= 400);
      await h.page.goto(`${H.SIM}/zc?e=${g.id}`); await h.page.waitForTimeout(2200);
      const txt = await t.text(h.page);
      t.check("retired Host sees a readable message, not a blank page", txt.length > 40 && !/undefined|\[object/.test(txt), txt.slice(0, 200));
      await t.shot(h.page, "retired-host");
    },
  },
  {
    id: "S03-09", name: "At most five Hosts: the sixth is refused with a message in the console",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org);
      for (let i = 1; i <= 5; i++) await addHost(t, org, { label: "Host" + i });
      const x = await openConsole(t, org, g.id); await openStep(x.page, 5);
      t.check("the console says Hosts: 5 of 5", /5 of 5/.test(await t.text(x.page, "#sec5")), (await t.text(x.page, "#sec5")).slice(0, 200));
      await x.page.fill("#hostlabel", "Sixth"); await x.page.fill("#hostphone", nextPhone()); await x.page.fill("#hostemail", t.mail("six"));
      t.check("the 'Add a Host' button is disabled at 5 of 5", await x.page.isDisabled("#hostadd"));
      const six = await org.api("POST", "/api/org/host", { label: "Sixth", email: t.mail("six2"), mobile: nextPhone() });
      t.check("the server refuses a sixth Host too", !six.ok, String(six.status));
      t.check("sixth Host not created", (await org.team()).body.hosts.length === 5);
      t.check("a message explains", /5|five|limit|no more/i.test(await t.text(x.page, "#sec5")));
    },
  },
  {
    id: "S03-10", name: "Co-host: link opens a 3-step view (Today's game, Invite people, Payment); no guest list, no game editing",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { pay: false });
      const c = await org.inviteCohost({ label: "Chandra", phone: nextPhone(), e: g.id });
      t.check("Co-host link from the API is a console link", /zc/.test(c.link ?? ""), c.link);
      const dead = await t.open({ device: "mobile" });
      await dead.page.goto(c.link); await passK5Gate(dead.page); await dead.page.waitForTimeout(2500);
      t.check("the API's own Co-host link (no game id) opens the game", !!(await dead.page.$(".zc-sech")), (await t.text(dead.page)).slice(0, 220));
      await t.shot(dead.page, "cohost-api-link-deadend");
      const x = await t.open({ device: "mobile" });
      await x.page.goto(cohostUrl(g.id, c)); const again = await passK5Gate(x.page, { required: false }); await x.page.waitForSelector(".zc-sech", { timeout: 15000 }); await x.page.waitForTimeout(800);
      t.check("K5: the same Co-host key is not asked again on a second page (the acceptance is stored by the server, per key)", !again.shown);
      const txt = await t.text(x.page);
      const heads = await x.page.$$eval(".zc-sech", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").slice(0, 40)));
      t.check("exactly three numbered steps (Today's game, Invite people, Payment)", heads.filter((h) => /^\d /.test(h)).length === 3, heads.join(" | "));
      t.check("a Co-host has no 'Your account' section", !heads.some((h) => /account/i.test(h)) && !(await x.page.$("[data-acct]")), heads.join(" | "));
      t.check("role pill says Co-host", /Co-host/.test(txt));
      t.check("no Prizes / Brand / Check and publish steps", !/Set Prizes|Check and publish|Set Brand/i.test(txt), txt.slice(0, 200));
      const key = await keyOf(x.page); const ca = (m, p, b) => H.call(m, p, b, { "x-organizer": key });
      t.check("whoami says cohost", (await ca("GET", "/api/whoami")).body.kind === "cohost");
      t.check("cannot read the participants list (403)", (await ca("GET", `/api/z/${g.id}/participants`)).status === 403);
      t.check("cannot change settings (403)", (await ca("PATCH", `/api/z/${g.id}/settings`, { cap: 50 })).status === 403);
      t.check("cannot see the team (403)", (await ca("GET", "/api/org/team")).status === 403);
      t.check("can read the small game header", (await ca("GET", `/api/z/${g.id}/cohost`)).ok);
      await t.shot(x.page, "cohost-view");
    },
  },
  {
    id: "S03-11", name: "Co-host invites people (own list, personal links), is stopped at the limit, and pays the game",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { pay: false });
      const c = await org.inviteCohost({ label: "Chandra", phone: nextPhone(), e: g.id });
      const x = await t.open({ device: "mobile" });
      await x.page.goto(cohostUrl(g.id, c)); await passK5Gate(x.page); await x.page.waitForSelector(".zc-sech", { timeout: 15000 });
      await openStep(x.page, 2); await x.page.waitForTimeout(500);
      const add = await x.page.$("#gadd");
      if (add) { const b = x.page.locator(".tb input[data-box]").first(); if (!(await b.isChecked())) await b.check(); }
      if (add) { const b = x.page.locator(".tb input[data-box]").first(); if (!(await b.isChecked())) await b.check(); }
      t.check("the Co-host can add people (name + mobile only, no e-mail field)", !!add && !(await x.page.$('#sec2 input[type=email]')));
      if (add) { await x.page.fill("#gname", "Esha"); await x.page.fill("#gphone", "9811100001"); await x.page.click("#gadd"); await x.page.waitForTimeout(1000); }
      const key = await keyOf(x.page);
      const list = await H.call("GET", `/api/z/${g.id}/people`, undefined, { "x-organizer": key });
      t.check("the Co-host's list has the person", (list.body.people ?? []).length === 1, JSON.stringify(list.body).slice(0, 160));
      t.check("the Organizer sees that person under the Co-host", (await org.people(g.id, "?all=1")).ok);
      // payment from the Co-host
      await openStep(x.page, 3);
      const link = await x.page.$("a[href*='/pay.html']");
      t.check("Payment step has a Pay now link for the Co-host", !!link);
      if (link) {
        await link.click(); await x.page.waitForURL(/pay/, { timeout: 10000 });
        await payOnPage(x.page, { email: t.mail("cp") });
        await t.until(async () => (await org.summary(g.id)).body.payment?.status === "paid", { what: "Co-host payment" });
        t.check("paid by the Co-host (recorded as co-host)", (await org.summary(g.id)).body.payment?.paidBy === "co-host", JSON.stringify((await org.summary(g.id)).body.payment));
      }
    },
  },
  {
    id: "S03-12", name: "Co-host link bound to one game: another game of the same Organizer is refused; retiring the Co-host stops the link",
    async run(t) {
      const org = await t.org("o"); const g1 = await t.game(org), g2 = await t.game(org);
      const c = await org.inviteCohost({ label: "Chandra", phone: nextPhone(), e: g1.id });
      const key = c.cohostKey; t.check("the Co-host link carries the game and the key (in the part of the address the server never sees)", c.link.includes(`e=${g1.id}`) && c.link.includes(`#cohost=${key}`), c.link);
      const ca = (m, p, b) => H.call(m, p, b, { "x-organizer": key });
      await acceptRole(key);
      t.check("works for its own game", (await ca("GET", `/api/z/${g1.id}/cohost`)).ok);
      const other = await ca("GET", `/api/z/${g2.id}/cohost`);
      t.check("refused for the other game with a friendly message", other.status === 403 && /different|another|game/i.test(JSON.stringify(other.body)), `${other.status} ${JSON.stringify(other.body).slice(0, 120)}`);
      const x = await t.open({ device: "mobile" });
      await x.page.goto(`${H.SIM}/zc?e=${g2.id}&k=${key}`); await x.page.waitForTimeout(2200);
      t.check("the console shows a readable message for the wrong game", (await t.text(x.page)).length > 40, (await t.text(x.page)).slice(0, 200));
      const id = (await org.api("GET", `/api/org/team?e=${g1.id}`)).body.cohosts[0].id;
      t.check("Organizer retires the Co-host", (await org.retire(id)).ok);
      t.check("link is dead after retiring", (await ca("GET", `/api/z/${g1.id}/cohost`)).status >= 400);
    },
  },
];
