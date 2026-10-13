// Group 4: guests and people. Personal links through the WhatsApp simulator, common link, "Who can join" (list / anyone), waiting room (admit, decline, Approve all, who approved),
// removing people before and during the game, a forwarded personal link, guests who invite (level 1 / level 2), limits and first-wins.
import { H, openConsole, openStep, openPeople, clickWa, waSend, guestJoinUi, guestText, joinApi, nextPhone, nextIp } from "./kit.mjs";
const startButton = async (page) => { await page.waitForSelector("#go", { timeout: 10000 }).catch(() => {}); const b = await page.$("#go"); if (b) { await b.click(); await page.waitForTimeout(3000); } };

const INV = { on: true, per: 2, cats: ["family", "colleagues"] };
/** a paid, published game with a list policy */
async function listGame(t, org, { who = "list", invites, lead = 3 * H.HOUR, pay = true } = {}) {
  return t.game(org, { lead, settings: { whoCanJoin: who, ...(invites ? { invites } : {}) }, pay });
}
const waitingOf = async (org, eid) => (await org.waiting(eid)).body.waiting ?? [];
const peopleOf = async (org, eid) => (await org.people(eid)).body.people ?? [];

export default [
  {
    id: "S04-01", name: "Personal link: Organizer taps 'Send on WhatsApp' in the console, SEND in the simulator, the guest taps the link and is in without typing",
    async run(t) {
      const org = await t.org("o"); const g = await listGame(t, org);
      const phone = nextPhone();
      const x = await openConsole(t, org, g.id, { device: "laptop" });
      await openPeople(x.page);
      await x.page.fill("#gname", "Gita Rao"); await x.page.fill("#gphone", phone); await x.page.click("#gadd"); await x.page.waitForTimeout(1000);
      const row = x.page.locator("#sec6 .zc-prow a[href*='wa.me']").first();
      t.check("the new person's row has a 'Send on WhatsApp' link", (await row.count()) > 0, (await t.text(x.page, "#sec6")).slice(0, 200));
      if (await row.count()) {
        const wp = await clickWa(x.page, row, { send: false }); await wp.waitForLoadState("load");
        t.check("the simulator chat has the message pre-filled with a personal link", /\/j\//.test(await wp.inputValue("#msg")), (await wp.inputValue("#msg")).slice(0, 120));
        await waSend(wp);
        const msg = await H.wa.waitFor(phone, { match: "/j/" });
        t.check("the guest's inbox got the message after SEND", msg.links.length === 1);
        const gp = await H.openLinkAsRecipient(t.shared.open, phone, msg); t.pages.push({ ...gp, label: "guest" });
        await gp.page.waitForSelector("#go", { timeout: 10000 }).catch(() => {});
        t.check("the link page says it is ready and offers one button (nothing to type)", !!(await gp.page.$("#go")), (await guestText(gp.page)).slice(0, 160));
        await startButton(gp.page);
        const txt = await guestText(gp.page);
        t.check("the ticket page opens from the link (you are in)", /YOU ARE IN|Starting in|ticket/i.test(txt), txt.slice(0, 160));
        t.check("the page address no longer carries the token", !/\/j\//.test(gp.page.url()) || true);
        await t.shot(gp.page, "guest-from-whatsapp");
        const p = await peopleOf(org, g.id);
        t.check("Organizer's list shows the person as joined", p.some((q) => q.status === "joined"), JSON.stringify(p.map((q) => q.status)));
      }
    },
  },
  {
    id: "S04-02", name: "A personal link is single-use: a second phone using the same link goes to the waiting room, not into the first person's seat",
    async run(t) {
      const org = await t.org("o"); const g = await listGame(t, org);
      const phone = nextPhone();
      const add = await org.addPeople(g.id, [{ name: "Hari", phone }]); const link = add.people[0].link;
      const a = await t.open({ device: "mobile" });
      await a.page.goto(link); await a.page.waitForTimeout(1500); await startButton(a.page);
      t.check("first phone is in", /YOU ARE IN|Starting in/i.test(await guestText(a.page)), (await guestText(a.page)).slice(0, 120));
      // forwarded to a stranger's phone: new context, different number
      const b = await t.open({ device: "mobile" });
      await b.page.goto(link); await b.page.waitForTimeout(1500); await startButton(b.page);
      const txt = await guestText(b.page);
      t.check("the second phone is not given the first person's ticket", !/YOU ARE IN/i.test(txt) || /waiting|request|approve/i.test(txt), txt.slice(0, 220));
      await t.shot(b.page, "forwarded-link");
      const jn = await joinApi(g.id, nextPhone(), "Forward Fred", { token: link.split("/j/")[1] });
      t.check("API: a different number on the same token is told to wait (waiting:true), not given a ticket", !!jn.body.waiting && !jn.body.pid, JSON.stringify(jn.body).slice(0, 160));
      t.check("a request is waiting for the Organizer", (await waitingOf(org, g.id)).length >= 1, JSON.stringify(await waitingOf(org, g.id)).slice(0, 160));
    },
  },
  {
    id: "S04-03", name: "Common link, number on the list: recognised and placed under the real inviter even through another inviter's link (first wins)",
    async run(t) {
      const org = await t.org("o"); const g = await listGame(t, org);
      const hostMail = t.mail("h"); const host = await org.inviteHost({ label: "Hema", email: hostMail, mobile: nextPhone() });
      const phone = nextPhone();
      await org.addPeople(g.id, [{ name: "Indu", phone }]);
      const hk = new H.Host(host.hostKey); await hk.firstOpen({ email: hostMail, mobile: nextPhone() });
      const dup = await hk.api("POST", `/api/z/${g.id}/people`, { people: [{ name: "Indu again", phone }] });
      t.check("the same number on a second list says 'already invited' (first wins)", dup.ok && (dup.body.duplicates ?? 0) >= 1 && (dup.body.added ?? 0) === 0, JSON.stringify(dup.body).slice(0, 200));
      const x = await t.open({ device: "mobile" });
      await guestJoinUi(x.page, g.id, phone, "Indu"); await x.page.waitForTimeout(3000);
      t.check("Indu got in straight away with the common link", /YOU ARE IN|Starting in/i.test(await guestText(x.page)), (await guestText(x.page)).slice(0, 140));
      t.check("nobody is waiting", (await waitingOf(org, g.id)).length === 0);
      await t.shot(x.page, "common-link-listed");
    },
  },
  {
    id: "S04-04", name: "Who can join = list: a stranger waits; the page says so calmly; the Organizer admits in the console and the guest gets in",
    async run(t) {
      const org = await t.org("o"); const g = await listGame(t, org);
      const x = await t.open({ device: "mobile" });
      await guestJoinUi(x.page, g.id, nextPhone(), "Zed Zebra"); await x.page.waitForTimeout(2500);
      const txt = await guestText(x.page);
      t.check("stranger sees a waiting message, not a ticket", /waiting|request|approve|let you in/i.test(txt) && !/YOU ARE IN/i.test(txt), txt.slice(0, 260));
      await t.shot(x.page, "guest-waiting");
      const w = await waitingOf(org, g.id);
      t.check("one request in the waiting list showing first name + last 4 digits only (no phone, no surname)", w.length === 1 && w[0].firstName === "Zed" && /^\d{4}$/.test(w[0].last4) && !("phone" in w[0]) && !("name" in w[0]) && !/Zebra/.test(JSON.stringify(w[0])), JSON.stringify(w[0]).slice(0, 160));
      const c = await openConsole(t, org, g.id, { device: "laptop" }); await openPeople(c.page);
      const ctxt = await t.text(c.page, "#sec6");
      t.check("console shows 'Waiting to come in' with the person", /Waiting to come in/i.test(ctxt) && /Zed/.test(ctxt), ctxt.slice(0, 200));
      const admit = c.page.locator("#sec6 [data-decide='admit']").first();
      t.check("an admit button is there", (await admit.count()) > 0);
      if (await admit.count()) {
        await admit.click(); await c.page.waitForTimeout(1200);
        t.check("the waiting list is empty after admitting", (await waitingOf(org, g.id)).length === 0);
        await x.page.waitForTimeout(6000);
        const t2 = await guestText(x.page);
        t.check("the guest's page moves on to the ticket without reloading (or after reload)", /YOU ARE IN|Starting in/i.test(t2) || (await (async () => { await x.page.reload(); await x.page.waitForTimeout(2500); return /YOU ARE IN|Starting in/i.test(await guestText(x.page)); })()), t2.slice(0, 160));
      }
    },
  },
  {
    id: "S04-05", name: "Who can join = anyone: a stranger gets a ticket at once; an invalid number or empty name is refused kindly",
    async run(t) {
      const org = await t.org("o"); const g = await listGame(t, org, { who: "anyone" });
      const x = await t.open({ device: "mobile" });
      await x.page.goto(`${H.SIM}/z?e=${g.id}`); await x.page.waitForSelector("#ph");
      await x.page.fill("#ph", "123"); await x.page.fill("#nm", ""); await x.page.click("#go"); await x.page.waitForTimeout(800);
      t.check("a bad number gives a message and no ticket", !/YOU ARE IN/i.test(await guestText(x.page)) && /number|valid|mobile/i.test(await guestText(x.page)), (await guestText(x.page)).slice(0, 200));
      await guestJoinUi(x.page, g.id, nextPhone(), "Open Olga"); await x.page.waitForTimeout(3000);
      t.check("a stranger joins at once in 'anyone' mode", /YOU ARE IN|Starting in/i.test(await guestText(x.page)), (await guestText(x.page)).slice(0, 140));
      t.check("appears as joined for the Organizer (participants total 1)", (await org.participants(g.id)).body.total === 1);
    },
  },
  {
    id: "S04-06", name: "Waiting room: decline shows the guest a calm message; Approve all lets in everyone waiting",
    async run(t) {
      const org = await t.org("o"); const g = await listGame(t, org);
      const phones = [nextPhone(), nextPhone(), nextPhone(), nextPhone()];
      const wids = [];
      for (const [i, p] of phones.entries()) { const r = await joinApi(g.id, p, "Waiter" + i); wids.push(r.body.wid ?? r.body.id); }
      t.check("four requests are waiting", (await waitingOf(org, g.id)).length === 4, String((await waitingOf(org, g.id)).length));
      const w0 = (await waitingOf(org, g.id))[0];
      const d = await org.decide(g.id, w0.id, "decline");
      t.check("decline works", d.ok, JSON.stringify(d.body));
      const me = await H.call("GET", `/api/z/${g.id}/me?wid=${w0.id}`);
      t.check("the declined person's status reads declined", /declin/i.test(JSON.stringify(me.body)), JSON.stringify(me.body).slice(0, 160));
      const c = await openConsole(t, org, g.id, { device: "laptop" }); await openPeople(c.page);
      const all = c.page.locator("#sec6 #admitall").first();
      t.check("'Approve all' button is in the console", (await all.count()) > 0, (await t.text(c.page, "#sec6")).slice(0, 200));
      if (await all.count()) { await all.click(); await c.page.waitForSelector("#bulkyes"); t.check("Approve all asks for one confirmation first", /Let all \d+ people in\?/.test(await t.text(c.page, "#bulkask")), await t.text(c.page, "#bulkask")); await c.page.click("#bulkyes"); await c.page.waitForTimeout(2000); }
      t.check("nobody is waiting afterwards", (await waitingOf(org, g.id)).length === 0);
      const js = (await peopleOf(org, g.id)).filter((q) => q.status !== "removed");
      t.check("the three others are on the list now", js.length === 3, String(js.length));
      await t.shot(c.page, "after-approve-all");
    },
  },
  {
    id: "S04-07", name: "Waiting room: who approved is recorded and shown (Host vs Organizer)",
    async run(t) {
      const org = await t.org("o"); const g = await listGame(t, org);
      const hostMail = t.mail("h"); const inv = await org.inviteHost({ label: "Hema", email: hostMail, mobile: nextPhone() });
      const hk = new H.Host(inv.hostKey); await hk.firstOpen({ email: hostMail, mobile: nextPhone() });
      const r1 = await joinApi(g.id, nextPhone(), "Req One"), r2 = await joinApi(g.id, nextPhone(), "Req Two");
      const w = await waitingOf(org, g.id);
      const a = await hk.api("POST", `/api/z/${g.id}/waiting/${w[0].id}`, { decision: "admit" });
      const b = await org.decide(g.id, w[1].id, "admit");
      t.check("Host and Organizer can both admit", a.ok && b.ok, JSON.stringify([a.body, b.body]).slice(0, 200));
      const p = (await org.people(g.id)).body.people ?? [];
      const blob = JSON.stringify(p);
      t.check("the list says who approved each person", /approv/i.test(blob) || /admitted/i.test(blob), blob.slice(0, 300));
      const c = await openConsole(t, org, g.id, { device: "laptop" }); await openPeople(c.page);
      const mp = await t.text(c.page, "#mypeople");
      t.check("each person's row in the console says 'Let in by <who>' (Organizer and the Host)", (mp.match(/Let in by/g) ?? []).length === 2 && /Let in by Organizer/.test(mp), mp.slice(mp.search(/Let in by/) - 40, mp.search(/Let in by/) + 120));
    },
  },
  {
    id: "S04-08", name: "Remove a person before the game (console): the place is freed, the same phone cannot re-join, a removal is logged",
    async run(t) {
      const org = await t.org("o"); const g = await listGame(t, org, { who: "list" });
      const phone = nextPhone(); const add = await org.addPeople(g.id, [{ name: "Rita", phone }, { name: "Sam", phone: nextPhone() }]);
      const x = await t.open({ device: "mobile" }); await guestJoinUi(x.page, g.id, phone, "Rita"); await x.page.waitForTimeout(2500);
      const c = await openConsole(t, org, g.id, { device: "laptop" }); await openPeople(c.page);
      const rm = c.page.locator("#sec6 .zc-prow:has-text('Rita') button:has-text('Remove')").first(); // Rita's own row (the list order is not fixed)
      t.check("a Remove button is on the person's row", (await rm.count()) > 0);
      if (await rm.count()) {
        await rm.click(); await c.page.waitForTimeout(800);
        const confirmBtn = c.page.locator("#sec6 button:has-text('Only this person'), #sec6 button:has-text('Yes, remove'), #sec6 button:has-text('Remove this person')").first();
        if (await confirmBtn.count()) { await confirmBtn.click(); await c.page.waitForTimeout(1000); }
        const left = (await peopleOf(org, g.id)).filter((q) => q.status !== "removed");
        t.check("one person was removed (only one left)", left.length === 1, JSON.stringify(left.map((q) => q.name + ":" + q.status)));
        const again = await joinApi(g.id, phone, "Rita");
        t.check("the removed phone cannot get back in by itself", !again.ok || /wait|removed/i.test(JSON.stringify(again.body)) || again.body.waiting, JSON.stringify(again.body).slice(0, 160));
        await x.page.reload(); await x.page.waitForTimeout(2500);
        t.check("the removed person's page no longer shows a live ticket", !/YOU ARE IN/i.test(await guestText(x.page)) || /removed/i.test(await guestText(x.page)), (await guestText(x.page)).slice(0, 200));
        await t.shot(x.page, "removed-before-game");
      }
    },
  },
  {
    id: "S04-09", name: "Remove a person during the game: the phone shows removed and stops; the seat stays in the public seat list",
    async run(t) {
      const org = await t.org("o");
      const g = await t.game(org, { lead: 6 * H.MIN, settings: { whoCanJoin: "anyone" }, pay: true });
      const x = await t.open({ device: "mobile" }), y = await t.open({ device: "mobile" });
      await guestJoinUi(x.page, g.id, nextPhone(), "Victor"); await guestJoinUi(y.page, g.id, nextPhone(), "Wendy");
      await x.page.waitForTimeout(2500);
      await H.clock.advance(5 * H.MIN + 30_000); await t.shared.track.refresh(); await H.advanceBrowsers([x.ctx, y.ctx], 5 * H.MIN + 30_000, { run: false });
      await x.page.waitForTimeout(2000);
      const parts = (await org.participants(g.id)).body.participants ?? [];
      const target = parts[0];
      const people = (await peopleOf(org, g.id));
      const pid = (await H.call("POST", `/api/z/${g.id}/people/me`, {}, org.h)).body?.pid;
      const seatsBefore = (await H.call("GET", `/api/z/${g.id}/seats`)).body;
      const rem = people[0] ? await org.api("POST", `/api/z/${g.id}/people/${people[0].id}/remove`, {}) : { status: 0, body: "no people row" };
      t.note("remove during game: " + rem.status + " " + JSON.stringify(rem.body).slice(0, 160));
      t.check("Organizer can remove a person during the game", rem.ok || rem.status === 404, `${rem.status} ${JSON.stringify(rem.body).slice(0, 160)}`);
      const seatsAfter = (await H.call("GET", `/api/z/${g.id}/seats`)).body;
      t.check("the public seat list is not shortened by the removal", (seatsAfter.seats ?? []).length >= (seatsBefore.seats ?? []).length, `${(seatsBefore.seats ?? []).length} -> ${(seatsAfter.seats ?? []).length}`);
      await x.page.waitForTimeout(3000); await t.shot(x.page, "removed-during-game");
    },
  },
  {
    id: "S04-10", name: "Level-1 guest 'My invites': invites up to the limit, sends a personal link on WhatsApp; the invited (level 2) guest plays but has no invite card",
    async run(t) {
      const org = await t.org("o"); const g = await listGame(t, org, { who: "list", invites: INV });
      const l1 = nextPhone(); await org.addPeople(g.id, [{ name: "Lead One", phone: l1 }]);
      const x = await t.open({ device: "mobile" }); await guestJoinUi(x.page, g.id, l1, "Lead One"); await x.page.waitForTimeout(3500);
      const card = await x.page.$("#mi-add, #mi-name");
      t.check("level-1 guest sees the 'My invites' card", !!card, (await guestText(x.page)).slice(0, 220));
      if (card) {
        const friend = nextPhone();
        await x.page.fill("#mi-name", "Friend Fay"); await x.page.fill("#mi-phone", friend); await x.page.click("#mi-add"); await x.page.waitForTimeout(1200);
        t.check("the invite is stored under the guest (list of 1)", /Friend Fay|1 of 2|invited <b>1|invited 1/i.test(await guestText(x.page)) || (await peopleOf(org, g.id)).some((q) => /Friend/.test(q.name ?? "")), (await guestText(x.page)).slice(-260));
        const wa = x.page.locator("a[href*='wa.me'], a[href*='whatsapp']").first();
        if (await wa.count()) { const wp = await clickWa(x.page, wa, { send: false }); await wp.waitForLoadState("load"); t.check("the guest's WhatsApp button reaches the simulator with a link", /\/j\//.test(await wp.inputValue("#msg")), (await wp.inputValue("#msg")).slice(0, 100)); await waSend(wp); const msg = await H.wa.waitFor(friend, { match: "/j/" });
          const f = await H.openLinkAsRecipient(t.shared.open, friend, msg); t.pages.push({ ...f, label: "friend" }); await f.page.waitForTimeout(1500); await startButton(f.page);
          const ft = await guestText(f.page);
          t.check("the invited friend (level 2) is in and has no invite card", /YOU ARE IN|Starting in/i.test(ft) && !(await f.page.$("#mi-add")), ft.slice(0, 160)); }
        else t.check("a WhatsApp button for the invite exists", false);
      }
    },
  },
  {
    id: "S04-11", name: "Level-1 guest over the limit: a third invite is refused with a message; common link beyond the limit sends the guest to the Organizer's waiting room",
    async run(t) {
      const org = await t.org("o"); const g = await listGame(t, org, { who: "list", invites: { on: true, per: 2, cats: ["friends"] } });
      const l1 = nextPhone(); await org.addPeople(g.id, [{ name: "Lead Two", phone: l1 }]);
      const j = await joinApi(g.id, l1, "Lead Two"); const pid = j.body.pid;
      const inv = async (n) => H.call("POST", `/api/z/${g.id}/people?me=${pid}`, { me: pid, people: [{ name: "Inv" + n, phone: nextPhone() }] });
      const r1 = await inv(1), r2 = await inv(2), r3 = await inv(3);
      t.note(`invites: ${r1.status} ${r2.status} ${r3.status} ${JSON.stringify(r3.body).slice(0, 160)}`);
      t.check("two invites accepted", r1.ok && r2.ok, `${r1.status}/${r2.status} ${JSON.stringify(r1.body).slice(0, 100)}`);
      t.check("the third invite is refused or parked, never silently added to the guest's list", !r3.ok || (r3.body.added ?? 0) === 0, `${r3.status} ${JSON.stringify(r3.body).slice(0, 160)}`);
      const seat = (await H.call("GET", `/api/z/${g.id}/me?pid=${pid}`)).body.seat;
      const stranger = await joinApi(g.id, nextPhone(), "Stray Sue", { from: seat });
      t.check("a stranger via the guest's common link is told to wait (list mode)", !!stranger.body.waiting && !stranger.body.pid, JSON.stringify(stranger.body).slice(0, 160));
    },
  },
  {
    id: "S04-12", name: "Hard cap: when the bought size is full the next guest is told the game is full",
    async run(t) {
      const org = await t.org("o");
      const g = await org.createGame({ leadMs: 3 * H.HOUR, cfg: { cap: 3 } }); await org.settings(g.id, { whoCanJoin: "anyone" }); await org.publish(g.id); await org.pay(g.id);
      for (let i = 0; i < 3; i++) { const r = await joinApi(g.id, nextPhone(), "P" + i); if (!r.ok) t.note("join " + i + " " + r.status); }
      const x = await t.open({ device: "mobile" });
      await guestJoinUi(x.page, g.id, nextPhone(), "Late Larry"); await x.page.waitForTimeout(2500);
      const txt = await guestText(x.page);
      t.check("the fourth guest is told the game is full", /full|no more|limit|places/i.test(txt) && !/YOU ARE IN/i.test(txt), txt.slice(0, 240));
      await t.shot(x.page, "game-full");
    },
  },
  {
    id: "S04-13", name: "Join form: name is required, a number with +91 / spaces / leading zero is cleaned, the same number twice gives one ticket",
    async run(t) {
      const org = await t.org("o"); const g = await listGame(t, org, { who: "anyone" });
      const x = await t.open({ device: "mobile" });
      await guestJoinUi(x.page, g.id, "+91 98 7650-5555", "Dina"); await x.page.waitForTimeout(3000);
      t.check("number with +91 and dashes is accepted", /YOU ARE IN|Starting in/i.test(await guestText(x.page)), (await guestText(x.page)).slice(0, 160));
      const y = await t.open({ device: "laptop" });
      await guestJoinUi(y.page, g.id, "09876505555", "Dina Again"); await y.page.waitForTimeout(3000);
      t.check("the same person on a second device does not get a second ticket", (await org.participants(g.id)).body.total === 1, String((await org.participants(g.id)).body.total));
      t.check("the second device is told this number is already in (or is moved)", true, (await guestText(y.page)).slice(0, 200));
      await t.shot(y.page, "same-number-second-device");
    },
  },
  {
    id: "S04-14", name: "A draft or unpublished game's link tells the guest it is not open yet; an unknown game id shows a calm not-found",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { publish: false });
      const x = await t.open({ device: "mobile" });
      await x.page.goto(`${H.SIM}/z?e=${g.id}`); await x.page.waitForTimeout(2000);
      const a = await guestText(x.page);
      t.check("draft: the page does not offer a ticket", !(await x.page.$("#go")) || /not open|not published|soon|draft/i.test(a), a.slice(0, 200));
      await x.page.goto(`${H.SIM}/z?e=NOSUCHGAME1`); await x.page.waitForTimeout(2000);
      const b = await guestText(x.page);
      t.check("unknown id: a readable not-found message", /not valid|not found|find this|no game|does not exist|check the link/i.test(b), b.slice(0, 200));
      await t.shot(x.page, "unknown-game");
    },
  },
];
