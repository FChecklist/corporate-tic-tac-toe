// Family "people": who can join (list / anyone) crossed with every way of arriving; guest-invite levels 1 to 10 and the two-level rule; phone-number cleaning in every format; first-wins duplicates;
// list limits; the waiting room; removal; privacy (no plain names or numbers stored, no e-mail to guests); join validation; crowds of 1, 2 and 50; the /j/ personal-link page.
// Spec: docs/ROLES_AND_CONSOLE_SPEC_3.md (and _2.md items 8-10, superseded by _3).
export default async function gen({ R, L }) {
  const { A, mobile, personName, fmtMobile, deviceOf } = { ...L, deviceOf: L.A.deviceOf };
  const { SIM } = L;
  const out = [];
  const fromOf = (link) => Number(/[?&]from=(\d+)/.exec(link ?? "")?.[1]);
  async function openGame(t, o = {}) {
    const org = await t.newOrg(); const g = await t.game(org, { cap: o.cap ?? 50, who: o.who === "list" ? "list" : "anyone", days: 6 });
    if (!g.r.ok) throw new Error("create " + JSON.stringify(g.r.body));
    if (o.inv) await org.settings(g.id, { guestInvites: { on: true, per: o.inv, cats: ["family", "colleagues", "friends"] } });
    await t.publishPay(org, g.id); return { org, g };
  }
  const joinRaw = (eid, body, ip) => A.call("POST", `/api/z/${eid}/join`, { device: body.phone ? deviceOf(body.phone) : deviceOf(body.token ?? "x"), ...body }, {}, { ip });
  const outcome = (r) => (r.status === 200 ? "joined" : r.status === 403 && r.body.waiting ? "waiting" : r.body.code ?? `HTTP ${r.status}`);

  // ---------- who can join x every way of arriving ----------
  const WAYS = ["listed number typed directly", "listed number through someone else's common link", "unlisted number on the Organizer's common link", "unlisted number on a Host's common link", "unlisted number on a Co-host's common link",
    "personal link, first phone, number typed", "personal link, a different phone afterwards", "personal link with no number typed", "a garbage personal-link token", "a removed number comes back"];
  for (const who of ["list", "anyone"]) for (const way of WAYS) out.push({ name: `join|${who}: ${way}`, run: async (t) => {
    const { org, g } = await openGame(t, { who }); const host = await t.host(org), co = await t.cohost(org, g.id);
    const lp = (await org.people(g.id)).body; const hostLink = (await host.api("GET", `/api/z/${g.id}/people`)).body.commonLink, coLink = (await co.api("GET", `/api/z/${g.id}/people`)).body.commonLink;
    t.check("every inviter has a common link", !!lp.commonLink && !!hostLink && !!coLink, `${lp.commonLink} ${hostLink} ${coLink}`);
    const name = personName(t.R), phone = mobile(t.R), ip = t.ip(); let r, want;
    if (way.startsWith("listed number typed")) { await org.addPeople(g.id, [{ name, phone }]); r = await joinRaw(g.id, { phone, name }, ip); want = "joined"; }
    else if (way.startsWith("listed number through")) { await org.addPeople(g.id, [{ name, phone }]); r = await joinRaw(g.id, { phone, name, from: fromOf(coLink) }, ip); want = "joined";
      if (r.status === 200) { const mine = (await org.people(g.id)).body.people.find((p) => p.name === name); t.check("still placed under the Organizer, the real inviter (first wins)", mine?.inviter === "Organizer", JSON.stringify(mine)); } }
    else if (way.startsWith("unlisted number on the Organizer")) { r = await joinRaw(g.id, { phone, name, from: fromOf(lp.commonLink) }, ip); want = who === "list" ? "waiting" : "joined"; }
    else if (way.startsWith("unlisted number on a Host")) { r = await joinRaw(g.id, { phone, name, from: fromOf(hostLink) }, ip); want = who === "list" ? "waiting" : "joined"; }
    else if (way.startsWith("unlisted number on a Co-host")) { r = await joinRaw(g.id, { phone, name, from: fromOf(coLink) }, ip); want = who === "list" ? "waiting" : "joined"; }
    else if (way === "personal link, first phone, number typed") { const a = await org.addPeople(g.id, [{ name, phone }]); r = await joinRaw(g.id, { token: A.tokenOfLink(a.people[0].link), phone, name }, ip); want = "joined"; }
    else if (way.startsWith("personal link, a different")) { const a = await org.addPeople(g.id, [{ name, phone }]); const tok = A.tokenOfLink(a.people[0].link); t.expect("first phone", await joinRaw(g.id, { token: tok, phone, name }, ip), "ok"); r = await joinRaw(g.id, { token: tok, phone: mobile(t.R), name: "Someone Else" }, t.ip()); want = who === "list" ? "waiting" : "joined"; /* spec 3 says a different number goes to the waiting room; in 'anyone' mode the build lets them in at once: recorded as a spec ambiguity in docs/SIM_GAPS_matrix.md */ }
    else if (way === "personal link with no number typed") { const a = await org.addPeople(g.id, [{ name, phone }]); r = await joinRaw(g.id, { token: A.tokenOfLink(a.people[0].link), name }, ip); want = "joined"; }
    else if (way === "a garbage personal-link token") { r = await joinRaw(g.id, { token: "zzzzzzzz9", phone, name }, ip); want = "link-gone"; }
    else { const a = await org.addPeople(g.id, [{ name, phone }]); const id = a.people[0].id; t.expect("remove before the game", await org.api("POST", `/api/z/${g.id}/people/${id}/remove`, {}), "ok"); r = await joinRaw(g.id, { phone, name }, ip); want = "removed"; }
    t.eq("outcome", outcome(r), want);
    if (want === "waiting") { t.check("waiting guest gets a calm sentence", /request|invit|organizer|yes/i.test(r.body.error ?? ""), r.body.error); const w = (await org.waiting(g.id)).body.waiting ?? []; t.check("the request is in the waiting room", w.length >= 1, JSON.stringify(w).slice(0, 160)); t.check("approver sees only first name and last 4 digits", w.every((x) => /^\d{4}$/.test(x.last4) && !JSON.stringify(x).includes(phone)), JSON.stringify(w).slice(0, 160)); }
    if (want === "joined" || want === "waiting") { const pe = (await org.api("GET", `/api/z/${g.id}/participants`)).body; const first = way.startsWith("personal link, a different") ? 1 : 0; t.eq("a waiting person does not use a place", pe.total, want === "joined" ? first + 1 : first); }
  } });

  // ---------- guest-invite levels ----------
  for (const per of [1, 2, 4, 10]) {
    out.push({ name: `invites|per person ${per}: the first guest may bring ${per}, the next one is told it is full`, run: async (t) => {
      const { org, g } = await openGame(t, { who: "anyone", inv: per, cap: 100 }); const l1 = t.guest(g.id); t.expect("L1 joins", await l1.join(), "ok"); const seat = (await l1.me()).body.seat;
      const iv = (await l1.invites()).body; t.eq("invite budget shown", iv.per, per); t.eq("used 0", iv.used, 0); t.eq("may invite", iv.canInvite, true);
      const invitees = [];
      for (let k = 0; k < per; k++) { const gg = t.guest(g.id); const r = await gg.join({ from: seat, cat: "friends" }); t.expect(`invitee ${k + 1}`, r, "ok"); invitees.push(gg); }
      const over = await t.guest(g.id).join({ from: seat }); t.expect("one more than the limit", over, [409]); t.eq("code invite-full", over.body.code, "invite-full");
      t.eq("used equals the limit", (await l1.invites()).body.used, per);
      const pe = (await org.api("GET", `/api/z/${g.id}/participants`)).body.participants; t.eq("participants", pe.length, 1 + per);
      t.eq("invitees carry the inviter", pe.filter((p) => p.inv === seat).length, per); t.check("the category is kept when valid", pe.filter((p) => p.cat === "friends").length === per, JSON.stringify(pe.slice(0, 3)));
      // second level: an invitee's own link brings people who play but cannot bring more
      const l2 = invitees[0]; const l2me = (await l2.me()).body; const iv2 = (await l2.invites()).body; t.check("a guest invited by a guest has no invite link", iv2.canInvite === false || iv2.on === false || l2me.canInvite === false, JSON.stringify([iv2, l2me]));
      const l3 = t.guest(g.id); const r3 = await l3.join({ from: l2me.seat }); t.expect("someone arriving through a level-2 link still plays", r3, "ok");
      const pe2 = (await org.api("GET", `/api/z/${g.id}/participants`)).body.participants; const l3row = pe2.find((p) => p.pid === l3.pid); t.check("but no third level is recorded", l3row && (l3row.inv === null || l3row.inv === undefined), JSON.stringify(l3row));
    } });
  }
  out.push({ name: "invites|switched off: a guest link brings nobody under it, joining still works", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", cap: 20 }); const l1 = t.guest(g.id); await l1.join(); const seat = (await l1.me()).body.seat; const r = await t.guest(g.id).join({ from: seat });
    t.expect("joins", r, "ok"); const pe = (await org.api("GET", `/api/z/${g.id}/participants`)).body.participants; t.check("no inviter recorded", pe.every((p) => p.inv === null || p.inv === undefined), JSON.stringify(pe));
  } });
  out.push({ name: "invites|an unknown category is not recorded", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", inv: 4 }); const l1 = t.guest(g.id); await l1.join(); const seat = (await l1.me()).body.seat; const gg = t.guest(g.id);
    t.expect("join with a made-up category", await gg.join({ from: seat, cat: "<script>x</script>" }), "ok"); const pe = (await org.api("GET", `/api/z/${g.id}/participants`)).body.participants;
    t.check("category not stored", pe.every((p) => !p.cat), JSON.stringify(pe));
  } });
  out.push({ name: "invites|Organizer, Host and Co-host links bring any number (12 each, past the guest maximum of 10)", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", cap: 100, inv: 2 }); const host = await t.host(org), co = await t.cohost(org, g.id);
    const links = { org: (await org.people(g.id)).body.commonLink, host: (await host.api("GET", `/api/z/${g.id}/people`)).body.commonLink, co: (await co.api("GET", `/api/z/${g.id}/people`)).body.commonLink };
    for (const [who, link] of Object.entries(links)) { let ok = 0; for (let i = 0; i < 12; i++) if ((await t.guest(g.id).join({ from: fromOf(link) })).ok) ok++; t.eq(`${who} link brought 12`, ok, 12); }
    const ch = await co.api("GET", `/api/z/${g.id}/cohost`); t.eq("Co-host's brought count", ch.body.brought, 12);
  } });
  out.push({ name: "invites|a Co-host's link counts even when guest invites are off", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", cap: 30 }); const co = await t.cohost(org, g.id); const link = (await co.api("GET", `/api/z/${g.id}/people`)).body.commonLink;
    for (let i = 0; i < 3; i++) t.expect("join through the Co-host", await t.guest(g.id).join({ from: fromOf(link) }), "ok"); t.eq("brought", (await co.api("GET", `/api/z/${g.id}/cohost`)).body.brought, 3);
  } });
  out.push({ name: "invites|a retired Co-host's link stops bringing people", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 30 }); const co = await t.cohost(org, g.id); const link = (await co.api("GET", `/api/z/${g.id}/people`)).body.commonLink;
    t.expect("retire", await org.retire(co.id), "ok"); const r = await joinRaw(g.id, { phone: mobile(t.R), name: "Late Comer", from: fromOf(link) }, t.ip());
    t.check("the retired link no longer admits", r.status !== 200, `HTTP ${r.status}`); t.expect("the retired key is dead", await co.api("GET", "/api/whoami"), "deny");
  } });

  // ---------- phone numbers in every format ----------
  const GOOD = [["plain 10 digits", "9876543210", "919876543210"], ["+91 with spaces", "+91 98765 43210", "919876543210"], ["+91 glued", "+919876543210", "919876543210"], ["leading 0", "098765 43210", "919876543210"], ["0091", "0091 9876543210", "919876543210"], ["dashes", "98765-43210", "919876543210"],
    ["dots", "98765.43210", "919876543210"], ["slash", "98765/43210", "919876543210"], ["brackets", "(98765) 43210", "919876543210"], ["tabs and double spaces", " 98765  43210 ", "919876543210"], ["starts with 6", "6234567890", "916234567890"], ["starts with 7", "7234567890", "917234567890"], ["starts with 8", "8234567890", "918234567890"],
    ["UAE number", "+971 50 123 4567", "971501234567"], ["UK number", "+44 7911 123456", "447911123456"], ["Singapore number", "+65 9123 4567", "6591234567"], ["Australia number", "+61 412 345 678", "61412345678"]];
  const BAD = [["9 digits", "987654321"], ["starts with 5", "5876543210"], ["starts with 1", "1234567890"], ["letters inside", "98765abc10"], ["too long", "98765432101234567"], ["empty", ""], ["only spaces", "    "], ["an emoji inside", "98765\u{1F600}43210"], ["+91 then 5", "+91 5876543210"], ["5 digits", "12345"], ["SQL text", "9876543210'; DROP TABLE person;--"], ["HTML text", "<b>9876543210</b>"], ["a very long text", "9".repeat(5000)]];
  for (const [label, raw, e164] of GOOD) out.push({ name: `phone|accepted: ${label}`, run: async (t) => {
    const { org, g } = await openGame(t, { who: "list" }); const name = personName(t.R);
    const a = await org.api("POST", `/api/z/${g.id}/people`, { people: [{ name, phone: raw }] }); t.expect("add", a, "ok"); t.eq("added 1", a.body.added, 1); t.eq("masked shows the last four digits", a.body.people?.[0]?.maskedPhone?.slice(-4), e164.slice(-4));
    const wa = a.body.people?.[0]?.waLink ?? ""; t.check("the WhatsApp link carries the cleaned number", wa.startsWith(`https://wa.me/${e164}`), wa.slice(0, 60));
    const dup = await org.api("POST", `/api/z/${g.id}/people`, { people: [{ name: "Again", phone: raw }] }); t.eq("adding it again is a duplicate", dup.body.duplicates, 1);
    if (e164.startsWith("91") && e164.length === 12) { const plain = e164.slice(2); const dup2 = await org.api("POST", `/api/z/${g.id}/people`, { people: [{ name: "Again", phone: plain }] }); t.eq("the plain 10-digit form is the same person", dup2.body.duplicates, 1); }
    const r = await joinRaw(g.id, { phone: raw, name }, t.ip()); t.expect("the same person joins with the number typed this way", r, "ok");
  } });
  for (const [label, raw] of BAD) out.push({ name: `phone|refused: ${label}`, run: async (t) => {
    const { org, g } = await openGame(t, { who: "list" }); const a = await org.api("POST", `/api/z/${g.id}/people`, { people: [{ name: "Test Person", phone: raw }] });
    t.check("not added, said plainly", a.status < 500 && (a.body.added ?? 0) === 0 && ((a.body.invalid ?? []).length === 1 || a.status === 400), `HTTP ${a.status} ${JSON.stringify(a.body).slice(0, 200)}`);
    if ((a.body.invalid ?? []).length) t.check("the reason is a plain sentence", /number|mobile|digit|short|long|letter/i.test(a.body.invalid[0].why ?? ""), JSON.stringify(a.body.invalid));
    const pe = (await org.people(g.id)).body; t.eq("the list is still empty", pe.total ?? (pe.people ?? []).length, 0);
    if (raw.trim()) { const j = await joinRaw(g.id, { phone: raw, name: "Test Person" }, t.ip()); t.check("joining with it is refused calmly", j.status >= 400 && j.status < 500, `HTTP ${j.status}`); }
  } });
  out.push({ name: "phone|a mixed batch: 3 good, 2 duplicates, 3 wrong, summary and reasons", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list" }); const m1 = mobile(t.R), m2 = mobile(t.R), m3 = mobile(t.R);
    const a = await org.api("POST", `/api/z/${g.id}/people`, { people: [{ name: "A", phone: m1 }, { name: "B", phone: fmtMobile(m1, "plus91") }, { name: "C", phone: m2 }, { name: "D", phone: fmtMobile(m2, "zero") }, { name: "E", phone: m3 }, { name: "F", phone: "123" }, { name: "G", phone: "abc" }, { name: "H", phone: "" }] });
    t.expect("batch", a, "ok"); t.eq("added", a.body.added, 3); t.eq("duplicates", a.body.duplicates, 2); t.eq("invalid", a.body.invalid.length, 3);
  } });

  // ---------- first wins, limits ----------
  out.push({ name: "list|first wins: Organizer, then Host, then Co-host add the same number", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list" }); const host = await t.host(org), co = await t.cohost(org, g.id); const phone = mobile(t.R); const body = { people: [{ name: "Priya Nair", phone }] };
    t.eq("Organizer adds", (await org.api("POST", `/api/z/${g.id}/people`, body)).body.added, 1);
    t.eq("Host adds the same", (await host.api("POST", `/api/z/${g.id}/people`, body)).body.duplicates, 1); const c = await co.api("POST", `/api/z/${g.id}/people`, body); t.eq("Co-host adds the same", c.body.duplicates, 1);
    t.check("a Co-host is not told who invited the person first", !/Organizer/.test(JSON.stringify(c.body)), JSON.stringify(c.body).slice(0, 200));
    t.eq("Organizer's list has one", (await org.people(g.id)).body.total, 1); t.eq("Co-host's list is empty", (await co.api("GET", `/api/z/${g.id}/people`)).body.used, 0);
  } });
  out.push({ name: "list|a Co-host sees only their own people, the Organizer sees everyone and who invited", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list" }); const host = await t.host(org), c1 = await t.cohost(org, g.id), c2 = await t.cohost(org, g.id);
    await c1.api("POST", `/api/z/${g.id}/people`, { people: [{ name: "One", phone: mobile(t.R) }] }); await c2.api("POST", `/api/z/${g.id}/people`, { people: [{ name: "Two", phone: mobile(t.R) }, { name: "Three", phone: mobile(t.R) }] }); await host.api("POST", `/api/z/${g.id}/people`, { people: [{ name: "Four", phone: mobile(t.R) }] });
    t.eq("Co-host 1 sees 1", (await c1.api("GET", `/api/z/${g.id}/people`)).body.people.length, 1); t.eq("Co-host 2 sees 2", (await c2.api("GET", `/api/z/${g.id}/people`)).body.people.length, 2);
    const all = (await org.api("GET", `/api/z/${g.id}/people?all=1`)).body; const lists = (await org.people(g.id)).body; t.check("Organizer sees all four with inviters", (lists.people ?? []).length === 4 && lists.people.every((p) => p.inviter), JSON.stringify(lists.people).slice(0, 300));
    t.eq("Host sees all four", (await host.api("GET", `/api/z/${g.id}/people`)).body.people.length, 4);
    const ex = await c1.api("GET", `/api/z/${g.id}/people/export`); t.expect("a Co-host cannot download the list", ex, "deny");
  } });
  out.push({ name: "list|Co-host limit 10 (the lowest allowed): 10 are added, a batch that does not fit adds nothing", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 100 }); t.expect("set the limit to 10", await org.settings(g.id, { coHostLimit: 10 }), "ok"); const co = await t.cohost(org, g.id);
    const many = (n) => ({ people: Array.from({ length: n }, () => ({ name: personName(t.R), phone: mobile(t.R) })) });
    t.eq("10 fit", (await co.api("POST", `/api/z/${g.id}/people`, many(10))).body.added, 10); const over = await co.api("POST", `/api/z/${g.id}/people`, many(1)); t.expect("the 11th", over, [409]); t.eq("code over-limit", over.body.code, "over-limit");
    const co2 = await t.cohost(org, g.id); const r = await co2.api("POST", `/api/z/${g.id}/people`, many(12)); t.expect("12 into a limit of 10", r, [409]); t.eq("nothing added", (await co2.api("GET", `/api/z/${g.id}/people`)).body.used, 0);
    t.check("Organizer and Host have no limit", (await org.api("POST", `/api/z/${g.id}/people`, many(30))).body.added === 30);
  } });
  out.push({ name: "list|a level-1 guest's own list stops at their personal limit", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", inv: 2, cap: 50 }); const l1 = t.guest(g.id); await l1.join(); const seat = (await l1.me()).body.seat;
    const add = (n) => A.call("POST", `/api/z/${g.id}/people`, { me: l1.pid, people: Array.from({ length: n }, () => ({ name: personName(t.R), phone: mobile(t.R) })) }, { "x-cb-pid": l1.pid });
    const a = await add(2); t.expect("two fit", a, "ok"); t.eq("added", a.body.added, 2); const b = await add(1); t.expect("third is over their limit", b, [409]); t.eq("code", b.body.code, "over-limit");
    t.expect("a guest cannot download anyone's list", await A.call("GET", `/api/z/${g.id}/people/export`, undefined, { "x-cb-pid": l1.pid }), "deny");
  } });
  out.push({ name: "list|200 people in one request are accepted, 201 are refused whole", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 250 }); const mk = (n) => ({ people: Array.from({ length: n }, (_, i) => ({ name: `${L.FIRST[i % L.FIRST.length]} ${L.LAST[(i * 7) % L.LAST.length]}`, phone: String(9000000000 + t.R.int(99999999) + i * 100000000 % 900000000) })) });
    const big = mk(200); const seen = new Set(); big.people = big.people.filter((p) => !seen.has(p.phone) && seen.add(p.phone));
    const a = await org.api("POST", `/api/z/${g.id}/people`, big); t.expect("200", a, "ok"); t.eq("added all distinct", a.body.added, big.people.length);
    const b = await org.api("POST", `/api/z/${g.id}/people`, { people: Array.from({ length: 201 }, (_, i) => ({ name: "X", phone: String(8000000000 + i) })) }); t.expect("201", b, [413]);
    t.check("the 201 batch changed nothing", (await org.people(g.id)).body.total === big.people.length);
  } });
  out.push({ name: "list|more people than the game size are refused whole", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 5 }); const mk = (n) => ({ people: Array.from({ length: n }, () => ({ name: personName(t.R), phone: mobile(t.R) })) });
    const r = await org.api("POST", `/api/z/${g.id}/people`, mk(6)); t.expect("6 into a game of 5", r, [409]); t.eq("code over-cap", r.body.code, "over-cap"); t.eq("nothing added", (await org.people(g.id)).body.total, 0); t.eq("5 fit", (await org.api("POST", `/api/z/${g.id}/people`, mk(5))).body.added, 5);
  } });
  out.push({ name: "list|the CSV download neutralises spreadsheet formulas and is for Organizer and Host only", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list" }); await org.addPeople(g.id, [{ name: "=HYPERLINK(\"http://evil.example\",\"x\")", phone: mobile(t.R) }, { name: "+cmd|' /C calc'!A0", phone: mobile(t.R) }, { name: "@SUM(1+1)", phone: mobile(t.R) }, { name: "-2+3", phone: mobile(t.R) }]);
    const r = await fetch(`${SIM}/api/z/${g.id}/people/export`, { headers: org.h }); const txt = await r.text(); t.eq("served", r.status, 200);
    const rows = txt.split("\n").slice(1).filter(Boolean); t.check("no cell starts with = + - or @", rows.every((l) => !/^[=+\-@]/.test(l.split(",")[0].replace(/^"/, ""))), rows.map((l) => l.split(",")[0]).join(" | "));
    const host = await t.host(org); t.expect("Host may download", await host.api("GET", `/api/z/${g.id}/people/export`), "ok"); t.expect("AI key may not", await A.call("GET", `/api/z/${g.id}/people/export`, undefined, { "x-organizer": org.aiKey }), "deny");
  } });

  // ---------- waiting room ----------
  out.push({ name: "waiting|five strangers wait, they use no places, the Organizer admits one, declines one, approves the rest", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 3 }); const gs = [];
    for (let i = 0; i < 5; i++) { const gg = t.guest(g.id); const r = await gg.join(); t.eq(`stranger ${i + 1} waits`, outcome(r), "waiting"); gg.wid = r.body.wid; gs.push(gg); }
    const w = (await org.waiting(g.id)).body.waiting; t.eq("five waiting", w.length, 5); t.eq("no place used", (await org.api("GET", `/api/z/${g.id}/participants`)).body.total, 0);
    t.eq("admit one", (await org.decide(g.id, gs[0].wid, "admit")).body.admitted, true); t.eq("decline one", (await org.decide(g.id, gs[1].wid, "decline")).body.declined, true);
    const me1 = await A.call("GET", `/api/z/${g.id}/me?wid=${gs[1].wid}`); t.eq("the declined person is told", me1.body.state, "declined"); const me0 = await A.call("GET", `/api/z/${g.id}/me?wid=${gs[0].wid}`); t.eq("the admitted person is told", me0.body.state, "admitted");
    const re = await gs[0].join(); t.expect("the admitted person opens the game", re, "ok");
    const all = await org.api("POST", `/api/z/${g.id}/waiting/all`, { decision: "admit" }); t.expect("approve all", all, "ok"); t.eq("two more fit (game of 3)", all.body.admitted, 2); t.eq("the rest keep waiting calmly", all.body.stillWaiting, 1); t.check("with a calm message", !!all.body.message, JSON.stringify(all.body));
    const pe = (await org.people(g.id)).body.people; t.check("who approved is recorded", pe.filter((p) => p.approvedBy).length >= 3, JSON.stringify(pe.map((p) => [p.name, p.approvedBy])));
    t.expect("a full game cannot admit more", await org.decide(g.id, gs[4].wid, "admit"), [409]);
  } });
  out.push({ name: "waiting|a Co-host decides only for people who came through their own link", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 20 }); const c1 = await t.cohost(org, g.id), c2 = await t.cohost(org, g.id); const l1 = (await c1.api("GET", `/api/z/${g.id}/people`)).body.commonLink, l2 = (await c2.api("GET", `/api/z/${g.id}/people`)).body.commonLink;
    const a = t.guest(g.id), b = t.guest(g.id); const ra = await a.join({ from: fromOf(l1) }), rb = await b.join({ from: fromOf(l2) });
    t.eq("each waits", [outcome(ra), outcome(rb)], ["waiting", "waiting"]); t.eq("Co-host 1 sees one", (await c1.api("GET", `/api/z/${g.id}/waiting`)).body.waiting.length, 1);
    t.expect("Co-host 1 cannot decide for Co-host 2's guest", await c1.api("POST", `/api/z/${g.id}/waiting/${rb.body.wid}`, { decision: "admit" }), [404]); t.expect("Co-host 1 admits their own", await c1.api("POST", `/api/z/${g.id}/waiting/${ra.body.wid}`, { decision: "admit" }), "ok");
    t.eq("the Organizer still sees the other", (await org.waiting(g.id)).body.waiting.length, 1);
    const hist = (await org.people(g.id)).body.people; t.check("approval is attributed", hist.some((p) => p.approvedBy), JSON.stringify(hist.map((p) => p.approvedBy)));
  } });
  out.push({ name: "waiting|the same stranger asking ten times is one request", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 20 }); const gg = t.guest(g.id); for (let i = 0; i < 10; i++) await gg.join(); t.eq("one request", (await org.waiting(g.id)).body.waiting.length, 1);
  } });
  out.push({ name: "waiting|over the inviter's limit goes to the Organizer's waiting room, not a hard refusal", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", inv: 1, cap: 50 }); const l1 = t.guest(g.id); await l1.join(); const seat = (await l1.me()).body.seat; t.expect("first invitee", await t.guest(g.id).join({ from: seat }), "ok");
    const r = await t.guest(g.id).join({ from: seat }); t.expect("second invitee", r, [409]); t.check("told they are waiting", r.body.waiting === true && !!r.body.wid, JSON.stringify(r.body)); const w = (await org.waiting(g.id)).body.waiting; t.check("Organizer sees it as over the limit", w.some((x) => x.overLimit), JSON.stringify(w));
  } });

  // ---------- removal ----------
  out.push({ name: "remove|before the game: the place is freed, the number is blocked, and can be put back by the Organizer", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", cap: 2 }); const a = t.guest(g.id), b = t.guest(g.id); await a.join(); await b.join(); const x = t.guest(g.id); t.expect("blackout", await x.join(), [409]);
    const rows = (await org.people(g.id)).body.people; const row = rows.find((p) => p.status === "joined") ?? rows[0]; t.check("people list shows joined guests", !!row, JSON.stringify(rows));
    if (!row) return; const rm = await org.api("POST", `/api/z/${g.id}/people/${row.id}/remove`, {}); t.expect("remove", rm, "ok"); t.expect("a new person takes the place", await x.join(), "ok");
    const again = await joinRaw(g.id, { phone: a.phone, name: a.name }, a.ip); const again2 = await joinRaw(g.id, { phone: b.phone, name: b.name }, b.ip); t.check("the removed number cannot come back", [again, again2].some((r) => r.status === 403 && r.body.code === "removed"), JSON.stringify([again.body.code, again2.body.code]));
  } });
  out.push({ name: "remove|with everyone they invited", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", inv: 3, cap: 20 }); const l1 = t.guest(g.id); await l1.join(); const seat = (await l1.me()).body.seat; for (let i = 0; i < 3; i++) await t.guest(g.id).join({ from: seat });
    const rows = (await org.people(g.id)).body.people; const top = rows.find((p) => p.status === "joined" && !p.inviter?.startsWith?.("Guest")) ?? rows[0];
    const rm = await org.api("POST", `/api/z/${g.id}/people/${rows.find((p) => p.name === l1.name)?.id ?? top.id}/remove`, { withTheirPeople: true }); t.expect("remove with their people", rm, "ok");
    const left = (await org.api("GET", `/api/z/${g.id}/participants`)).body.total; t.check("the whole branch is gone", left <= 0 || left === 0, `${left} left`);
  } });
  out.push({ name: "remove|a Co-host removes only their own people", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 20 }); const c1 = await t.cohost(org, g.id), c2 = await t.cohost(org, g.id);
    const a = await c1.api("POST", `/api/z/${g.id}/people`, { people: [{ name: "Own Person", phone: mobile(t.R) }] }), b = await c2.api("POST", `/api/z/${g.id}/people`, { people: [{ name: "Other Person", phone: mobile(t.R) }] });
    t.expect("remove someone else's", await c1.api("POST", `/api/z/${g.id}/people/${b.body.people[0].id}/remove`, {}), "refuse"); t.expect("remove their own", await c1.api("POST", `/api/z/${g.id}/people/${a.body.people[0].id}/remove`, {}), "ok");
    t.eq("the other Co-host's list is untouched", (await c2.api("GET", `/api/z/${g.id}/people`)).body.people.length, 1);
  } });
  out.push({ name: "remove|the Host's removal e-mails the Organizer without names", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 20 }); const host = await t.host(org); const a = await org.addPeople(g.id, [{ name: "Zxqvbn Quuxford", phone: mobile(t.R) }]); await A.mailbox.clear();
    t.expect("Host removes", await host.api("POST", `/api/z/${g.id}/people/${a.people[0].id}/remove`, {}), "ok"); const m = await A.mailbox.list({ to: org.email }); t.check("Organizer is told", m.length >= 1, `${m.length} mails`); t.check("no guest name in the mail", m.every((x) => !/Zxqvbn|Quuxford/.test(x.text)), m.map((x) => x.text.slice(0, 120)).join("|"));
  } });

  // ---------- privacy ----------
  out.push({ name: "privacy|names and numbers are never stored in plain text anywhere", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 20 }); const name = "Zxqvbn Quuxford", phone = "9" + String(t.R.int(1e9)).padStart(9, "0"); const extra = `sim+leak${t.R.int(1e6)}@evil.example`;
    await org.addPeople(g.id, [{ name, phone }, { name: "Second Quuxford", phone: mobile(t.R), email: extra }]); await joinRaw(g.id, { phone, name, email: extra }, t.ip()); const co = await t.cohost(org, g.id, "Dev Kapoor");
    const tables = (await A.sql("SELECT name FROM sqlite_master WHERE type='table'")).map((r) => r.name); const hits = [];
    for (const tb of tables) { if (/^(sqlite_|usage)/.test(tb)) continue; const rows = await A.sql(`SELECT * FROM "${tb}" LIMIT 4000`).catch(() => []); for (const r of rows) { const s = JSON.stringify(r); if (s.includes("Quuxford") || s.includes(phone) || s.includes(extra)) { hits.push(tb); break; } } }
    t.check("no table holds the plain names, number or e-mail", hits.length === 0, "found in: " + hits.join(", "));
    const co2 = await t.cohost(org, g.id, "Dev Kapoor"); const cphone = co2.raw.phoneMasked; t.check("the Co-host's number is masked in the answer", /^\*+\d{4}$/.test(cphone ?? ""), cphone);
  } });
  out.push({ name: "privacy|an e-mail address typed by a guest is never mailed", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", cap: 20 }); const em = `sim+guest${t.R.int(1e6)}@example.com`; await A.mailbox.clear();
    await joinRaw(g.id, { phone: mobile(t.R), name: personName(t.R), email: em, mail: em, contact: em }, t.ip()); await org.addPeople(g.id, [{ name: "Extra Person", phone: mobile(t.R), email: em }]);
    await org.api("POST", "/api/org/cohost", { label: "Cohost", phone: mobile(t.R), email: em, e: g.id }); const mails = await A.mailbox.list({ to: em }); t.eq("nothing mailed to it", mails.length, 0);
  } });
  out.push({ name: "privacy|participants list, summary and results carry no names or numbers", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", cap: 20 }); const phone = mobile(t.R), name = "Zxqvbn Quuxford"; await joinRaw(g.id, { phone, name }, t.ip());
    for (const p of [`/api/z/${g.id}/participants`, `/api/z/${g.id}/summary`, `/api/z/${g.id}/results`, `/api/z/${g.id}/seats`, `/api/z/${g.id}/info`]) { const r = await A.call("GET", p, undefined, org.h); t.check(`${p.split("/").pop()} has no name or number`, !JSON.stringify(r.body).includes("Quuxford") && !JSON.stringify(r.body).includes(phone), p); }
    const ai = await A.call("GET", `/api/z/${g.id}/participants`, undefined, { "x-organizer": org.aiKey }); t.check("AI view has none either", !JSON.stringify(ai.body).includes(phone));
  } });

  // ---------- join validation ----------
  const dev = (s) => deviceOf(s);
  for (const [label, body, want] of [["no phone and no token", { name: "A B", device: dev("a1") }, "refuse"], ["no device", { phone: "9876501111", name: "A B", device: undefined, __nodev: true }, "refuse"], ["device too short", { phone: "9876501112", name: "A B", device: "abc" }, "refuse"], ["device not hex", { phone: "9876501113", name: "A B", device: "z".repeat(32) }, "refuse"], ["device too long", { phone: "9876501114", name: "A B", device: "a".repeat(80) }, "refuse"],
    ["name 2000 characters", { phone: "9876501115", name: "N".repeat(2000), device: dev("a2") }, "any"], ["name with markup", { phone: "9876501116", name: "<img src=x onerror=alert(1)>", device: dev("a3") }, "any"], ["name is a number", { phone: "9876501117", name: 12345, device: dev("a4") }, "any"], ["name missing", { phone: "9876501118", device: dev("a5") }, "any"], ["phone as a number", { phone: 9876501119, name: "A B", device: dev("a6") }, "any"], ["body is a list", [1, 2], "refuse"], ["a name in Devanagari", { phone: "9876501120", name: "आरव शर्मा", device: dev("a7") }, "ok"], ["a name with an apostrophe", { phone: "9876501121", name: "D'Souza", device: dev("a8") }, "ok"]])
    out.push({ name: `joinvalid|${label}`, run: async (t) => {
      const { org, g } = await openGame(t, { who: "anyone", cap: 20 }); const b = Array.isArray(body) ? body : { ...body }; if (b.__nodev) { delete b.__nodev; delete b.device; }
      const r = await A.call("POST", `/api/z/${g.id}/join`, b, {}, { ip: t.ip() }); t.expect("answer", r, want === "ok" ? "ok" : want === "any" ? "any" : "refuse");
      if (r.ok) { const nm = await A.call("GET", `/api/z/${g.id}/names?pids=${r.body.pid}`, undefined, org.h); const stored = JSON.stringify(nm.body); t.check("a name with markup cannot run in the console", !/<img|<script/i.test(stored) || /&lt;|\\u003c/.test(stored) || nm.status !== 200, stored.slice(0, 160)); }
    } });
  out.push({ name: "joinvalid|the same phone on two devices and two phones on one device", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", cap: 20 }); const phone = mobile(t.R); const a = await joinRaw(g.id, { phone, name: "A B", device: dev("d-one") }, t.ip()); t.expect("first", a, "ok");
    const b = await joinRaw(g.id, { phone, name: "A B", device: dev("d-two") }, t.ip()); t.expect("same number, another device", b, [423]); t.eq("code other-phone", b.body.code, "other-phone");
    const c = await joinRaw(g.id, { phone: mobile(t.R), name: "C D", device: dev("d-one") }, t.ip()); t.expect("another number on the same device", c, [409]); t.eq("code device-used", c.body.code, "device-used");
    t.eq("one ticket", (await org.api("GET", `/api/z/${g.id}/participants`)).body.total, 1);
    const un = await org.api("POST", `/api/z/${g.id}/unbind`, { phone }); t.expect("Organizer lets the person change phone", un, "ok"); t.expect("now the new device works", await joinRaw(g.id, { phone, name: "A B", device: dev("d-two") }, t.ip()), "ok");
  } });
  out.push({ name: "joinvalid|the same number typed in two formats is one person with one ticket", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", cap: 20 }); const m = mobile(t.R); const a = await joinRaw(g.id, { phone: m, name: "A", device: dev("fmt1") }, t.ip()); const b = await joinRaw(g.id, { phone: "+91 " + m.slice(0, 5) + " " + m.slice(5), name: "A", device: dev("fmt1") }, t.ip());
    t.expect("first", a, "ok"); t.expect("second", b, "ok"); t.eq("same ticket", b.body.pid, a.body.pid); t.eq("one participant", (await org.api("GET", `/api/z/${g.id}/participants`)).body.total, 1);
  } });

  // ---------- crowds and caps ----------
  for (const n of [1, 2, 50]) out.push({ name: `crowd|${n} ${n === 1 ? "player" : "players"} in a game of exactly that size, one more is refused`, run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", cap: n }); const seats = [];
    for (let i = 0; i < n; i++) { const gg = t.guest(g.id); const r = await gg.join(); if (!t.expect(`player ${i + 1}`, r, "ok")) break; seats.push((await gg.me()).body.seat); }
    t.eq("seats are 1..n in order", seats, Array.from({ length: seats.length }, (_, i) => i + 1)); t.expect("the next person", await t.guest(g.id).join(), [409]);
    const sum = (await org.summary(g.id)).body; t.eq("head-count", sum.participants, n); t.check("one ticket per phone, no device on two seats", (await A.sql("SELECT COUNT(*) c FROM (SELECT phone_hash FROM participant WHERE eid=? GROUP BY phone_hash HAVING COUNT(*)>1)", [g.id]))[0].c === 0 && (await A.sql("SELECT COUNT(*) c FROM (SELECT dev FROM seat WHERE eid=? AND dev IS NOT NULL AND dev<>'' GROUP BY dev HAVING COUNT(*)>1)", [g.id]))[0].c === 0);
  } });
  out.push({ name: "crowd|many joins from ONE address end calmly (a busy answer, never a crash), other addresses are unaffected", run: async (t) => {
    const { org, g } = await openGame(t, { who: "anyone", cap: 200 }); const ip = t.ip(); let ok = 0, busy = 0, other = 0, last;
    for (let i = 0; i < 40; i++) { const r = await joinRaw(g.id, { phone: mobile(t.R), name: personName(t.R) }, ip); last = r; if (r.ok) ok++; else if (r.status === 429 || r.status === 503) busy++; else other++; }
    t.check("no unexpected answers", other === 0, `${ok} joined, ${busy} busy, ${other} other (last ${last.status} ${JSON.stringify(last.body).slice(0, 100)})`); if (busy) t.check("the busy answer is a plain sentence", !!last.body.error);
    t.expect("a different address still joins", await joinRaw(g.id, { phone: mobile(t.R), name: personName(t.R) }, t.ip()), "ok");
  } });

  // ---------- the /j/ page ----------
  out.push({ name: "linkpage|personal link page: Open Graph for WhatsApp, noindex, markup in a name cannot run", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 20 }); const a = await org.addPeople(g.id, [{ name: "\"><script>alert(1)</script>Ravi", phone: mobile(t.R) }]); const tok = A.tokenOfLink(a.people[0].link);
    const r = await fetch(`${SIM}/j/${tok}`); const html = await r.text(); t.eq("served", r.status, 200); t.check("Open Graph title present", /property="og:title"/.test(html)); t.check("noindex", /name="robots" content="noindex"/.test(html));
    t.check("no raw script from the name", !/<script>alert/i.test(html), html.slice(0, 200)); t.check("moves on to the game with the token", html.includes(`t=${tok}`));
    const bad = await fetch(`${SIM}/j/nosuchtoken1`); t.check("an unknown link is a calm page, not an error", bad.status === 404 && /<html/i.test(await bad.text()));
    await org.cancel(g.id); const gone = await fetch(`${SIM}/j/${tok}`); t.check("a cancelled game's link is a calm 404", gone.status === 404);
  } });
  out.push({ name: "linkpage|\"Send again\" gives a new link, kills the old one and unlocks the ticket for a new phone", run: async (t) => {
    const { org, g } = await openGame(t, { who: "list", cap: 20 }); const phone = mobile(t.R); const a = await org.addPeople(g.id, [{ name: "Anil Kapoor", phone }]); const tok = A.tokenOfLink(a.people[0].link);
    t.expect("first phone", await joinRaw(g.id, { token: tok, phone, name: "Anil", device: dev("p1") }, t.ip()), "ok"); const rs = await org.api("POST", `/api/z/${g.id}/people/${a.people[0].id}/resend`, {}); t.expect("send again", rs, "ok"); t.check("a different link", rs.body.link && A.tokenOfLink(rs.body.link) !== tok);
    t.check("the old link is dead", (await fetch(`${SIM}/j/${tok}`)).status === 404); t.expect("the new link works on a new phone", await joinRaw(g.id, { token: A.tokenOfLink(rs.body.link), phone, name: "Anil", device: dev("p2") }, t.ip()), "ok");
  } });
  return out;
}
