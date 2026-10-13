// Family "roles": every role against every action, one named scenario per cell. The expected answers come from the owner's role matrix:
// docs/dev/05-ROLES-AND-PERMISSIONS.md section 3 (built from docs/ROLES_AND_CONSOLE_SPEC*.md and docs/Corporate_Bingo_Roles_and_Rules.xlsx).
// Y = allowed (the request is authorised: 2xx, or for "soft" actions a plain business refusal), N = refused with 401/403/404, null = the spec does not say: only "no 5xx, friendly words" is checked.
// Every cell gets its own organization, game, Host, Co-host, AI key and outsider, so a destructive action in one cell cannot disturb another.
// Extra invariants for every REFUSED cell: it had no side effect (the game status, settings, head-count, team and credit are exactly as before).
export default async function gen({ R, L }) {
  const { A, mobile, personName, PLATFORM_KEY } = L;
  const out = [];
  const ROLES = ["M", "H", "HL", "C", "CX", "AI", "OUT", "OTHER", "PLAT"];
  const ROLE_NAME = { M: "Organizer", H: "Host console", HL: "Host via AI work link", C: "Co-host of the game", CX: "Co-host of another game", AI: "AI key", OUT: "outsider without a key", OTHER: "Organizer of another account", PLAT: "platform owner" };
  // [M, H, HL, C, CX, AI, OUT, OTHER, PLAT]
  const E = (s) => Object.fromEntries(ROLES.map((r, i) => [r, s[i] === "Y" ? true : s[i] === "N" ? false : null]));
  const later = (w) => w.startRound + 3000; // about 2.5 hours later
  const ACTIONS = [
    { id: "whoami", state: "draft", exp: E("YYYYYYNYn"), build: () => ({ m: "GET", p: "/api/whoami" }) },
    { id: "create a game", state: "draft", exp: E("YNNNNYNYY"), build: (w) => ({ m: "POST", p: "/api/z", b: { id: w.t.gid("NEW"), startRound: w.startRound, callSeconds: 9, cap: 30 } }), verify: (w, role, r, t) => { if (r.ok && role !== "OTHER") t.check("created game exists for the account", !!r.body.openUrl, JSON.stringify(r.body)); } },
    { id: "change the game name", state: "draft", exp: E("YYNNNYNNY"), build: (w) => ({ m: "PATCH", p: `/api/z/${w.eid}/settings`, b: { name: "Renamed by " + w.t.R.int(1000) } }) },
    { id: "switch guest invites on", state: "draft", exp: E("YYNNNYNNY"), build: (w) => ({ m: "PATCH", p: `/api/z/${w.eid}/settings`, b: { guestInvites: { on: true, per: 3, cats: ["family", "friends"] } } }) },
    { id: "reschedule", state: "paid", exp: E("YYNNNYNNY"), build: (w) => ({ m: "PATCH", p: `/api/z/${w.eid}/settings`, b: { startRound: later(w) } }) },
    { id: "publish", state: "draft", exp: E("YYNNNYNNY"), build: (w) => ({ m: "POST", p: `/api/z/${w.eid}/publish`, b: { email: w.org.email, phone: "9811122233" } }), verify: (w, role, r, t, after) => { if (role === "AI") { t.check("AI only hands over: needsOrganizer", r.body.needsOrganizer === true, JSON.stringify(r.body).slice(0, 160)); t.check("AI did not publish", after.status === "draft", after.status); } } },
    { id: "pay", state: "pub", exp: E("YYNYNNnNn"), build: (w) => ({ m: "POST", p: "/api/payments/test", b: { eid: w.eid, email: w.org.email, org: "Sharma Textiles", country: "IN" } }), verify: (w, role, r, t, after) => { if (r.ok && (role === "M" || role === "H" || role === "C")) t.eq("paid by", after.paidBy, role === "M" ? "organizer" : role === "H" ? "host" : "co-host"); } },
    { id: "make a pay link", state: "pub", exp: E("YYNYNNNNn"), build: (w) => ({ m: "POST", p: `/api/z/${w.eid}/paylink`, b: {} }) },
    { id: "cancel-preview", state: "paid", exp: E("YYNNNNNNY"), build: (w) => ({ m: "GET", p: `/api/z/${w.eid}/cancel-preview` }) },
    { id: "cancel the game (3 confirmations)", state: "paid", exp: E("YYNNNNNNY"), build: (w) => ({ m: "POST", p: `/api/z/${w.eid}/cancel`, b: { confirmations: 3 } }), verify: (w, role, r, t, after) => { if (r.ok) t.check("game is cancelled and the money is kept as credit", after.cancelled && after.credit > 0, JSON.stringify(after)); } },
    { id: "clone (create a new game like this one)", state: "paid", exp: E("YYNNNNNNY"), build: (w) => ({ m: "POST", p: `/api/z/${w.eid}/clone`, b: {} }) },
    { id: "read the summary", state: "paid", exp: E("YYYNNYNNY"), build: (w) => ({ m: "GET", p: `/api/z/${w.eid}/summary` }) },
    { id: "read the participants list", state: "paid", exp: E("YYYNNYNNY"), build: (w) => ({ m: "GET", p: `/api/z/${w.eid}/participants` }) },
    { id: "read the small game header", state: "paid", exp: E("YYNYNYNNY"), build: (w) => ({ m: "GET", p: `/api/z/${w.eid}/cohost` }) },
    { id: "list the team", state: "draft", exp: E("YYNNNYNYn"), build: () => ({ m: "GET", p: "/api/org/team" }) },
    { id: "add a Host", state: "draft", exp: E("YNNNNNNYn"), build: (w) => { const email = `sim+m${w.t.seed}n${w.t.R.int(1e6)}@example.com`; w.t.allow(email); return { m: "POST", p: "/api/org/host", b: { label: "Sunita", email, mobile: "9811100099" } }; } },
    { id: "add a Co-host", state: "draft", exp: E("YYNNNNNNn"), build: (w) => ({ m: "POST", p: "/api/org/cohost", b: { label: "Dev Kapoor", phone: "9822200011", e: w.eid } }) },
    { id: "retire a Co-host", state: "draft", exp: E("YYNNNNNNn"), build: (w) => ({ m: "POST", p: "/api/org/team/retire", b: { id: w.cohost.id } }) },
    { id: "retire a Host", state: "draft", exp: E("YNNNNNNNn"), build: (w) => ({ m: "POST", p: "/api/org/team/retire", b: { id: w.host.id } }) },
    { id: "read the account credit", state: "draft", exp: E("YYNNNNNYn"), build: () => ({ m: "GET", p: "/api/org/credit" }) },
    { id: "pay with credit", state: "pub", credit: true, exp: E("YYNYNNNNn"), build: (w) => ({ m: "POST", p: `/api/z/${w.eid}/pay-with-credit`, b: {} }), soft: false },
    { id: "add people to the list", state: "pub", exp: E("YYNYNNNNn"), build: (w) => ({ m: "POST", p: `/api/z/${w.eid}/people`, b: { people: [{ name: "Asha Rao", phone: "9876543210" }] } }) },
    { id: "see the waiting room", state: "pub", exp: E("YYNYNNNNn"), build: (w) => ({ m: "GET", p: `/api/z/${w.eid}/waiting` }) },
    { id: "announce to every phone", state: "paid", exp: E("YYYNNYNNY"), build: (w) => ({ m: "POST", p: `/api/z/${w.eid}/announce`, b: { text: "Tea and snacks at 6:45 pm" } }) },
    { id: "erase all guest data now", state: "paid", exp: E("YYNNNNNNY"), build: (w) => ({ m: "POST", p: `/api/z/${w.eid}/erase`, b: {} }), soft: true },
    { id: "replace the report link", state: "paid", exp: E("YYNNNNNNY"), build: (w) => ({ m: "POST", p: `/api/z/${w.eid}/reportlink`, b: {} }) },
    { id: "list sign-in keys", state: "draft", exp: E("YNNNNNNYn"), build: () => ({ m: "GET", p: "/api/org/keys" }) },
    { id: "read the AI link", state: "draft", exp: E("YNNNNNNYn"), build: () => ({ m: "GET", p: "/api/org/ai/link" }) },
    { id: "read the AI audit trail", state: "draft", exp: E("YNNNNYNYn"), build: () => ({ m: "GET", p: "/api/org/ai/audit" }) },
    { id: "close the account", state: "draft", exp: E("YNNNNNNYn"), build: () => ({ m: "POST", p: "/api/org/close", b: { confirm: true } }) },
  ];

  async function world(t, a) {
    const org = await t.newOrg(); const g = await t.game(org, { cap: 50, days: 4, name: "Annual day - Kaveri Foods" }); const g2 = await t.game(org, { cap: 50, days: 5 });
    const w = { t, org, eid: g.id, eid2: g2.id, startRound: g.startRound, hostTok: null };
    if (a.credit) { const gc = await t.game(org, { cap: 50, days: 3 }); await t.publishPay(org, gc.id); const cr = await org.cancel(gc.id); if (!cr.ok) throw new Error("credit setup failed " + JSON.stringify(cr.body)); }
    if (a.state === "pub") await org.publish(g.id, mobile(t.R)); if (a.state === "paid") await t.publishPay(org, g.id);
    w.host = await t.host(org, "Hema Iyer"); w.hostTok = w.host.key;
    w.cohost = await t.cohost(org, g.id); w.cohostX = await t.cohost(org, g2.id);
    w.other = await t.newOrg("x"); w.keyOf = { M: org.h, H: { "x-organizer": w.host.key }, C: w.cohost.h, CX: w.cohostX.h, AI: { "x-organizer": org.aiKey }, OUT: {}, OTHER: w.other.h, PLAT: { "x-organizer": PLATFORM_KEY } };
    return w;
  }
  const fingerprint = async (w) => { // what an unauthorised request must leave untouched
    const s = (await w.org.summary(w.eid)).body, tm = (await w.org.team()).body, cr = (await w.org.api("GET", "/api/org/credit")).body;
    return { status: s.status, name: s.name, rewards: JSON.stringify(s.rewards), invites: JSON.stringify(s.guestInvites), start: s.startRound, limit: s.limit, participants: s.participants, hosts: (tm.hosts ?? []).length, cohosts: (tm.cohosts ?? []).length, credit: cr.activeTotalInr, paid: s.payment?.status, cancelled: /cancel/.test(s.status ?? "") };
  };
  const after = async (w) => { const s = (await w.org.summary(w.eid)).body; const cr = (await w.org.api("GET", "/api/org/credit")).body; return { status: s.status === "published, payment due before the start" ? "published" : s.status === "draft" ? "draft" : s.status, paidBy: s.payment?.paidBy, cancelled: /cancel/.test(s.status ?? ""), credit: cr.activeTotalInr }; };

  for (const a of ACTIONS) for (const role of ROLES) {
    const want = a.exp[role];
    out.push({ name: `role|${ROLE_NAME[role]} x ${a.id}`, run: async (t) => {
      const w = await world(t, a); const req = a.build(w);
      const before = await fingerprint(w);
      let path = req.p, headers = w.keyOf[role] ?? {};
      if (role === "HL") { path = `/ai/${w.hostTok}/` + req.p.replace(/^\/api\//, ""); headers = {}; }
      const r = await A.call(req.m, path, req.b, headers);
      const s = r.status; const denied = s === 401 || s === 403 || s === 404;
      if (want === true) t.check(`${ROLE_NAME[role]} may ${a.id}`, a.soft ? !denied && s < 500 : s >= 200 && s < 300, `HTTP ${s} ${JSON.stringify(r.body).slice(0, 200)}`);
      else if (want === false) { t.check(`${ROLE_NAME[role]} may not ${a.id}`, s >= 400 && s < 500, `HTTP ${s} ${JSON.stringify(r.body).slice(0, 200)}`); }
      else t.check("answer is not a server error", s < 500, `HTTP ${s}`);
      if (role === "OTHER" && ["read the summary", "read the participants list", "change the game name", "cancel the game (3 confirmations)"].includes(a.id)) t.check("other account never sees this game", denied, `HTTP ${s}`);
      if (want === false || (want === null && s >= 400 && s < 500)) {
        const f2 = await fingerprint(w); t.check("refused request changed nothing", JSON.stringify(f2) === JSON.stringify(before), JSON.stringify(before) + " -> " + JSON.stringify(f2));
        if (denied && s !== 404) t.check("refusal tells the person who may do it", typeof r.body.error === "string" && r.body.error.length > 8, JSON.stringify(r.body).slice(0, 120));
      }
      if (a.verify && w.org) { let aft = {}; try { aft = await after(w); } catch { /* account closed */ } a.verify(w, role, r, t, aft); }
    } });
  }
  return out;
}
