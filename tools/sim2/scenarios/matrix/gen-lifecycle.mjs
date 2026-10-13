// Family "lifecycle": a game in each state (draft, published and unpaid, paid) crossed with every action the owner can take on it: edit, reschedule (earlier, later, past, 30-day edge, beyond 30 days),
// publish, pay (once, twice, in parallel, by Host, by Co-host), cancel with every wrong and right form of the three confirmations, behaviour of a cancelled game, clone in all its variants.
// Rules checked: docs/ROLES_AND_CONSOLE_SPEC_2.md (cancel), _5.md (reschedule, 30 days, clone), _6.md (no refund, credit).  Clock-moving cases are in gen-time.mjs.
export default async function gen({ R, L }) {
  const { A, mobile, personName, clock, DAY, MIN, HOUR, roundFrom, roundTimeMs, startAt, istLabel, totalFor, packFor, istMidnight } = L;
  const out = [];
  const STATES = ["draft", "published unpaid", "paid"];
  async function setup(t, state, o = {}) {
    const org = await t.newOrg(); const g = await t.game(org, { cap: o.cap ?? 50, days: o.days ?? 6, time: o.time ?? "19:00", ...(o.game ?? {}) });
    if (!g.r.ok) throw new Error("setup create failed " + JSON.stringify(g.r.body));
    if (state !== "draft") { const p = await org.publish(g.id, mobile(t.R)); if (!p.ok) throw new Error("setup publish " + JSON.stringify(p.body)); }
    if (state === "paid") { const q = await org.pay(g.id); if (!q.ok) throw new Error("setup pay " + JSON.stringify(q.body)); }
    return { org, g };
  }
  const guestsJoin = async (t, id, n) => { const gs = []; for (let i = 0; i < n; i++) { const g = t.guest(id); const r = await g.join(); if (r.ok) gs.push(g); } return gs; };
  const summ = async (org, id) => (await org.summary(id)).body;

  // ---------- cancel: every form of the confirmations, in each state ----------
  const CONF = [["missing", undefined], ["0", 0], ["1", 1], ["2", 2], ["the text '3'", "3"], ["true", true], ["4", 4], ["-3", -3], ["null", null], ["[3]", [3]], ["the word three", "three"], ["3 (right)", 3]];
  for (const state of STATES) for (const [cl, v] of CONF) out.push({ name: `cancel|${state} confirmations=${cl}`, run: async (t) => {
    const { org, g } = await setup(t, state); const guests = state === "draft" ? [] : await guestsJoin(t, g.id, 2);
    const body = v === undefined ? {} : { confirmations: v }; const r = await org.api("POST", `/api/z/${g.id}/cancel`, body); const s = await summ(org, g.id);
    if (cl === "3 (right)") {
      t.expect("cancel with three confirmations", r, "ok"); t.check("answer says cancelled", r.body.cancelled === true, JSON.stringify(r.body));
      t.check("status says cancelled", /cancel/i.test(s.status), s.status);
      if (state === "paid") { t.check("the payment stays as credit", r.body.credit && r.body.credit.amountInr === totalFor(50), JSON.stringify(r.body.credit)); t.check("credit valid 365 days to the end of that India day", r.body.credit?.expiresMs === istMidnight(await clock.now()) + 366 * DAY, `${r.body.credit?.expiresMs}`); }
      else t.check("an unpaid game leaves no credit", r.body.credit === null, JSON.stringify(r.body.credit));
      const mails = await A.mailbox.list({ to: org.email }); t.check("the Organizer is told by e-mail", mails.some((m) => /cancel/i.test(m.subject)), mails.map((m) => m.subject).join(" | ").slice(0, 200));
      if (guests.length) { const inf = await A.call("GET", `/api/z/${g.id}/info`); t.check("guests are told it was cancelled", inf.body.cancelled === true && /cancel/i.test(inf.body.message ?? ""), JSON.stringify(inf.body).slice(0, 200)); }
    } else {
      t.expect("refused", r, "bad"); t.check("code says confirmations", r.body.code === "confirmations", JSON.stringify(r.body));
      t.check("the game is not cancelled", !/cancel/i.test(s.status), s.status);
      const cr = (await org.api("GET", "/api/org/credit")).body; t.eq("no credit appeared", cr.activeTotalInr, 0);
    }
  } });

  // ---------- cancel: the three-step flow and what follows ----------
  for (const state of STATES) {
    out.push({ name: `cancel|${state}: preview, then cancel, then everything a cancelled game must refuse`, run: async (t) => {
      const { org, g } = await setup(t, state); const guests = state === "draft" ? [] : await guestsJoin(t, g.id, 3);
      const pv = await org.cancelPreview(g.id); t.expect("preview", pv, "ok"); t.eq("preview says canCancel", pv.body.canCancel, true); t.eq("preview says paid", pv.body.paid, state === "paid");
      if (state === "paid") t.check("preview shows the credit it will leave", pv.body.credit?.amountInr === totalFor(50), JSON.stringify(pv.body.credit)); else t.check("no credit shown for an unpaid game", pv.body.credit === null);
      const c1 = await org.cancel(g.id); t.expect("cancel", c1, "ok");
      const c2 = await org.cancel(g.id); t.expect("cancel again", c2, "ok"); t.check("second cancel says already", c2.body.already === true, JSON.stringify(c2.body));
      if (state === "paid") t.eq("second cancel returns the same credit", c2.body.credit?.id, c1.body.credit?.id);
      const cr = (await org.api("GET", "/api/org/credit")).body; t.eq("exactly one credit, never two", cr.credits.length, state === "paid" ? 1 : 0);
      const pv2 = await org.cancelPreview(g.id); t.check("preview after cancel says it cannot be cancelled again, with a reason", pv2.body.canCancel === false && !!pv2.body.reason, JSON.stringify(pv2.body));
      t.expect("publishing a cancelled game is refused", await org.publish(g.id, mobile(t.R)), state === "draft" ? "bad" : [200, 400, 409]);
      const sAfter = await summ(org, g.id); t.check("it is still cancelled after those calls", /cancel/i.test(sAfter.status), sAfter.status);
      t.expect("paying a cancelled game is refused", await org.pay(g.id), "bad");
      const sPay = await summ(org, g.id); t.check("a refused payment did not revive it", /cancel/i.test(sPay.status) && sPay.payment?.status !== "paid" || state === "paid", sPay.status);
      if (state !== "draft") { t.expect("a new guest cannot join a cancelled game", await t.guest(g.id).join(), "refuse"); }
      for (const gu of guests.slice(0, 1)) { const me = await gu.me(); t.check("an existing guest's page answers calmly", me.status < 500, `HTTP ${me.status}`); }
      t.expect("erase after cancel", await org.erase(g.id), "ok");
      const clone = await org.api("POST", `/api/z/${g.id}/clone`, {}); t.expect("clone a cancelled game", clone, "ok");
      const sl = await org.api("GET", `/api/z/${g.id}/summary`); t.check("cancelled game can still be read", sl.ok);
    } });
  }
  out.push({ name: "cancel|Host cancels a paid game: Organizer is told, Host is told, credit goes to the account", run: async (t) => {
    const { org, g } = await setup(t, "paid"); const host = await t.host(org, "Hema Iyer"); await A.mailbox.clear();
    const r = await host.api("POST", `/api/z/${g.id}/cancel`, { confirmations: 3 }); t.expect("Host cancels", r, "ok");
    const m = await A.mailbox.list({ to: org.email }); t.check("Organizer is e-mailed that a Host cancelled", m.some((x) => /cancel/i.test(x.subject)), m.map((x) => x.subject).join(" | "));
    t.check("credit belongs to the Organizer account", ((await org.api("GET", "/api/org/credit")).body.activeTotalInr ?? 0) === totalFor(50));
  } });
  out.push({ name: "cancel|a Host's console can cancel but cannot create the game it cancelled", run: async (t) => {
    const { org, g } = await setup(t, "published unpaid"); const host = await t.host(org);
    t.expect("Host cancel an unpaid game", await host.api("POST", `/api/z/${g.id}/cancel`, { confirmations: 3 }), "ok");
    t.expect("Host cannot create games", await host.api("POST", "/api/z", { id: t.gid(), startRound: g.startRound, callSeconds: 9, cap: 30 }), "deny");
  } });

  // ---------- edit ----------
  const EDITS = [
    ["name", { name: "Dealer meet - Mehta and Sons" }, "ok"], ["prizes to three lines", { rewards: [{ pattern: "corners", scope: "ticket", ordinal: 1, text: "Gift voucher: Rs 500" }, { pattern: "blackout", scope: "ticket", ordinal: 1, text: "Smartphone" }, { pattern: "blackout", scope: "ticket", ordinal: 2, text: "Smart watch" }] }, "ok"],
    ["rounds to 3", { rounds: 3 }, "ok"], ["tickets to 2", { tickets: 2 }, "ok"], ["gap to 12", { callSeconds: 12 }, "ok"], ["who can join to list", { whoCanJoin: "list" }, "ok"], ["size down to 20", { cap: 20 }, "ok"],
    ["size up to 100 (inside the pack of 100)", { cap: 100 }, "ok"], ["size up to 101", { cap: 101 }, "paid-only-402"],
  ];
  for (const state of STATES) for (const [label, patch, rule] of EDITS) out.push({ name: `edit|${state}: ${label}`, run: async (t) => {
    const { org, g } = await setup(t, state, { cap: label.startsWith("size up to 100") ? 60 : 50 }); const before = await summ(org, g.id);
    const r = await org.settings(g.id, patch);
    if (rule === "paid-only-402") {
      if (state === "paid") { t.expect("a bigger size than the paid pack", r, [402]); t.check("the message names the pack", /100/.test(r.body.error ?? ""), r.body.error); t.eq("size unchanged", (await summ(org, g.id)).limit, 50); }
      else { t.expect("before payment the size can still change", r, "ok"); t.eq("size saved", (await summ(org, g.id)).limit, 101); }
      return;
    }
    t.expect("edit", r, "ok"); const s = await summ(org, g.id); const key = Object.keys(patch)[0];
    const got = { name: s.name, rewards: s.rewards?.length, rounds: s.rounds, tickets: s.tickets, callSeconds: s.callSeconds, whoCanJoin: s.whoCanJoin, cap: s.limit }[key === "cap" ? "cap" : key]; const want = key === "rewards" ? patch.rewards.length : patch[key];
    if (key !== "name") t.eq(`${key} saved`, got, want); else { const inf = await A.call("GET", `/api/z/${g.id}/info`, undefined, org.h); t.eq("name saved", inf.body.name, patch.name); }
    if (state === "paid") t.eq("a paid game stays paid after an edit", s.payment?.status, "paid"); else t.check("payment state unchanged", s.payment?.status !== "paid");
    t.eq("start time did not move", s.startRound, before.startRound);
  } });
  out.push({ name: "edit|size cannot go below the people already in", run: async (t) => {
    const { org, g } = await setup(t, "paid", { cap: 50 }); const gs = await guestsJoin(t, g.id, 5); t.eq("five joined", gs.length, 5);
    const r = await org.settings(g.id, { cap: 3 }); t.expect("cap 3 with 5 people", r, [409]); t.eq("size unchanged", (await summ(org, g.id)).limit, 50);
    t.expect("cap 5 is fine", await org.settings(g.id, { cap: 5 }), "ok");
  } });
  out.push({ name: "edit|a full game cannot take another person, a bigger size lets them in", run: async (t) => {
    const { org, g } = await setup(t, "paid", { cap: 2 }); await guestsJoin(t, g.id, 2); const x = t.guest(g.id);
    t.expect("third person refused", await x.join(), [409]); t.expect("raise to 4 (inside the pack)", await org.settings(g.id, { cap: 4 }), "ok"); t.expect("third person joins", await x.join(), "ok");
  } });

  // ---------- reschedule ----------
  const now0 = () => clock.now();
  const RES = [["an earlier time (30 minutes from now)", async () => roundFrom((await now0()) + 30 * MIN), "ok"], ["a later time (10 days on)", async (g) => g.startRound + (10 * DAY) / 3000, "ok"], ["the same time", async (g) => g.startRound, "ok"],
    ["a time in the past", async () => roundFrom((await now0()) - HOUR), "past"], ["29 days and 23 hours ahead", async () => roundFrom((await now0()) + 29 * DAY + 23 * HOUR), "ok"], ["30 days and 1 hour ahead", async () => roundFrom((await now0()) + 30 * DAY + HOUR), "far"], ["a year ahead", async () => roundFrom((await now0()) + 365 * DAY), "far"], ["a number that is not a time", async () => "tomorrow", "junk"]];
  for (const state of STATES) for (const [label, fn, rule] of RES) out.push({ name: `reschedule|${state}: ${label}`, run: async (t) => {
    const { org, g } = await setup(t, state, { days: 6 }); const before = await summ(org, g.id); const sr = await fn(g);
    const r = await org.settings(g.id, { startRound: sr }); const after = await summ(org, g.id);
    if (rule === "ok") {
      t.expect("reschedule", r, "ok"); t.eq("new start saved", after.startRound, sr); t.eq("India time shown", after.startsAtIST, istLabel(roundTimeMs(sr)));
      t.eq("payment state kept", after.payment?.status === "paid", state === "paid");
      if (state !== "paid") t.eq("the erasure time follows the new start by the same distance", after.erasureMs - before.erasureMs, roundTimeMs(sr) - roundTimeMs(before.startRound));
      else t.check("a paid game's erasure time moves with the start", after.erasureMs - before.erasureMs === roundTimeMs(sr) - roundTimeMs(before.startRound), `${after.erasureMs - before.erasureMs} vs ${roundTimeMs(sr) - roundTimeMs(before.startRound)}`);
    } else {
      t.expect("refused", r, "bad"); t.eq("start not changed", after.startRound, before.startRound);
      if (rule === "far") { t.eq("code too-far", r.body.code, "too-far"); t.check("message says 30 days", /30 days/.test(r.body.error ?? ""), r.body.error); }
      if (rule === "past") t.check("message asks for a future time", /future/i.test(r.body.error ?? ""), r.body.error);
    }
  } });

  // ---------- publish ----------
  out.push({ name: "publish|publish twice is the same publish", run: async (t) => {
    const { org, g } = await setup(t, "draft"); const a = await org.publish(g.id, mobile(t.R)), b = await org.publish(g.id, mobile(t.R));
    t.expect("first", a, "ok"); t.expect("second", b, "ok"); t.check("second says already", b.body.already === true, JSON.stringify(b.body));
    const m = (await A.mailbox.list({ to: org.email })).filter((x) => /is published/.test(x.subject)); t.eq("one published e-mail only", m.length, 1);
  } });
  for (const [label, body] of [["no phone", { email: "x" }], ["phone with letters", { phone: "98abc12345" }], ["phone too short", { phone: "12345" }], ["empty body", {}], ["Indian-length number starting with 5", { phone: "5555555555" }]])
    out.push({ name: `publish|bad contact: ${label}`, run: async (t) => {
      const { org, g } = await setup(t, "draft"); const r = await org.api("POST", `/api/z/${g.id}/publish`, label === "no phone" ? { email: org.email } : { email: org.email, ...body }); t.expect("refused", r, "bad");
      t.eq("still a draft", (await summ(org, g.id)).status, "draft");
    } });
  out.push({ name: "publish|a game whose date is still pending cannot be published", run: async (t) => {
    const { org, g } = await setup(t, "paid"); const c = await org.api("POST", `/api/z/${g.id}/clone`, {}); t.expect("clone without a date", c, "ok"); t.check("needs a date", c.body.needsStart === true, JSON.stringify(c.body).slice(0, 200));
    const p = await org.publish(c.body.id, mobile(t.R)); t.expect("publish refused", p, "bad"); t.eq("code start-pending", p.body.code, "start-pending");
    t.expect("pay refused", await org.pay(c.body.id), "bad");
    t.expect("pick a date", await org.settings(c.body.id, { startRound: (await startAt(9, "20:00")).round }), "ok");
    t.expect("publish now", await org.publish(c.body.id, mobile(t.R)), "ok");
  } });

  // ---------- pay ----------
  out.push({ name: "pay|a draft that was never published", run: async (t) => {
    const { org, g } = await setup(t, "draft"); const r = await org.pay(g.id); const s = await summ(org, g.id);
    t.check("either refused plainly or the game is published and paid together", r.status < 500 && (r.ok ? s.payment?.status === "paid" : !!r.body.error), `HTTP ${r.status} ${s.status}`);
  } });
  out.push({ name: "pay|paid once, second payment refused, status never flips", run: async (t) => {
    const { org, g } = await setup(t, "published unpaid"); const a = await org.pay(g.id), b = await org.pay(g.id), c = await org.pay(g.id);
    t.expect("first", a, "ok"); t.expect("second", b, [409]); t.expect("third", c, [409]); t.eq("status", (await summ(org, g.id)).status, "published and paid");
    const pays = await A.sql("SELECT COUNT(*) c FROM payment WHERE eid=? AND status='paid'", [g.id]); t.eq("exactly one paid payment row", pays[0].c, 1);
    const inv = (await A.mailbox.list({ to: org.email })).filter((x) => /payment received/.test(x.subject)); t.eq("one payment receipt e-mail", inv.length, 1);
  } });
  out.push({ name: "pay|five payments at the same moment: one wins, nobody pays twice", run: async (t) => {
    const { org, g } = await setup(t, "published unpaid"); const rs = await Promise.all([1, 2, 3, 4, 5].map(() => org.pay(g.id)));
    const okN = rs.filter((r) => r.ok).length; t.check("at most one succeeds", okN === 1, `${okN} succeeded: ${rs.map((r) => r.status).join(",")}`);
    const pays = await A.sql("SELECT COUNT(*) c FROM payment WHERE eid=? AND status='paid'", [g.id]); t.eq("one paid row for the game", pays[0].c, 1);
    const ent = await A.sql("SELECT COUNT(*) c FROM entitlement WHERE org=(SELECT org FROM engagement WHERE id=?)", [g.id]); t.check("no spare entitlement (the raced money) was created", ent[0].c <= 1, `${ent[0].c} entitlements`);
  } });
  out.push({ name: "pay|by a Host: paid by host, then the Organizer's payment is refused", run: async (t) => {
    const { org, g } = await setup(t, "published unpaid"); const host = await t.host(org); const r = await host.api("POST", "/api/payments/test", { eid: g.id, email: host.email, org: "Sharma Textiles", country: "IN" });
    t.expect("Host pays", r, "ok"); t.eq("paidBy", (await summ(org, g.id)).payment?.paidBy, "host"); t.expect("Organizer pays again", await org.pay(g.id), [409]);
  } });
  out.push({ name: "pay|by a Co-host of that game: paid by co-host", run: async (t) => {
    const { org, g } = await setup(t, "published unpaid"); const co = await t.cohost(org, g.id); t.allow("sim+cohost-payer@example.com");
    const r = await co.api("POST", "/api/payments/test", { eid: g.id, email: "sim+cohost-payer@example.com", org: "Sharma Textiles", country: "IN" }); t.expect("Co-host pays", r, "ok"); t.eq("paidBy", (await summ(org, g.id)).payment?.paidBy, "co-host");
    const cs = await co.api("GET", `/api/z/${g.id}/cohost`); t.eq("Co-host sees Paid", cs.body.payment?.status, "paid");
  } });
  out.push({ name: "pay|a pay link: opens without sign-in, shows only name, date and price, pays that game only", run: async (t) => {
    const { org, g } = await setup(t, "published unpaid"); const pl = await org.api("POST", `/api/z/${g.id}/paylink`, {}); t.expect("make the link", pl, "ok");
    const tok = /[?&]t=([^&\s]+)/.exec(pl.body.url ?? pl.body.link ?? "")?.[1]; t.check("link has a token", !!tok, JSON.stringify(pl.body).slice(0, 200)); if (!tok) return;
    const view = await A.call("GET", `/api/paylink/${tok}`); t.expect("open without a key", view, "ok"); const txt = JSON.stringify(view.body);
    t.check("price with GST is shown", txt.includes(String(totalFor(50))), txt.slice(0, 200)); t.check("no Organizer e-mail or key leaks", !txt.includes(org.email) && !/cbk_|cba_|cbh_/.test(txt), txt.slice(0, 200));
    t.check("no guest or credit data leaks", !/credit|phone/i.test(txt) && !/(?<!\d)\d{10}(?!\d)/.test(txt), txt.slice(0, 200)); // the pack size (participants: N) and the start time (13 digits) are meant to be shown; a phone number or credit is not
    const bad = await A.call("GET", `/api/paylink/${"0".repeat(32)}`); t.expect("a wrong token is refused calmly", bad, "refuse");
  } });

  // ---------- clone ----------
  out.push({ name: "clone|copies the settings, not the payment, people, Co-hosts or date", run: async (t) => {
    const rewards = [{ pattern: "corners", scope: "ticket", ordinal: 1, text: "Gift hamper" }, { pattern: "blackout", scope: "ticket", ordinal: 1, text: "Smartphone" }, { pattern: "blackout", scope: "ticket", ordinal: 2, text: "" }];
    const { org, g } = await setup(t, "paid", { cap: 250, game: { tickets: 2, rounds: 3, gap: 12, who: "list", name: "Diwali party - Tulsi Jewellers", rewards, brand: { name: "Tulsi Jewellers", color: "#6A1B9A" } } });
    await org.settings(g.id, { guestInvites: { on: true, per: 6, cats: ["family", "friends"] } }); await guestsJoin(t, g.id, 0); await org.addPeople(g.id, [{ name: "Asha Menon", phone: "9876543210" }]); await t.cohost(org, g.id);
    const c = await org.api("POST", `/api/z/${g.id}/clone`, {}); t.expect("clone", c, "ok"); const n = c.body.id; t.check("new id differs", n && n !== g.id);
    const s = await summ(org, n); const o = await summ(org, g.id);
    t.eq("tickets", s.tickets, 2); t.eq("rounds", s.rounds, 3); t.eq("gap", s.callSeconds, 12); t.eq("who can join", s.whoCanJoin, "list"); t.eq("size", s.limit, 250); t.eq("invites", s.guestInvites?.per, 6);
    t.eq("prizes copied", JSON.stringify(s.rewards), JSON.stringify(o.rewards)); t.eq("brand copied", JSON.stringify((await A.call("GET", `/api/z/${n}/info`, undefined, org.h)).body.brand), JSON.stringify({ name: "Tulsi Jewellers", color: "#6A1B9A" }));
    t.eq("the clone is a draft", s.status, "draft"); t.check("payment not copied", s.payment?.status !== "paid"); t.eq("no people copied", s.participants, 0);
    t.check("the date is not copied", c.body.needsStart === true, JSON.stringify(c.body).slice(0, 200)); t.check("the copied list is told to the Organizer", Array.isArray(c.body.copied) && c.body.copied.length > 5, JSON.stringify(c.body.copied));
    const tm = (await org.api("GET", `/api/org/team?e=${n}`)).body; t.eq("no Co-hosts copied", (tm.cohosts ?? []).length, 0);
    const pe = await org.people(n); t.eq("no people list copied", pe.body.total ?? pe.body.people?.length ?? 0, 0);
    t.check("the original is untouched", o.payment?.status === "paid" && o.status === "published and paid", o.status);
  } });
  for (const [label, body, rule] of [["with a date 5 days ahead", { startRound: "D5" }, "ok"], ["with a date in the past", { startRound: "PAST" }, "bad"], ["with a date 31 days ahead", { startRound: "FAR" }, "far"], ["with people", { withPeople: true }, "people"], ["with a date and people", { startRound: "D5", withPeople: true }, "people"], ["a startRound that is text", { startRound: "soon" }, "bad"]])
    out.push({ name: `clone|${label}`, run: async (t) => {
      const { org, g } = await setup(t, "paid"); await org.addPeople(g.id, [{ name: "Ritu Kapoor", phone: "9812345670" }, { name: "Gurpreet Singh", phone: "9812345671" }]);
      const b = { ...body }; if (b.startRound === "D5") b.startRound = (await startAt(5, "18:00")).round; if (b.startRound === "PAST") b.startRound = roundFrom((await clock.now()) - HOUR); if (b.startRound === "FAR") b.startRound = roundFrom((await clock.now()) + 31 * DAY);
      const r = await org.api("POST", `/api/z/${g.id}/clone`, b);
      if (rule === "ok" || rule === "people") {
        t.expect("clone", r, "ok"); if (b.startRound) { t.eq("not waiting for a date", r.body.needsStart, false); t.eq("start saved", (await summ(org, r.body.id)).startRound, b.startRound); }
        if (rule === "people") { t.eq("two people copied", r.body.peopleCopied, 2); const p = await org.people(r.body.id); t.eq("list on the new game", p.body.total, 2); t.check("new personal links, different from the old", (p.body.people ?? []).every((x) => x.link) && !(p.body.people ?? []).some((x) => (x.link ?? "") === ""), JSON.stringify(p.body).slice(0, 160)); const old = await org.people(g.id); t.check("old list still there until erased", old.body.total === 2); }
      } else { t.expect("refused", r, "bad"); if (rule === "far") t.eq("code too-far", r.body.code, "too-far"); }
    } });
  out.push({ name: "clone|a cloned draft counts against the 10-draft limit", run: async (t) => {
    const { org, g } = await setup(t, "paid"); const ids = [];
    for (let i = 0; i < 10; i++) { const c = await org.api("POST", `/api/z/${g.id}/clone`, {}); if (c.ok) ids.push(c.body.id); else { t.check("11th clone refused with code draft-limit", i === 10 || c.body.code === "draft-limit", JSON.stringify(c.body)); break; } }
    const c2 = await org.api("POST", `/api/z/${g.id}/clone`, {}); t.expect("one more", c2, [409]); t.eq("code draft-limit", c2.body.code, "draft-limit");
  } });
  out.push({ name: "clone|another organizer cannot clone this game, and an unknown game answers calmly", run: async (t) => {
    const { org, g } = await setup(t, "paid"); const other = await t.newOrg("x"); t.expect("other account", await other.api("POST", `/api/z/${g.id}/clone`, {}), "deny"); t.expect("unknown game", await org.api("POST", "/api/z/NOSUCHGAME/clone", {}), "deny");
  } });
  out.push({ name: "clone|a Host clones with equal rights, the AI key may not", run: async (t) => {
    const { org, g } = await setup(t, "paid"); const host = await t.host(org); t.expect("Host", await host.api("POST", `/api/z/${g.id}/clone`, {}), "ok"); t.expect("AI key", await A.call("POST", `/api/z/${g.id}/clone`, {}, { "x-organizer": org.aiKey }), "deny");
  } });
  return out;
}
