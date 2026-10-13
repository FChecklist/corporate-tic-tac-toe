// Family "config": game options crossed with each other, and every invalid value of every option.
// Full cross: tickets x gap x rounds x who-can-join (2 x 4 x 5 x 2 = 80). All-pairs: tickets, gap, rounds, who, guest-invite level, occasion, size, start time (every pair of values appears).
// Each valid combination is created, edited, published, paid, read back and joined; each invalid value must be refused with a plain sentence and leave nothing behind.
export default async function gen({ seed, R, L }) {
  const { A, pairwise, cross, OCCASIONS, COMPANIES, TIMES, slug, packFor, totalFor, istLabel, mobile, personName, roundTimeMs, startAt, clock, DAY, MIN } = L;
  const out = [];
  const GAPS = [6, 9, 12, 15], CAPS = [1, 2, 50, 100, 101, 250, 251, 500, 750, 1000, 2500, 10000];
  const dims = { tickets: [1, 2], gap: GAPS, rounds: [1, 2, 3, 4, 5], who: ["list", "anyone"], inv: [0, 1, 4, 10], occ: OCCASIONS, cap: CAPS, time: TIMES };
  const rows = pairwise(dims, R);
  const core = cross({ tickets: [1, 2], gap: GAPS, rounds: [1, 2, 3, 4, 5], who: ["list", "anyone"] }).map((r) => ({ ...r, inv: R.pick(dims.inv), occ: R.pick(dims.occ), cap: R.pick(CAPS), time: R.pick(TIMES) }));
  const seen = new Set();
  [...core, ...rows].forEach((c, i) => {
    const name = `cfg|t${c.tickets} gap${c.gap} r${c.rounds} ${c.who} inv${c.inv} ${slug(c.occ)} cap${c.cap} ${c.time}${i < core.length ? " (full cross)" : " (all pairs)"}`;
    if (seen.has(name)) return; seen.add(name);
    out.push({ name, run: async (t) => {
      const org = await t.newOrg(); const company = R.pick(COMPANIES); const days = 1 + t.R.int(25);
      const gname = `${c.occ} - ${company}`;
      const g = await t.game(org, { cap: c.cap, tickets: c.tickets, gap: c.gap, rounds: c.rounds, who: c.who, name: gname, days, time: c.time });
      if (!t.expect("create the draft", g.r, "ok")) return;
      t.check("created as a draft", g.r.body.draft === true, JSON.stringify(g.r.body));
      if (c.inv) {
        const s = await org.settings(g.id, { guestInvites: { on: true, per: c.inv, cats: ["family", "colleagues", "friends"] } });
        t.expect("switch guest invites on", s, "ok"); t.eq("per-person invite limit saved", s.body.guestInvites?.per, c.inv);
      }
      const sum = (await org.summary(g.id)).body;
      t.eq("tickets saved", sum.tickets, c.tickets); t.eq("gap saved", sum.callSeconds, c.gap); t.eq("rounds saved", sum.rounds, c.rounds);
      t.eq("who can join saved", sum.whoCanJoin, c.who); t.eq("size saved", sum.limit, c.cap);
      t.eq("start shown in India time", sum.startsAtIST, istLabel(g.startMs));
      t.eq("invites saved", sum.guestInvites?.on === true ? sum.guestInvites.per : 0, c.inv);
      const inf = await A.call("GET", `/api/z/${g.id}/info`, undefined, org.h);
      t.check("name saved on the game", inf.body.name === gname, `${inf.body.name}`);
      const pub = await org.publish(g.id, mobile(t.R)); t.expect("publish (free)", pub, "ok");
      t.eq("status after publish", (await org.summary(g.id)).body.status, "published, payment due before the start");
      const pay = await org.pay(g.id); t.expect("pay (test payment)", pay, "ok");
      t.eq("pack is the smallest that fits", pay.body.result?.pack, packFor(c.cap)); t.eq("price with GST", pay.body.result?.total, totalFor(c.cap));
      t.eq("status after payment", (await org.summary(g.id)).body.status, "published and paid");
      const again = await org.pay(g.id); t.expect("second payment for the same game is refused", again, "bad");
      const pub2 = (await org.summary(g.id)).body.payment; t.check("payment recorded once as paid by organizer", pub2?.status === "paid" && pub2?.paidBy === "organizer", JSON.stringify(pub2));
      const g1 = t.guest(g.id); const j = await g1.join();
      if (c.who === "list") { t.expect("a stranger on a list-only game waits", j, [403]); t.check("answer says waiting", j.body.waiting === true || j.body.code === "waiting", JSON.stringify(j.body)); }
      else { t.expect("a guest joins an open game", j, "ok"); t.eq("guest sees the tickets setting", j.body.tickets, c.tickets); t.eq("guest sees the gap", j.body.callSeconds, c.gap);
        const j2 = await g1.join(); t.check("same phone twice is the same ticket", j2.ok && j2.body.pid === j.body.pid, JSON.stringify(j2.body).slice(0, 120)); }
      if (c.cap <= 2 && c.who === "anyone") { // fill the game and one more
        for (let k = 1; k < c.cap; k++) t.expect("fill a seat", await t.guest(g.id).join(), "ok");
        const over = await t.guest(g.id).join(); t.expect("one more than the size is refused", over, [409]);
      }
    } });
  });

  // ---- invalid values of each option, one scenario each: refused in plain words and nothing is created ----
  const now = () => clock.now();
  const bad = [
    ["cap=0", { cap: 0 }], ["cap=-5", { cap: -5 }], ["cap=1.5", { cap: 1.5 }], ["cap string", { cap: "50" }], ["cap=100001", { cap: 100001 }], ["cap null", { cap: null }],
    ["gap=0", { callSeconds: 0 }], ["gap=3", { callSeconds: 3 }], ["gap=5", { callSeconds: 5 }], ["gap=7", { callSeconds: 7 }], ["gap=10", { callSeconds: 10 }], ["gap=-9", { callSeconds: -9 }], ["gap string", { callSeconds: "9" }], ["gap=9.5", { callSeconds: 9.5 }],
    ["gap=18 (not one of 6/9/12/15)", { callSeconds: 18 }], ["gap=30 (not one of 6/9/12/15)", { callSeconds: 30 }], ["gap=3000 (not one of 6/9/12/15)", { callSeconds: 3000 }],
    ["rounds=0", { rounds: 0 }], ["rounds=6", { rounds: 6 }], ["rounds=2.5", { rounds: 2.5 }], ["rounds string", { rounds: "3" }], ["rounds=-1", { rounds: -1 }],
    ["tickets=0", { tickets: 0 }], ["tickets=3", { tickets: 3 }], ["tickets string", { tickets: "2" }], ["tickets=1.5", { tickets: 1.5 }],
    ["start float", { startRound: 1.5 }], ["start string", { startRound: "abc" }], ["start 31 days ahead", { startRound: "FAR" }], ["start missing", { startRound: undefined }],
    ["id 3 letters", { id: "abc" }], ["id with space", { id: "my game" }], ["id 41 letters", { id: "X".repeat(41) }], ["id with slash", { id: "a/b/c/d" }], ["id with dots", { id: "../../etc" }], ["id empty", { id: "" }], ["id unicode", { id: "दीवाली-पार्टी" }],
    ["rewards empty list", { rewards: [] }], ["rewards not a list", { rewards: "blackout" }], ["unknown house", { rewards: [{ pattern: "jackpot", scope: "ticket", ordinal: 1, text: "x" }] }],
    ["whoCanJoin nonsense", { whoCanJoin: "friends" }, "settings"], ["gap=7 through settings", { callSeconds: 7 }, "settings"], ["gap=18 through settings (not one of 6/9/12/15)", { callSeconds: 18 }, "settings"], ["gap=3000 through settings (not one of 6/9/12/15)", { callSeconds: 3000 }, "settings"], ["size above the pack through settings", { cap: 101 }, "settings-after-pay"], ["rounds=6 through settings", { rounds: 6 }, "settings"], ["tickets=3 through settings", { tickets: 3 }, "settings"], ["invites per=11 through settings", { guestInvites: { on: true, per: 11 } }, "settings"], ["invites per=0 through settings", { guestInvites: { on: true, per: 0 } }, "settings"], ["invites on with no kind of guest", { guestInvites: { on: true, per: 2, cats: [] } }, "settings"], ["invites unknown kind", { guestInvites: { on: true, per: 2, cats: ["aliens"] } }, "settings"], ["co-host limit 9", { coHostLimit: 9 }, "settings"], ["co-host limit 1001", { coHostLimit: 1001 }, "settings"], ["name over 60 characters is trimmed, not refused", { name: "N".repeat(90) }, "ok"],
  ];
  for (const [label, patch0, mode] of bad) {
    out.push({ name: `cfg-invalid|${label}`, run: async (t) => {
      let patch = patch0;
      const org = await t.newOrg(); const id = t.gid("BAD"); const st = await startAt(5, "19:00"); let startRound = st.round;
      if (patch.startRound === "PAST") patch = { startRound: L.roundFrom((await now()) - 3600_000) };
      if (patch.startRound === "FAR") patch = { startRound: L.roundFrom((await now()) + 31 * DAY) };
      const body = { id, startRound, callSeconds: 9, cap: 50, ...patch }; if (patch.startRound === undefined && "startRound" in patch) delete body.startRound;
      const r = await org.api("POST", "/api/z", body);
      if (mode === "ok") { t.expect("accepted (long text is trimmed)", r, "ok"); const inf = await A.call("GET", `/api/z/${id}/info`, undefined, org.h); t.check("trimmed to 60", (inf.body.name ?? "").length <= 60, `${(inf.body.name ?? "").length}`); return; }
      if (mode === "settings" || mode === "settings-after-pay") {
        const g = await t.game(org, { cap: 100 }); if (mode === "settings-after-pay") await t.publishPay(org, g.id);
        const s = await org.settings(g.id, patch); t.expect("settings refuse it", s, "bad");
        const before = (await org.summary(g.id)).body; t.check("nothing changed", before.callSeconds === 9 && before.limit === 100 && before.tickets === 1 && before.rounds === 1, JSON.stringify([before.callSeconds, before.limit, before.tickets, before.rounds])); return; }
      t.expect("refused", r, "bad");
      t.check("refusal is a plain sentence", !!r.body.error && !/undefined|null|SQL|Error/.test(r.body.error), r.body.error);
      if (patch.id === undefined) { const s = await org.summary(id); t.expect("nothing was created", s, "deny"); }
    } });
  }

  out.push({ name: "cfg-invalid|body is not JSON / is a list / is empty", run: async (t) => {
    const org = await t.newOrg();
    for (const [label, body] of [["text", "hello"], ["array", "[1,2,3]"], ["empty", ""], ["null", "null"], ["number", "42"]]) t.expect(`create with ${label} body`, await A.call("POST", "/api/z", body, org.h), "bad");
    const huge = await A.call("POST", "/api/z", JSON.stringify({ id: t.gid("HUGE"), startRound: (await startAt(3)).round, callSeconds: 9, cap: 50, name: "x".repeat(200_000) }), org.h);
    t.expect("a 200 KB body is refused", huge, "bad");
  } });
  out.push({ name: "cfg-invalid|name with markup is cleaned", run: async (t) => {
    const org = await t.newOrg(); const g = await t.game(org, { name: "<script>alert(1)</script> Diwali `party` <b>2026</b>" });
    t.expect("create", g.r, "ok"); const inf = await A.call("GET", `/api/z/${g.id}/info`, undefined, org.h);
    t.check("no angle brackets or backticks stored", !/[<>`]/.test(inf.body.name ?? ""), inf.body.name);
  } });
  out.push({ name: "cfg|the 11th unpublished draft is refused, publishing one frees a place", run: async (t) => {
    const org = await t.newOrg(); const ids = [];
    for (let k = 0; k < 10; k++) { const g = await t.game(org, { cap: 30 }); t.expect(`draft ${k + 1}`, g.r, "ok"); ids.push(g.id); }
    const x = await t.game(org); t.expect("the 11th draft", x.r, [409]); t.check("the answer names the limit", /10/.test(x.r.body.error ?? ""), x.r.body.error);
    t.expect("publish one", await org.publish(ids[0], mobile(t.R)), "ok"); // an unpaid published game is still a draft until paid; paying frees the place
    t.expect("pay it", await org.pay(ids[0]), "ok");
    const y = await t.game(org); t.expect("a new draft after paying one", y.r, "ok");
  } });
  out.push({ name: "cfg|creating an id that exists never overwrites and never reveals the owner", run: async (t) => {
    const a = await t.newOrg("a"), b = await t.newOrg("b"); const g = await t.game(a, { cap: 40, name: "Dealer meet - Gupta Agro" });
    const again = await b.api("POST", "/api/z", { ...g.body, cap: 999, name: "Hijacked" });
    t.expect("second organizer creating the same id", again, "ok"); t.check("answer says it exists", again.body.existed === true, JSON.stringify(again.body));
    t.expect("second organizer cannot read it", await b.summary(g.id), "deny");
    const s = (await a.summary(g.id)).body; t.check("original is unchanged", s.limit === 40, `limit ${s.limit}`);
    const inf = await A.call("GET", `/api/z/${g.id}/info`, undefined, a.h); t.check("name unchanged", inf.body.name === "Dealer meet - Gupta Agro", inf.body.name);
  } });
  out.push({ name: "cfg|AI path turns an India date and time into a start", run: async (t) => {
    const org = await t.newOrg(); const st = await startAt(6, "18:00"); const d = new Date(st.ms + 330 * MIN);
    const at = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:00%2B05:30`;
    const r = await A.call("GET", `/ai/${org.aiKey}/z/schedule?at=${at}`);
    t.expect("schedule", r, "ok"); t.check("startRound matches 6 pm India time", Math.abs(roundTimeMs(r.body.startRound) - st.ms) <= 3000, JSON.stringify(r.body));
    t.check("label says 6:00 pm IST", /6:00 pm IST/.test(r.body.startsAtIST ?? ""), r.body.startsAtIST);
    const past = await A.call("GET", `/ai/${org.aiKey}/z/schedule?at=2020-01-01T10:00:00%2B05:30`); t.expect("a past time is refused", past, "bad");
    const far = await A.call("GET", `/ai/${org.aiKey}/z/schedule?at=2099-01-01T10:00:00%2B05:30`); t.expect("a time beyond 30 days is refused", far, "bad");
    const junk = await A.call("GET", `/ai/${org.aiKey}/z/schedule?at=tomorrow-ish`); t.expect("a junk time is refused", junk, "bad");
  } });
  return out;
}
