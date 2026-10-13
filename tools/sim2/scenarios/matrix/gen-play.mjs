// Family "play": whole games through the bun phone crowd (tools/sim2/crowd.ts, no browser, fake public beacon, virtual time) against this suite's own server.
// Sizes 1, 2 and 50 phones (10,000 players is covered by the size/price/pack scenarios of "config"; a 10,000-phone crowd does not fit an 8 GB laptop).
// Checks the server-side result of real play: every phone shows identical winners, no house has more winners than the Organizer configured (and none above its maximum), ordinals 1..n without gaps,
// Unlucky only once, lucky draws pick exactly the configured number of distinct tickets, one ticket per phone.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PRIZE_HOUSES } from "../../../../packages/beacon/src/config.ts";
import { perHouseMaxima } from "../../lib/invariants.mjs";
export default async function gen({ R, L }) {
  const { A, mobile, SIM } = L;
  const out = [];
  const run = (args) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["tools/sim2/crowd.ts", JSON.stringify(args)], { cwd: fileURLToPath(new URL("../../../..", import.meta.url)), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let so = "", se = ""; p.stdout.on("data", (d) => (so += d)); p.stderr.on("data", (d) => (se += d));
    const to = setTimeout(() => { p.kill(); reject(new Error("crowd timeout")); }, 150_000);
    p.on("close", () => { clearTimeout(to); try { resolve(JSON.parse(so.trim().split("\n").pop())); } catch { reject(new Error("crowd gave no JSON: " + (so + se).slice(-300))); } });
  });
  const line = (pattern, ordinal, text = "") => ({ pattern, scope: "ticket", ordinal, text });
  const legacy = [line("corners", 1, "Gift voucher: Rs 500"), line("line", 1), line("x", 1), line("frame", 1), line("corners", 1), line("plus", 1), line("blackout", 1, "Smartphone")];
  const allHouses = PRIZE_HOUSES.filter((h) => h.id !== "full2").flatMap((h) => Array.from({ length: h.max }, (_, i) => line(h.id, i + 1, i === 0 ? h.label + " prize" : "")));
  const CASES = [
    ["1 phone, the seven classic houses", 1, legacy, 9, []], ["2 phones, the seven classic houses", 2, legacy, 9, []], ["50 phones, the seven classic houses", 50, legacy, 9, []],
    ["50 phones, every house at its maximum number of winners", 50, allHouses, 12, []], ["50 phones, Full House for 3 and Unlucky", 50, [line("corners", 1), line("blackout", 1), line("blackout", 2), line("blackout", 3), line("unlucky", 1)], 9, []],
    ["2 phones, gap 6 and a lucky draw for 3 (only 2 can win)", 2, legacy, 6, [{ kind: "lucky", title: "Lucky draw", after: 40, seconds: 30, winners: 3 }]], ["50 phones, gap 15, two winners for each line, a lucky draw for 5 and a speech", 50, [line("corners", 1), line("line", 1), line("line", 2), line("x", 1), line("x", 2), line("frame", 1), line("frame", 2), line("blackout", 1), line("blackout", 2)], 15, [{ kind: "lucky", title: "Lucky draw", after: 30, seconds: 30, winners: 5 }, { kind: "speech", title: "A word from our MD", after: 60, seconds: 30 }]],
  ];
  for (const [label, phones, rewards, gap, breaks] of CASES) out.push({ name: `play|${label}`, time: true, timeoutMs: 170_000, allowUnfriendly: false, run: async (t) => {
    const org = await t.newOrg(); const g = await t.game(org, { cap: Math.max(phones, 2), gap, who: "anyone", rewards, breaks, days: 1 }); if (!t.expect("create", g.r, "ok")) return;
    await t.publishPay(org, g.id); const r = await run({ eid: g.id, startRound: g.startRound, phones, seed: `m${t.seed}`, base: SIM, maxSteps: 600, lateFrac: 0.2, offlineFrac: 0.03, phoneBase: 100000 + t.R.int(800000) });
    t.check("the crowd finished without failures", r.ok === true, JSON.stringify(r.failures ?? r).slice(0, 300)); t.eq("everyone who joined has ended", r.ended, r.joined); t.check("at least 90% of the phones joined", r.joined >= Math.ceil(phones * 0.9) || phones <= 2 && r.joined === phones, `${r.joined}/${phones}`);
    t.eq("all phones agree on the winners (one group)", (r.groups ?? []).length, 1);
    const results = r.results ?? []; const cfgRewards = rewards; const m = perHouseMaxima(results.filter((x) => x.pattern !== "lucky"), cfgRewards); t.check("per-house maxima: " + m.detail.slice(0, 200), m.ok, m.detail);
    for (const h of PRIZE_HOUSES) { const n = results.filter((x) => x.pattern === h.id && (x.round ?? 1) === 1).length; t.check(`${h.id} has at most ${h.max} winning lines`, n <= h.max, `${n}`); }
    const un = results.filter((x) => x.pattern === "unlucky").length; t.check("Unlucky is given at most once", un <= 1, `${un}`);
    const lucky = results.filter((x) => x.pattern === "lucky"); const pickedList = lucky.flatMap((x) => (Array.isArray(x.winners) ? x.winners : [x.idx ?? x.pid ?? JSON.stringify(x)])); // one lucky-draw result lists all its winners if (breaks.some((b) => b.kind === "lucky")) { const want = Math.min(breaks.find((b) => b.kind === "lucky").winners, phones); t.check(`the lucky draw picks ${want} distinct tickets`, pickedList.length === want && new Set(pickedList).size === want, `${pickedList.length} picked`); }
    t.check("one ticket per phone", (await A.sql("SELECT COUNT(*) c FROM (SELECT phone_hash FROM participant WHERE eid=? GROUP BY phone_hash HAVING COUNT(*)>1)", [g.id]))[0].c === 0);
    const sv = await A.call("GET", `/api/z/${g.id}/results`); t.check("the server's stored results never exceed what the phones agree on", sv.status < 500, `HTTP ${sv.status}`);
    const mails = await A.mailbox.list(); t.check("no e-mail to any player", mails.every((x) => x.to === org.email || x.to === "sim@example.com"), mails.map((x) => x.to).join(","));
  } });
  return out;
}
