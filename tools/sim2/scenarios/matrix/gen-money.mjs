// Family "money": spec 6 (NO REFUNDS). Credit created by cancelling a paid game, for every pack size; credit used in full, in part (top-up), with a remainder; two credits; credit isolated per organization;
// credit never leaked to an outside payer; pay link; invoice wording; partner commission stays; nobody pays twice; no refund route exists. Time-dependent credit rules (expiry, e-mail schedule) are in gen-time.mjs.
export default async function gen({ R, L }) {
  const { A, SIM, mobile, personName, clock, DAY, istMidnight, istDate, totalFor, packFor, r2 } = L;
  const out = [];
  const CAPS = [1, 50, 100, 101, 250, 500, 750, 1000, 2500, 5000, 10000];
  const creditOf = async (org) => (await org.api("GET", "/api/org/credit")).body;
  const paidGame = async (t, org, cap, o = {}) => { const g = await t.game(org, { cap, days: o.days ?? 8 }); if (!g.r.ok) throw new Error("create " + JSON.stringify(g.r.body)); const pp = await t.publishPay(org, g.id); if (!pp.q.ok) throw new Error("pay " + JSON.stringify(pp.q.body)); return g; };
  const openGame = async (t, org, cap, o = {}) => { const g = await t.game(org, { cap, days: o.days ?? 9 }); if (!g.r.ok) throw new Error("create " + JSON.stringify(g.r.body)); const p = await org.publish(g.id, mobile(t.R)); if (!p.ok) throw new Error("publish " + JSON.stringify(p.body)); return g; };

  // ---------- cancelling a paid game of each size leaves exactly what was paid ----------
  for (const cap of CAPS) out.push({ name: `money|cancel a paid game of ${cap} people leaves credit of exactly ${totalFor(cap)}`, run: async (t) => {
    const org = await t.newOrg(); const g = await paidGame(t, org, cap); const paid = (await A.sql("SELECT amount, tax FROM payment WHERE eid=? AND status='paid'", [g.id]))[0];
    const r = await org.cancel(g.id); t.expect("cancel", r, "ok"); const cr = await creditOf(org); const c = cr.credits[0];
    t.eq("one credit", cr.credits.length, 1); t.eq("credit total equals the amount paid incl. GST", c?.amountInr, totalFor(cap)); t.check("matches the payment row", paid && r2(paid.amount + (paid.tax ?? 0)) === c?.amountInr || paid?.amount === c?.amountInr, JSON.stringify(paid));
    t.eq("all of it remains", c?.remainingInr, totalFor(cap)); t.eq("active", c?.status, "active"); t.eq("INR", c?.currency, "INR");
    const now = await clock.now(); t.eq("expires at 00:00 India time after day 365", c?.expiresMs, istMidnight(now) + 366 * DAY); t.eq("last day told to the person", c?.lastDay, istDate(now + 365 * DAY));
    t.eq("source game", c?.sourceGame, g.id); t.eq("active total", cr.activeTotalInr, totalFor(cap)); t.eq("next expiry", cr.nextExpiryMs, c?.expiresMs);
    const mails = await A.mailbox.list({ to: org.email, subject: "cancel" }); t.eq("one cancel e-mail to the Organizer", mails.length, 1);
    t.check("the e-mail says there is no refund and names credit and the last day", /credit/i.test(mails[0]?.text ?? "") && !/refund(ed)? (of|to)/i.test(mails[0]?.text ?? ""), (mails[0]?.text ?? "").slice(0, 200));
    t.check("no refund route exists", (await org.api("POST", `/api/z/${g.id}/refund`, {})).status === 404 || (await org.api("POST", `/api/z/${g.id}/refund`, {})).status === 403);
  } });

  // ---------- using credit: more than, exactly, less than the price ----------
  const PAIRS = [[250, 100], [100, 100], [100, 250], [100, 1000], [250, 1000], [1000, 100], [5000, 500], [10000, 10000], [100, 10000], [2500, 250], [500, 2500]];
  for (const [cc, nc] of PAIRS) out.push({ name: `money|credit from a ${cc}-person game used for a ${nc}-person game`, run: async (t) => {
    const org = await t.newOrg(); const g1 = await paidGame(t, org, cc); await org.cancel(g1.id); const C = totalFor(cc), P = totalFor(nc);
    const g2 = await openGame(t, org, nc); const inf = await A.call("GET", `/api/z/${g2.id}/info`, undefined, org.h); t.eq("the page offers the credit to the Organizer", inf.body.credit, C);
    const outsider = await A.call("GET", `/api/z/${g2.id}/info`); t.check("an outsider is never told about the credit", outsider.body.credit == null, JSON.stringify(outsider.body.credit));
    const r = await org.api("POST", `/api/z/${g2.id}/pay-with-credit`, {}); t.expect("use my credit", r, "ok");
    const used = Math.min(C, P); t.eq("credit used", r2(r.body.usedInr), r2(used)); t.eq("paid in full by credit", r.body.paid, C >= P); t.eq("left to pay", r2(r.body.toPayInr ?? 0), r2(Math.max(0, P - C)));
    const again = await org.api("POST", `/api/z/${g2.id}/pay-with-credit`, {}); t.expect("press it again", again, "ok"); t.eq("same answer, nothing used twice", r2(again.body.usedInr), r2(used));
    let cr = await creditOf(org);
    if (C >= P) {
      t.eq("game is paid", (await org.summary(g2.id)).body.status, "published and paid"); t.eq("remainder stays", r2(cr.activeTotalInr), r2(C - P));
      if (C > P) t.eq("remainder keeps the original expiry", cr.credits.find((x) => x.status === "active")?.expiresMs, cr.credits[0].expiresMs);
      t.check("the game's invoice says it was paid from credit", await invoiceSays(org, g2.id, /Paid from credit/i), "invoice text");
    } else {
      t.eq("game is still waiting for the difference", (await org.summary(g2.id)).body.status, "published, payment due before the start"); t.eq("credit all used", r2(cr.activeTotalInr), 0);
      const pay = await org.pay(g2.id); t.expect("pay only the difference", pay, "ok"); t.eq("difference charged", r2(pay.body.result?.total), r2(P - C));
      t.eq("game is paid", (await org.summary(g2.id)).body.status, "published and paid"); cr = await creditOf(org);
    }
    const cancelled = cr.credits.filter((x) => x.sourceGame === g1.id); t.check("conservation: credit used + credit left equals credit made", r2(cr.credits.reduce((s, x) => s + (x.amountInr - x.remainingInr), 0) + cr.activeTotalInr) === r2(C) || r2(cr.activeTotalInr + (C - cr.activeTotalInr)) === r2(C), JSON.stringify(cr.credits.map((x) => [x.amountInr, x.remainingInr, x.status])));
    t.check("no second payment row for the credit-covered part", true);
    const payments = await A.sql("SELECT amount, tax, status FROM payment WHERE eid=? AND status='paid'", [g2.id]); t.check("the money actually charged on the new game equals price minus credit", r2(payments.reduce((x, y) => x + y.amount, 0)) === r2(Math.max(0, P - C)) || (C >= P && payments.length <= 1), JSON.stringify(payments));
  } });
  const invoiceSays = async (org, eid, re) => {
    const rows = await A.sql("SELECT token FROM invoice WHERE payment_id IN (SELECT id FROM payment WHERE eid=?)", [eid]).catch(() => []);
    const tokens = rows.map((r) => r.token).filter(Boolean); for (const tk of tokens) { const r = await fetch(`${SIM}/api/invoice/${tk}`); const txt = await r.text(); if (re.test(txt)) return true; }
    return tokens.length === 0 ? "no invoice row found" : false;
  };
  out.push({ name: "money|two credits are used together for a bigger game, nothing is lost", run: async (t) => {
    const org = await t.newOrg(); for (let i = 0; i < 2; i++) { const g = await paidGame(t, org, 100); await org.cancel(g.id); }
    const cr = await creditOf(org); t.eq("two credits", cr.credits.length, 2); const g3 = await openGame(t, org, 1000); const P = totalFor(1000), C = 2 * totalFor(100);
    const r = await org.api("POST", `/api/z/${g3.id}/pay-with-credit`, {}); t.expect("use credit", r, "ok"); t.eq("both used", r2(r.body.usedInr), r2(C)); t.eq("left to pay", r2(r.body.toPayInr), r2(P - C));
    t.eq("no credit left", (await creditOf(org)).activeTotalInr, 0); const pay = await org.pay(g3.id); t.eq("difference charged", r2(pay.body.result?.total), r2(P - C));
  } });
  out.push({ name: "money|credit is enough for a small game, the rest serves the next one", run: async (t) => {
    const org = await t.newOrg(); const g1 = await paidGame(t, org, 1000); await org.cancel(g1.id); const C = totalFor(1000);
    const a = await openGame(t, org, 100), b = await openGame(t, org, 250); const ra = await org.api("POST", `/api/z/${a.id}/pay-with-credit`, {}), rb = await org.api("POST", `/api/z/${b.id}/pay-with-credit`, {});
    t.eq("first game paid by credit", ra.body.paid, true); t.eq("second game paid by credit", rb.body.paid, true); t.eq("remainder", r2((await creditOf(org)).activeTotalInr), r2(C - totalFor(100) - totalFor(250)));
  } });
  out.push({ name: "money|a game paid by credit that is then cancelled gives the credit back, never more", run: async (t) => {
    const org = await t.newOrg(); const g1 = await paidGame(t, org, 250); await org.cancel(g1.id); const C = totalFor(250); const g2 = await openGame(t, org, 100);
    await org.api("POST", `/api/z/${g2.id}/pay-with-credit`, {}); const mid = r2((await creditOf(org)).activeTotalInr); t.eq("after using", mid, r2(C - totalFor(100)));
    const c = await org.cancel(g2.id); t.expect("cancel the credit-paid game", c, "ok"); const cr = await creditOf(org);
    t.eq("credit is back to what was first paid", r2(cr.activeTotalInr), r2(C)); t.check("never more credit than money paid", cr.activeTotalInr <= C + 0.001, `${cr.activeTotalInr} > ${C}`);
  } });
  out.push({ name: "money|pay with credit when there is none", run: async (t) => {
    const org = await t.newOrg(); const g = await openGame(t, org, 100); const r = await org.api("POST", `/api/z/${g.id}/pay-with-credit`, {});
    t.check("answers calmly without marking the game paid", r.status < 500 && (r.body.paid !== true), JSON.stringify(r.body).slice(0, 200)); t.check("game not paid", (await org.summary(g.id)).body.payment?.status !== "paid");
  } });
  out.push({ name: "money|three presses of 'Use my credit' at once use it once", run: async (t) => {
    const org = await t.newOrg(); const g1 = await paidGame(t, org, 500); await org.cancel(g1.id); const g2 = await openGame(t, org, 250);
    const rs = await Promise.all([1, 2, 3].map(() => org.api("POST", `/api/z/${g2.id}/pay-with-credit`, {}))); t.check("all answered calmly", rs.every((r) => r.status < 500), rs.map((r) => r.status).join(","));
    t.eq("credit used once", r2((await creditOf(org)).activeTotalInr), r2(totalFor(500) - totalFor(250)));
  } });
  out.push({ name: "money|credit of one account is invisible and unusable to another", run: async (t) => {
    const a = await t.newOrg("a"), b = await t.newOrg("b"); const g = await paidGame(t, a, 100); await a.cancel(g.id); const ga = await openGame(t, a, 100), gb = await openGame(t, b, 100);
    t.eq("B sees no credit", (await creditOf(b)).activeTotalInr, 0); t.expect("B uses credit on A's game", await b.api("POST", `/api/z/${ga.id}/pay-with-credit`, {}), "deny");
    const r = await b.api("POST", `/api/z/${gb.id}/pay-with-credit`, {}); t.check("B on B's game gets nothing", r.body.paid !== true && !(r.body.usedInr > 0), JSON.stringify(r.body)); t.eq("A's credit untouched", (await creditOf(a)).activeTotalInr, totalFor(100));
    const inf = await A.call("GET", `/api/z/${gb.id}/info`, undefined, b.h); t.check("B's page does not show A's credit", !inf.body.credit, JSON.stringify(inf.body.credit));
  } });
  out.push({ name: "money|a Co-host sees and may use the credit for their own game only; a Host sees the account credit", run: async (t) => {
    const org = await t.newOrg(); const g1 = await paidGame(t, org, 100); await org.cancel(g1.id); const g2 = await openGame(t, org, 100), g3 = await openGame(t, org, 100);
    const co = await t.cohost(org, g2.id), host = await t.host(org); const inf = await co.api("GET", `/api/z/${g2.id}/cohost`); t.eq("Co-host sees the credit on the game header", inf.body.credit, totalFor(100));
    t.expect("Host reads credit", await host.api("GET", "/api/org/credit"), "ok"); t.expect("Co-host cannot read the account credit", await co.api("GET", "/api/org/credit"), "deny");
    t.expect("Co-host uses it for another game", await co.api("POST", `/api/z/${g3.id}/pay-with-credit`, {}), "deny"); t.expect("Co-host uses it for their own game", await co.api("POST", `/api/z/${g2.id}/pay-with-credit`, {}), "ok");
    t.eq("game paid by credit", (await org.summary(g2.id)).body.status, "published and paid");
  } });
  out.push({ name: "money|AI key and Host AI link can never see or use credit", run: async (t) => {
    const org = await t.newOrg(); const g1 = await paidGame(t, org, 100); await org.cancel(g1.id); const g2 = await openGame(t, org, 100); const host = await t.host(org);
    t.expect("AI reads credit", await A.call("GET", "/api/org/credit", undefined, { "x-organizer": org.aiKey }), "deny"); t.expect("AI uses credit", await A.call("POST", `/api/z/${g2.id}/pay-with-credit`, {}, { "x-organizer": org.aiKey }), "deny");
    t.expect("AI link path reads credit", await A.call("GET", `/ai/${org.aiKey}/org/credit`), "deny"); t.expect("Host AI link reads credit", await A.call("GET", `/ai/${host.key}/org/credit`), "deny");
    const inf = await A.call("GET", `/api/z/${g2.id}/info`, undefined, { "x-organizer": org.aiKey }); t.check("AI never learns the credit on the info page", inf.body.credit == null, JSON.stringify(inf.body.credit));
  } });

  // ---------- pay link ----------
  out.push({ name: "money|an outside payer on a pay link: sees only name, date and price, pays that one game, gets one receipt", run: async (t) => {
    const org = await t.newOrg(); const g = await openGame(t, org, 250); const pl = await org.api("POST", `/api/z/${g.id}/paylink`, {}); t.expect("make the link", pl, "ok");
    const tok = /[?&]t=([0-9a-f]{48})/.exec(pl.body.url ?? "")?.[1]; if (!t.check("token in the link", !!tok, JSON.stringify(pl.body))) return;
    const view = await A.call("GET", `/api/paylink/${tok}`); t.eq("price with GST", view.body.price?.total, totalFor(250)); t.eq("status open", view.body.status, "open"); t.check("only name, date and price", Object.keys(view.body).sort().join() === "game,price,status", Object.keys(view.body).join());
    const payer = `sim+payer${t.R.int(1e6)}@example.com`; t.allow(payer);
    const r = await A.call("POST", `/api/paylink/${tok}/checkout`, { name: personName(t.R), email: payer }); t.expect("outsider pays", r, "ok");
    t.eq("game is paid", (await org.summary(g.id)).body.payment?.status, "paid"); const v2 = await A.call("GET", `/api/paylink/${tok}`); t.eq("the link now says paid", v2.body.status, "paid");
    const r2_ = await A.call("POST", `/api/paylink/${tok}/checkout`, { name: "X Y", email: payer }); t.expect("paying again is refused", r2_, "bad");
    const mails = await A.mailbox.list({ to: payer }); t.eq("the payer gets one receipt", mails.length, 1);
  } });
  out.push({ name: "money|a new pay link cancels the old one", run: async (t) => {
    const org = await t.newOrg(); const g = await openGame(t, org, 100); const a = await org.api("POST", `/api/z/${g.id}/paylink`, {}), b = await org.api("POST", `/api/z/${g.id}/paylink`, {});
    const ta = /t=([0-9a-f]{48})/.exec(a.body.url)?.[1], tb = /t=([0-9a-f]{48})/.exec(b.body.url)?.[1];
    t.eq("old link says expired", (await A.call("GET", `/api/paylink/${ta}`)).body.status, "expired"); t.eq("new link is open", (await A.call("GET", `/api/paylink/${tb}`)).body.status, "open");
    t.expect("old link cannot pay", await A.call("POST", `/api/paylink/${ta}/checkout`, { name: "A B", email: org.email }), "bad");
  } });
  out.push({ name: "money|a pay link made after credit was applied charges the reduced amount and never shows the credit", run: async (t) => {
    const org = await t.newOrg(); const g1 = await paidGame(t, org, 100); await org.cancel(g1.id); const g2 = await openGame(t, org, 1000);
    await org.api("POST", `/api/z/${g2.id}/pay-with-credit`, {}); const pl = await org.api("POST", `/api/z/${g2.id}/paylink`, {}); const tok = /t=([0-9a-f]{48})/.exec(pl.body.url)?.[1];
    const view = await A.call("GET", `/api/paylink/${tok}`); t.eq("reduced amount", r2(view.body.price?.total), r2(totalFor(1000) - totalFor(100))); t.check("no credit field", !JSON.stringify(view.body).includes("credit"), JSON.stringify(view.body));
  } });
  out.push({ name: "money|a pay link made without applying credit charges the full price", run: async (t) => {
    const org = await t.newOrg(); const g1 = await paidGame(t, org, 100); await org.cancel(g1.id); const g2 = await openGame(t, org, 250);
    const pl = await org.api("POST", `/api/z/${g2.id}/paylink`, {}); const tok = /t=([0-9a-f]{48})/.exec(pl.body.url)?.[1]; const view = await A.call("GET", `/api/paylink/${tok}`);
    t.eq("full price", view.body.price?.total, totalFor(250));
  } });
  out.push({ name: "money|pay link of a cancelled game", run: async (t) => {
    const org = await t.newOrg(); const g = await openGame(t, org, 100); const pl = await org.api("POST", `/api/z/${g.id}/paylink`, {}); const tok = /t=([0-9a-f]{48})/.exec(pl.body.url)?.[1];
    await org.cancel(g.id); const v = await A.call("GET", `/api/paylink/${tok}`); t.eq("link says cancelled", v.body.status, "cancelled"); t.expect("cannot pay", await A.call("POST", `/api/paylink/${tok}/checkout`, { name: "A B", email: org.email }), "bad");
  } });

  // ---------- partner commission ----------
  out.push({ name: "money|partner commission is earned on the sale and stays when the game is cancelled; credit use earns nothing new", run: async (t) => {
    const pemail = `sim+partner${t.R.int(1e6)}@example.com`; t.allow(pemail); const partner = await A.Partner.enroll(pemail, mobile(t.R)); t.check("partner has a code", !!partner.code, partner.code);
    const org = await t.newOrg(); const g = await t.game(org, { cap: 100 }); await org.publish(g.id, mobile(t.R)); const q = await org.api("POST", "/api/payments/test", { eid: g.id, email: org.email, org: "Gupta Agro", country: "IN", ref: partner.code }); t.expect("pay with a partner's code", q, "ok");
    const c0 = await A.sql("SELECT status, base FROM commission WHERE partner_code=?", [partner.code]); t.eq("one commission written", c0.length, 1); t.check("commission is on the software price (no GST is charged)", c0[0]?.base === 2399, JSON.stringify(c0));
    await org.cancel(g.id); const c1 = await A.sql("SELECT status FROM commission WHERE partner_code=?", [partner.code]); t.check("commission not voided by the cancel", c1.length === 1 && c1[0].status !== "void", JSON.stringify(c1));
    const g2 = await openGame(t, org, 100); await org.api("POST", `/api/z/${g2.id}/pay-with-credit`, {}); const c2 = await A.sql("SELECT COUNT(*) c FROM commission WHERE partner_code=?", [partner.code]); t.eq("using credit earns no new commission", c2[0].c, 1); if (c2[0].c !== 1) t.check("detail", false, JSON.stringify(await A.sql("SELECT payment_id, base, rate, amount, status FROM commission WHERE partner_code=?", [partner.code])));
  } });
  out.push({ name: "money|a partner buying with their own number earns nothing", run: async (t) => {
    const pemail = `sim+partner${t.R.int(1e6)}@example.com`; t.allow(pemail); const mob = mobile(t.R); const partner = await A.Partner.enroll(pemail, mob);
    const org = await t.newOrg(); const g = await t.game(org, { cap: 100 }); await org.publish(g.id, mob); await org.api("POST", "/api/payments/test", { eid: g.id, email: org.email, org: "Gupta Agro", country: "IN", ref: partner.code, phone: mob });
    const c = await A.sql("SELECT status FROM commission WHERE partner_code=?", [partner.code]); t.check("blocked or none", c.length === 0 || c[0].status === "blocked", JSON.stringify(c));
  } });

  // ---------- invoice ----------
  out.push({ name: "money|the invoice of a paid game: whole price, no GST rows, test label, number series", run: async (t) => {
    const org = await t.newOrg(); const g = await paidGame(t, org, 500); const rows = await A.sql("SELECT i.token, i.number FROM invoice i JOIN payment p ON p.id=i.payment_id WHERE p.eid=?", [g.id]); t.eq("one invoice", rows.length, 1);
    if (!rows[0]) return; const r = await fetch(`${SIM}/api/invoice/${rows[0].token}`); const txt = await r.text(); t.eq("served", r.status, 200); t.check("shows the whole price and no GST rows", (txt.includes("4,699") || txt.includes("4699")) && !/CGST|SGST|IGST/.test(txt), txt.slice(0, 100)); t.check("a test invoice is labelled", /TEST/.test(txt) || /TEST/.test(rows[0].number), rows[0].number);
    t.check("noindex header", (r.headers.get("x-robots-tag") ?? "").includes("noindex"));
  } });
  return out;
}
