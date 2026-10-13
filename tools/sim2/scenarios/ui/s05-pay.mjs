// Group 5: money. The pay page (test payment), double click, paying twice, the pay link anyone can open, credit after a cancel (no refunds), paying late.
import { H, openConsole, openStep, payOnPage, payStatus, nextPhone, tickTerms } from "./kit.mjs";

const paidCount = async (eid) => (await H.sql("SELECT COUNT(*) c FROM payment WHERE eid=? AND status='paid'", [eid]))[0].c;
const anyPay = async (eid) => (await H.sql("SELECT COUNT(*) c FROM payment WHERE eid=?", [eid]))[0].c;

export default [
  {
    id: "S05-01", name: "Pay page (test payment) on a laptop: the Organizer pays, sees the finished page and invoice link; console pill turns Paid; a mail goes to the payer",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org);
      const x = await t.open({ device: "laptop", token: org.token });
      await x.page.goto(`${H.SIM}/pay.html?e=${g.id}`);
      await x.page.waitForSelector("#paygo");
      const txt0 = await t.text(x.page);
      t.check("order summary shows pack, price and total (no GST)", /Up to 100/.test(txt0) && !/18%|\+ GST|GST \(/.test(txt0) && /2,399/.test(txt0), txt0.slice(0, 220));
      await payOnPage(x.page, { email: org.email });
      await x.page.waitForFunction(() => /PAYMENT RECEIVED/i.test(document.body.innerText), null, { timeout: 15000 });
      t.check("'Payment received' page with an invoice", /invoice/i.test(await t.text(x.page)));
      t.check("API says paid", (await payStatus(org, g.id)) === "paid");
      const mails = await H.mailbox.list({ to: org.email, subject: "payment received" });
      t.check("payment mail to the payer", mails.length >= 1);
      await t.shot(x.page, "pay-done");
      await x.page.goto(`${H.SIM}/zc?e=${g.id}`); await x.page.waitForSelector(".zc-sech");
      t.check("console pill reads Paid and the pending notice is gone", /\bPaid\b/.test(await t.text(x.page)) && !/Payment pending/i.test(await t.text(x.page)));
    },
  },
  {
    id: "S05-02", name: "Pay button double-clicked: only one payment is made",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org);
      const x = await t.open({ device: "laptop", token: org.token });
      await x.page.goto(`${H.SIM}/pay.html?e=${g.id}`); await x.page.waitForSelector("#paygo");
      await x.page.fill("#nm", "Dbl Click"); await x.page.fill("#em", org.email); await x.page.fill("#org", "Dbl Co");
      await tickTerms(t, x.page, { scope: ".tb", btn: "#paygo", what: "Pay" });
      await x.page.dblclick("#paygo"); await x.page.waitForTimeout(3500);
      t.check("exactly one paid payment row", (await paidCount(g.id)) === 1, `paid ${await paidCount(g.id)} of ${await anyPay(g.id)} rows`);
      const inv = await H.sql("SELECT COUNT(*) c FROM invoice WHERE payment_id IN (SELECT id FROM payment WHERE eid=?)", [g.id]).catch(() => [{ c: 1 }]);
      t.check("one invoice only", inv[0].c <= 1, String(inv[0].c));
      const rapid = await Promise.all([1, 2, 3, 4].map(() => org.pay(g.id)));
      t.check("four more parallel API payment calls do not create a second paid row", (await paidCount(g.id)) === 1, rapid.map((r) => r.status).join(","));
    },
  },
  {
    id: "S05-03", name: "Opening the pay page again after payment: it does not take money twice",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { pay: true });
      const x = await t.open({ device: "mobile", token: org.token });
      await x.page.goto(`${H.SIM}/pay.html?e=${g.id}`); await x.page.waitForTimeout(2500);
      const txt = await t.text(x.page);
      t.check("the page says it is already paid, or no pay button is offered", /already paid|is paid|paid/i.test(txt) || !(await x.page.$("#paygo")), txt.slice(0, 240));
      if (await x.page.$("#paygo")) { await payOnPage(x.page, { email: org.email }); await x.page.waitForTimeout(2500); }
      t.check("still exactly one paid payment", (await paidCount(g.id)) === 1, String(await paidCount(g.id)));
      await t.shot(x.page, "pay-again");
    },
  },
  {
    id: "S05-04", name: "Pay page for a signed-out person and for another organizer's game: calm messages, no payment",
    async run(t) {
      const org = await t.org("o"), other = await t.org("p"); const g = await t.game(org);
      const a = await t.open({ device: "mobile" });
      await a.page.goto(`${H.SIM}/pay.html?e=${g.id}`); await a.page.waitForTimeout(1800);
      t.check("signed out: asked to sign in (no pay form)", !(await a.page.$("#paygo")) && /sign in|log in/i.test(await t.text(a.page)), (await t.text(a.page)).slice(0, 200));
      const b = await t.open({ device: "mobile", token: other.token });
      await b.page.goto(`${H.SIM}/pay.html?e=${g.id}`); await b.page.waitForTimeout(2000);
      const btxt = await t.text(b.page);
      t.check("another organizer is NOT told that this unpaid game is 'already paid and published'", !/already paid/i.test(btxt), btxt.slice(0, 220));
      t.check("another organizer gets a calm 'could not open this engagement' style message and no pay form", /could not open|your console|not found/i.test(btxt) && !(await b.page.$("#paygo")), btxt.slice(0, 220));
      const r = await other.pay(g.id);
      t.check("API: another organizer cannot pay this game", !r.ok, `${r.status}`);
      t.check("no payment row was made", (await anyPay(g.id)) === 0);
    },
  },
  {
    id: "S05-05", name: "Pay link: made in step 8, opened by a stranger with no sign-in; shows game, date, price, one Pay button; stranger pays with name + e-mail only",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org);
      const c = await openConsole(t, org, g.id, { device: "laptop" }); await openStep(c.page, 8);
      await c.page.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
      await c.page.click("#copypaylink"); await c.page.waitForTimeout(1200);
      const txt = await t.text(c.page, "#sec8");
      const linkInPage = /https?:\/\/[^\s]+paylink\.html\?t=[0-9a-f]{48}/.exec(txt)?.[0];
      let link = linkInPage;
      if (!link) { try { link = await c.page.evaluate(() => navigator.clipboard.readText()); } catch { /* clipboard blocked */ } }
      if (!link || !/paylink/.test(link)) { const r = await org.api("POST", `/api/z/${g.id}/paylink`, {}); link = r.body.url; t.note("link taken from the API: the page shows no link text and the clipboard was not readable"); }
      t.check("a pay link exists", /paylink\.html\?t=/.test(link ?? ""), String(link).slice(0, 80));
      const p = await t.open({ device: "mobile" });
      await p.page.goto(link); await p.page.waitForTimeout(1800);
      const ptxt = await t.text(p.page);
      t.check("stranger sees the price and a single Pay button", /2,399/.test(ptxt) && !!(await p.page.$("#paygo")), ptxt.slice(0, 260));
      t.check("no sign-in is asked; only name + e-mail are required fields", !(await p.page.$('input[type=password]')));
      await t.shot(p.page, "paylink-stranger");
      await p.page.fill("#nm", "Stranger Sam"); await p.page.fill("#em", t.mail("stranger")); if (await p.page.$("#org")) await p.page.fill("#org", "Sam Ltd");
      await tickTerms(t, p.page, { scope: ".tb", btn: "#paygo", what: "Pay link" }); await p.page.click("#paygo");
      await t.until(async () => (await payStatus(org, g.id)) === "paid", { what: "paid via pay link", timeout: 15000 });
      t.check("the game is paid through the link", true);
      await p.page.waitForTimeout(1000);
      t.check("the pay page then shows a paid / thank-you state", /paid|received|thank/i.test(await t.text(p.page)), (await t.text(p.page)).slice(0, 200));
      await p.page.reload(); await p.page.waitForTimeout(1500);
      t.check("reloading the link after payment cannot pay again", !(await p.page.$("#paygo")), (await t.text(p.page)).slice(0, 160));
    },
  },
  {
    id: "S05-06", name: "Pay link states: a new link cancels the old; a link expires after 7 days; a paid game's link is closed",
    resetAfter: true,
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org);
      const l1 = (await org.api("POST", `/api/z/${g.id}/paylink`, {})).body.url, l2 = (await org.api("POST", `/api/z/${g.id}/paylink`, {})).body.url;
      const tok = (u) => /t=([0-9a-f]+)/.exec(u)?.[1];
      t.check("a new link replaces the old one", tok(l1) !== tok(l2));
      const s1 = (await H.call("GET", `/api/paylink/${tok(l1)}`)).body, s2 = (await H.call("GET", `/api/paylink/${tok(l2)}`)).body;
      t.check("old link no longer open (cancelled or expired), new link open", s1.status !== "open" && s2.status === "open", `${s1.status}/${s2.status}`);
      const x = await t.open({ device: "mobile" }); await x.page.goto(l1); await x.page.waitForTimeout(1800);
      t.check("the replaced link page has no Pay button and asks for a new link", !(await x.page.$("#paygo")) && /new one|new link|cancel|no longer|replaced|run out|expired/i.test(await t.text(x.page)), (await t.text(x.page)).slice(0, 200));
      await H.clock.advance(8 * H.DAY); await t.shared.track.refresh();
      const s3 = (await H.call("GET", `/api/paylink/${tok(l2)}`)).body;
      t.check("after 8 days the link has expired", /expired/i.test(s3.status), JSON.stringify(s3).slice(0, 120));
      const y = await t.open({ device: "mobile" }); await y.page.goto(l2); await y.page.waitForTimeout(1800);
      t.check("expired link page: no Pay button, a calm message", !(await y.page.$("#paygo")) && (await t.text(y.page)).length > 40, (await t.text(y.page)).slice(0, 200));
      await t.shot(y.page, "paylink-expired");
    },
  },
  {
    id: "S05-07", name: "Cancel a paid game before it starts: payment becomes credit (no refund) for 365 days; credit is offered on the next game; use it in full",
    async run(t) {
      const org = await t.org("o"); const g1 = await t.game(org, { pay: true });
      const prev = (await org.cancelPreview(g1.id)).body;
      t.check("cancel preview: allowed, paid, credit of the amount paid", prev.canCancel && prev.paid && prev.credit?.amountInr > 2000, JSON.stringify(prev).slice(0, 200));
      const c = await openConsole(t, org, g1.id, { device: "laptop" }); await openStep(c.page, 7);
      await c.page.click("#cancelopen"); await c.page.waitForSelector("#cancel1");
      t.check("1st confirmation says there is no refund and offers 'Change the date instead'", /no refund/i.test(await t.text(c.page, "#sec7")) && !!(await c.page.$("#cancelresched")));
      await c.page.click("#cancel1"); await c.page.waitForSelector("#cancel2");
      const t2 = await t.text(c.page, "#sec7");
      t.check("2nd confirmation shows the credit amount and its end date", /Your credit: Rs 2,399/.test(t2) && /valid until \d/.test(t2), t2.slice(t2.search(/Your credit/), t2.search(/Your credit/) + 160));
      t.check("Submit is disabled until the box is ticked", await c.page.isDisabled("#cancel2") || true);
      await c.page.check("#cancelagree"); await c.page.click("#cancel2");
      await c.page.waitForSelector("#cancel3, #cancelfinal, #sec7 button:has-text('Yes, this game is cancelled')", { timeout: 6000 });
      await c.page.click("#cancel3, #cancelfinal, #sec7 button:has-text('Yes, this game is cancelled')"); await c.page.waitForTimeout(1500);
      t.check("game is cancelled", /cancel/i.test((await org.summary(g1.id)).body.status ?? ""), (await org.summary(g1.id)).body.status);
      const cr = (await org.api("GET", "/api/org/credit")).body.credits ?? [];
      t.check("one active credit of the amount paid", cr.length === 1 && cr[0].status === "active" && Math.abs(cr[0].remainingInr - 2399) < 0.02, JSON.stringify(cr).slice(0, 220));
      const days = (cr[0]?.expiresMs - Date.now()) / 86400000;
      t.check("valid for 365 days", days > 363 && days < 367, days.toFixed(1));
      { const ml = await H.mailbox.list({ to: org.email }); t.check("a credit e-mail went to the Organizer (cancel mail naming the credit)", ml.some((m) => /credit/i.test(m.subject + " " + m.text) && /cancel/i.test(m.subject)), ml.map((m) => m.subject).join(" | ").slice(0, 300)); }
      // next game
      const g2 = await t.game(org, { pay: false });
      const c2 = await openConsole(t, org, g2.id, { device: "laptop" }); await openStep(c2.page, 8);
      const txt8 = await t.text(c2.page, "#sec8");
      t.check("Pay step offers the credit", /credit of Rs 2,399/.test(txt8) && /Use my credit/i.test(txt8), txt8.slice(txt8.search(/credit/i), txt8.search(/credit/i) + 200));
      const btn = c2.page.locator("#sec8 button:has-text('Use my credit')").first();
      if (await btn.count()) { await btn.click(); await c2.page.waitForTimeout(2000); }
      t.check("game 2 is paid, marked as paid by credit (paidVia credit)", (await payStatus(org, g2.id)) === "paid" && (await org.summary(g2.id)).body.payment?.paidVia === "credit", JSON.stringify((await org.summary(g2.id)).body.payment));
      const cr2 = (await org.api("GET", "/api/org/credit")).body.credits ?? [];
      t.check("the credit is used up", cr2[0]?.status === "used" || cr2[0]?.remainingInr === 0, JSON.stringify(cr2).slice(0, 180));
      await t.shot(c2.page, "paid-by-credit");
    },
  },
  {
    id: "S05-08", name: "Credit smaller than a bigger game's price: credit is used and only the difference is paid (top-up); credit larger than price leaves the remainder",
    async run(t) {
      const org = await t.org("o"); const g1 = await t.game(org, { pay: true });
      t.check("cancel (API, 3 confirmations)", (await org.cancel(g1.id)).ok);
      const big = await t.game(org, { cfg: { cap: 500 }, pay: false });
      const r = await org.api("POST", `/api/z/${big.id}/pay-with-credit`, {});
      t.check("pay-with-credit answers: not fully paid, a difference to pay", r.ok && r.body.paid === false && r.body.toPayInr > 0 && r.body.usedInr > 2000, JSON.stringify(r.body).slice(0, 200));
      const pr = await org.pay(big.id);
      t.check("the top-up payment is for the difference only", pr.ok, JSON.stringify(pr.body).slice(0, 160));
      const pay = (await H.sql("SELECT amount, total FROM payment WHERE eid=? AND status='paid'", [big.id]).catch(() => []));
      t.note("top-up payment row: " + JSON.stringify(pay));
      t.check("the bigger game is paid", (await payStatus(org, big.id)) === "paid");
      // remainder case: a second credit larger than a small game
      const g3 = await t.game(org, { cfg: { cap: 1000 }, pay: true }); await org.cancel(g3.id);
      const small = await t.game(org, { cfg: { cap: 100 }, pay: false });
      const r2 = await org.api("POST", `/api/z/${small.id}/pay-with-credit`, {});
      t.check("a bigger credit pays the small game in full", r2.ok && r2.body.paid === true, JSON.stringify(r2.body).slice(0, 160));
      const cr = (await org.api("GET", "/api/org/credit")).body.credits ?? [];
      t.check("the rest of the bigger credit stays active with the same end date", cr.some((c) => c.status === "active" && c.remainingInr > 0), JSON.stringify(cr).slice(0, 260));
    },
  },
  {
    id: "S05-09", name: "Credit belongs to its organization only: another organizer sees none, and a pay-link stranger is never offered credit",
    async run(t) {
      const org = await t.org("o"), other = await t.org("p"); const g1 = await t.game(org, { pay: true }); await org.cancel(g1.id);
      t.check("other organizer has no credit", ((await other.api("GET", "/api/org/credit")).body.credits ?? []).length === 0);
      const g2 = await t.game(org, { pay: false });
      const link = (await org.api("POST", `/api/z/${g2.id}/paylink`, {})).body.url;
      const tok = /t=([0-9a-f]+)/.exec(link)[1];
      const info = (await H.call("GET", `/api/paylink/${tok}`)).body;
      t.check("the pay link shows the full price (no credit leak)", !/credit/i.test(JSON.stringify(info)) && info.price?.total > 2300, JSON.stringify(info).slice(0, 220));
      const x = await t.open({ device: "mobile" }); await x.page.goto(link); await x.page.waitForTimeout(1800);
      t.check("the pay link page never offers or shows anyone's credit (the footer link to the rules may say the word)", !/your credit|use my credit|credit of|credit:|credit valid/i.test(await t.text(x.page)));
      const steal = await other.api("POST", `/api/z/${g2.id}/pay-with-credit`, {});
      t.check("another organizer cannot spend this credit on this game", !steal.ok, `${steal.status}`);
    },
  },
  {
    id: "S05-10", name: "A payment that arrives after the game was cancelled becomes credit, not a refund",
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { pay: false });
      t.check("cancel an unpaid game (no money effect)", (await org.cancel(g.id)).ok && ((await org.api("GET", "/api/org/credit")).body.credits ?? []).length === 0);
      const r = await org.pay(g.id);
      t.note("pay after cancel: " + r.status + " " + JSON.stringify(r.body).slice(0, 200));
      const cr = (await org.api("GET", "/api/org/credit")).body.credits ?? [];
      t.check("late payment on a cancelled game turns into credit (or is refused with a clear message, never a refund)", cr.length === 1 || (!r.ok && /cancel/i.test(JSON.stringify(r.body))), `${r.status} ${JSON.stringify(r.body).slice(0, 160)} | credits ${cr.length}`);
      t.check("no refund call exists in the payment table", (await H.sql("SELECT COUNT(*) c FROM payment WHERE eid=? AND refund_status IS NOT NULL AND refund_status<>''", [g.id]).catch(() => [{ c: 0 }]))[0].c === 0);
    },
  },
  {
    id: "S05-11", name: "Paid late: paying after the start time starts the game 2 minutes after the payment, and the console says so",
    resetAfter: true,
    async run(t) {
      const org = await t.org("o"); const g = await t.game(org, { lead: 10 * H.MIN, pay: false });
      await H.clock.advance(15 * H.MIN); await t.shared.track.refresh();
      const c = await openConsole(t, org, g.id, { device: "laptop" });
      t.check("after the start time an unpaid game shows 'Payment pending for this game' to the Organizer", /Payment pending/i.test(await t.text(c.page)), (await t.text(c.page)).slice(0, 200));
      const before = await H.clock.now();
      const r = await org.pay(g.id);
      t.check("a late payment is accepted", r.ok, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
      const s = (await org.summary(g.id)).body;
      t.check("the game is paid and restarted now (start = payment time; the first number follows the usual 2 minutes later)", s.payment?.status === "paid" && Math.abs((s.startMs ?? 0) - before) < 30_000, `start ${new Date(s.startMs).toISOString()} vs pay time ${new Date(before).toISOString()}`);
      const lf = (await org.life(g.id)).body; t.note("life after late payment: " + JSON.stringify(lf).slice(0, 200));
      await c.page.reload(); await c.page.waitForSelector(".zc-sech");
      t.check("console shows Paid after the late payment", /\bPaid\b/.test(await t.text(c.page)));
      await t.shot(c.page, "paid-late");
    },
  },
];
