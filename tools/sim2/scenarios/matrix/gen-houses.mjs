// Family "houses": every prize house (the 19 houses of PRIZE_HOUSES plus the Full Two-Ticket House) at every legal number of winners, one more than the maximum (must be refused),
// the prize-text choices of the console (a named prize, "I will decide later" = empty text, "No prize"), and the rules that tie the lines together.
import { PRIZE_HOUSES, MAX_REWARD_LINES } from "../../../../packages/beacon/src/config.ts";
export default async function gen({ R, L }) {
  const { A, mobile, personName } = L;
  const out = [];
  const TEXTS = ["Gift voucher: Rs 1000", "", "No prize", "Smartphone", "Dinner or restaurant voucher: Rs 2000", "Extra day off", "Holiday or weekend stay: Goa", "Something else", "Movie tickets: 4", "Gift hamper"];
  const lines = (h, n, textOf) => Array.from({ length: n }, (_, i) => ({ pattern: h.id === "full2" ? "blackout" : h.id, scope: h.id === "full2" ? "two_ticket" : "ticket", ordinal: i + 1, text: textOf(i) }));
  const keyOf = (l) => `${l.scope}:${l.pattern}#${l.ordinal}=${l.text}`;
  const same = (got, want) => JSON.stringify(got.map(keyOf).sort()) === JSON.stringify(want.map(keyOf).sort());
  let ti = 0;
  for (const h of PRIZE_HOUSES) {
    for (let n = 1; n <= h.max; n++) {
      const text0 = TEXTS[ti++ % TEXTS.length];
      out.push({ name: `house|${h.id} ${n} winner${n > 1 ? "s" : ""} of max ${h.max} text=${JSON.stringify(text0).slice(0, 20)}`, run: async (t) => {
        const org = await t.newOrg(); const two = h.id === "full2";
        const want = lines(h, n, (i) => (i === 0 ? text0 : TEXTS[(ti + i) % TEXTS.length]));
        const g = await t.game(org, { cap: 50, tickets: two ? 2 : 1, rewards: want });
        t.expect("create with this house", g.r, "ok");
        const sum = (await org.summary(g.id)).body; t.check("saved exactly as sent", same(sum.rewards ?? [], want), JSON.stringify(sum.rewards).slice(0, 300));
        const upd = await org.settings(g.id, { rewards: want }); t.expect("edit the same list", upd, "ok");
        const pp = await t.publishPay(org, g.id); t.expect("publish", pp.p, "ok"); t.expect("pay", pp.q, "ok");
        const guest = t.guest(g.id); const j = await guest.join(); t.expect("a guest joins", j, "ok");
        t.check("the guest's phone gets the same lines", same(j.body.rewards ?? [], want), JSON.stringify(j.body.rewards).slice(0, 200));
        if (text0 === "No prize") t.check("No prize is kept as those words", (j.body.rewards ?? []).some((l) => l.text === "No prize"));
      } });
    }
    const over = h.max + 1;
    out.push({ name: `house|${h.id} ${over} winners is one more than the maximum ${h.max}`, run: async (t) => {
      const org = await t.newOrg(); const two = h.id === "full2";
      const g = await t.game(org, { cap: 50, tickets: two ? 2 : 1 });
      const s = await org.settings(g.id, { tickets: two ? 2 : 1, rewards: lines(h, over, () => "x1") });
      t.expect("refused", s, "bad"); t.check("the message says how many winners are allowed", new RegExp(h.max === 1 ? "only 1 winner" : `at most ${h.max}`).test(s.body.error ?? ""), s.body.error);
      const c = await t.game(org, { cap: 50, tickets: two ? 2 : 1, rewards: lines(h, over, () => "x1") });
      t.expect("create refuses it too", c.r, "bad");
      const sum = (await org.summary(g.id)).body; t.check("the saved game still has its default prizes", (sum.rewards ?? []).length === 7, `${(sum.rewards ?? []).length} lines`);
    } });
  }

  // ---- rules that tie lines together ----
  out.push({ name: "house|all 20 houses together at their maximum (41 lines) is accepted", run: async (t) => {
    const org = await t.newOrg(); const all = PRIZE_HOUSES.flatMap((h) => lines(h, h.max, (i) => TEXTS[(h.max + i) % TEXTS.length]));
    t.eq("line count equals the sum of all maxima", all.length, MAX_REWARD_LINES);
    const g = await t.game(org, { cap: 100, tickets: 2, rewards: all }); t.expect("create", g.r, "ok");
    t.check("all lines saved", ((await org.summary(g.id)).body.rewards ?? []).length === all.length);
    const extra = await org.settings(g.id, { rewards: [...all, { pattern: "line", scope: "ticket", ordinal: 3, text: "" }] }); t.expect("one line above the total is refused", extra, "bad");
  } });
  for (const [label, rewards, tickets] of [
    ["a 2nd winner without a 1st", [{ pattern: "line", scope: "ticket", ordinal: 2, text: "" }], 1],
    ["the same line twice", [{ pattern: "line", scope: "ticket", ordinal: 1, text: "" }, { pattern: "line", scope: "ticket", ordinal: 1, text: "" }], 1],
    ["winner number 0", [{ pattern: "line", scope: "ticket", ordinal: 0, text: "" }], 1],
    ["winner number -1", [{ pattern: "line", scope: "ticket", ordinal: -1, text: "" }], 1],
    ["winner number 1.5", [{ pattern: "line", scope: "ticket", ordinal: 1.5, text: "" }], 1],
    ["winner number as text", [{ pattern: "line", scope: "ticket", ordinal: "1", text: "" }], 1],
    ["a two-ticket house on a one-ticket game", [{ pattern: "blackout", scope: "two_ticket", ordinal: 1, text: "" }], 1],
    ["two-ticket scope on a house other than Full", [{ pattern: "line", scope: "two_ticket", ordinal: 1, text: "" }], 2],
    ["the id full2 used as a pattern", [{ pattern: "full2", scope: "ticket", ordinal: 1, text: "" }], 2],
    ["house id with markup", [{ pattern: "<b>top</b>", scope: "ticket", ordinal: 1, text: "" }], 1],
    ["a line that is not an object", ["line"], 1],
    ["42 lines (one above the total)", Array.from({ length: MAX_REWARD_LINES + 1 }, (_, i) => ({ pattern: "line", scope: "ticket", ordinal: i + 1, text: "" })), 2],
  ]) {
    out.push({ name: `house-invalid|${label}`, run: async (t) => {
      const org = await t.newOrg(); const g = await t.game(org, { cap: 50, tickets }); const before = (await org.summary(g.id)).body.rewards;
      const s = await org.settings(g.id, { tickets, rewards }); t.expect("refused in plain words", s, "bad");
      t.check("the saved prizes did not change", JSON.stringify((await org.summary(g.id)).body.rewards) === JSON.stringify(before));
    } });
  }
  out.push({ name: "house|prize text longer than 80 characters is trimmed and markup is removed", run: async (t) => {
    const org = await t.newOrg(); const g = await t.game(org, { cap: 50, rewards: [{ pattern: "blackout", scope: "ticket", ordinal: 1, text: "<img src=x onerror=alert(1)> " + "Z".repeat(120) }] });
    t.expect("create", g.r, "ok"); const text = (await org.summary(g.id)).body.rewards?.[0]?.text ?? "";
    t.check("no angle brackets", !/[<>]/.test(text), text); t.check("at most 80 characters", text.length <= 80, `${text.length}`);
  } });
  out.push({ name: "house|going from two tickets to one removes the two-ticket house and keeps the rest", run: async (t) => {
    const org = await t.newOrg(); const g = await t.game(org, { cap: 50, tickets: 2, rewards: [{ pattern: "corners", scope: "ticket", ordinal: 1, text: "" }, { pattern: "blackout", scope: "two_ticket", ordinal: 1, text: "" }] });
    t.expect("create with two tickets", g.r, "ok");
    const s = await org.settings(g.id, { tickets: 1 }); t.expect("switch to one ticket", s, "ok");
    const r = (await org.summary(g.id)).body.rewards ?? []; t.check("no two-ticket line left", !r.some((l) => l.scope === "two_ticket"), JSON.stringify(r)); t.check("Early Five is still there", r.some((l) => l.pattern === "corners"));
  } });
  out.push({ name: "house|every prize left as 'I will decide later' still publishes and pays", run: async (t) => {
    const org = await t.newOrg(); const g = await t.game(org, { cap: 50, rewards: PRIZE_HOUSES.filter((h) => h.legacy && h.id !== "full2").map((h) => ({ pattern: h.id, scope: "ticket", ordinal: 1, text: "" })) });
    const pp = await t.publishPay(org, g.id); t.expect("publish", pp.p, "ok"); t.expect("pay", pp.q, "ok");
  } });
  out.push({ name: "house|every prize set to 'No prize' shows those words to the guest", run: async (t) => {
    const org = await t.newOrg(); const g = await t.game(org, { cap: 50, rewards: ["corners", "line", "x", "frame", "blackout"].map((p) => ({ pattern: p, scope: "ticket", ordinal: 1, text: "No prize" })) });
    await t.publishPay(org, g.id); const j = await t.guest(g.id).join(); t.expect("join", j, "ok");
    t.check("all five lines say No prize", (j.body.rewards ?? []).length === 5 && j.body.rewards.every((l) => l.text === "No prize"), JSON.stringify(j.body.rewards).slice(0, 200));
  } });
  const bundles = { Classic: { early5: 1, top: 1, mid: 1, bot: 1, full: 1 }, Simple: { early5: 1, full: 1 }, Rich: { early5: 1, top: 1, mid: 1, bot: 1, corners: 1, star: 1, full: 3 } };
  for (const [bn, b] of Object.entries(bundles)) out.push({ name: `house|console bundle ${bn}`, run: async (t) => {
    const org = await t.newOrg(); const rewards = Object.entries(b).flatMap(([p, n]) => Array.from({ length: n }, (_, i) => ({ pattern: p, scope: "ticket", ordinal: i + 1, text: TEXTS[(i + n) % TEXTS.length] })));
    const g = await t.game(org, { cap: 250, rewards }); t.expect("create", g.r, "ok"); t.check("saved", same((await org.summary(g.id)).body.rewards ?? [], rewards));
  } });
  out.push({ name: "house|the Unlucky house next to a Full House (the pair the rules describe)", run: async (t) => {
    const org = await t.newOrg(); const rewards = [{ pattern: "blackout", scope: "ticket", ordinal: 1, text: "Gift hamper" }, { pattern: "unlucky", scope: "ticket", ordinal: 1, text: "A consolation box" }];
    const g = await t.game(org, { cap: 50, rewards }); t.expect("create", g.r, "ok"); const j = await (async () => { await t.publishPay(org, g.id); return t.guest(g.id).join(); })();
    t.check("guest sees both lines", same(j.body.rewards ?? [], rewards));
  } });
  return out;
}
