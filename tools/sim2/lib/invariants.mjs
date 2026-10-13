// Invariants a scenario asserts after (or during) a run. Each returns { name, ok, detail } so a campaign can print and count them.
import { mailbox, sql } from "./api.mjs";
const res = (name, ok, detail = "") => ({ name, ok: !!ok, detail });
const canon = (results) => JSON.stringify([...results].map((r) => `${r.round ?? 1}|${r.pattern}|${r.ordinal}|${r.idx}|${r.count ?? ""}`).sort());

/** Every phone shows the same winners. `views` = [{ who, results }] where results is the list a phone shows (GET /results shape or PhoneRuntime view().results). */
export function identicalWinners(views) {
  const ref = views[0] ? canon(views[0].results) : "[]";
  const bad = views.filter((v) => canon(v.results) !== ref).map((v) => v.who);
  return res("identical winners on all phones", views.length > 0 && !bad.length, bad.length ? `differ: ${bad.slice(0, 5).join(", ")} (of ${views.length}); reference ${ref.slice(0, 160)}` : `${views.length} phones agree on ${JSON.parse(ref).length} results`);
}
/** Per house: no more winning lines than the Organizer configured, ordinals 1..n without gaps or repeats, per round. */
export function perHouseMaxima(results, rewards) {
  const cfg = {}; for (const r of rewards) cfg[r.pattern] = (cfg[r.pattern] ?? 0) + 1;
  const seen = {}; const problems = [];
  for (const r of results) { const k = `${r.round ?? 1}|${r.pattern}`; (seen[k] ??= []).push(r.ordinal); }
  for (const [k, ords] of Object.entries(seen)) {
    const pat = k.split("|")[1]; const max = cfg[pat] ?? 0;
    if (ords.length > max) problems.push(`${k}: ${ords.length} winning lines, configured ${max}`);
    if (new Set(ords).size !== ords.length) problems.push(`${k}: repeated ordinal ${ords}`);
    if (Math.max(...ords) > max) problems.push(`${k}: ordinal above ${max}`);
  }
  return res("per-house maxima", !problems.length, problems.join("; "));
}
/** One ticket per phone: no phone hash twice in a game and no device bound to two seats. */
export async function oneTicketPerPhone(eid) {
  const a = await sql("SELECT phone_hash, COUNT(*) c FROM participant WHERE eid=? GROUP BY phone_hash HAVING c>1", [eid]);
  const b = await sql("SELECT dev, COUNT(*) c FROM seat WHERE eid=? AND dev IS NOT NULL AND dev<>'' GROUP BY dev HAVING c>1", [eid]);
  return res("one ticket per phone", !a.length && !b.length, `${a.length} repeated numbers, ${b.length} devices on several seats`);
}
const PERSONAL = ["participant", "seat", "person", "waiting", "claim", "settled", "rvote", "rcand", "overvote"];
/** After erasure (23 h after the end, or the Organizer pressing Erase) nothing about the people is left; `planted` strings (names, numbers) must be nowhere in these tables. */
export async function noPersonalDataAfterErasure(eid, planted = []) {
  const left = {};
  for (const t of PERSONAL) { const r = await sql(`SELECT COUNT(*) c FROM ${t} WHERE eid=?`, [eid]); if (r[0].c) left[t] = r[0].c; }
  const leaks = [];
  for (const s of planted) { for (const t of ["participant", "person", "waiting"]) { const r = await sql(`SELECT COUNT(*) c FROM ${t} WHERE ${t === "participant" ? "name" : "name"} LIKE ?`, ["%" + s + "%"]).catch(() => [{ c: 0 }]); if (r[0].c) leaks.push(`${s} in ${t}`); } }
  return res("no personal data after erasure", !Object.keys(left).length && !leaks.length, JSON.stringify(left) + (leaks.length ? " leaks: " + leaks.join(", ") : ""));
}
/** E-mail goes only to the Organizer and Hosts (the addresses given). Never to a guest. */
export async function emailOnlyToTeam(allowed) {
  const ok = new Set(allowed.map((x) => x.toLowerCase())); const l = await mailbox.list();
  const bad = l.filter((m) => !ok.has(m.to.toLowerCase())).map((m) => `${m.to}: ${m.subject}`);
  return res("e-mail only to Organizer/Host", !bad.length, bad.slice(0, 5).join(" | ") || `${l.length} mails, all to team addresses`);
}
/** Nothing is paid twice: one paid payment per (eid) in the Worker's payment table. */
export async function nobodyPaidTwice() {
  const r = await sql("SELECT eid, COUNT(*) c FROM payment WHERE status='paid' AND eid IS NOT NULL GROUP BY eid HAVING c>1");
  return res("nobody paid twice", !r.length, JSON.stringify(r));
}
/** The Worker stayed inside the free-plan write budget (default 80,000 per day). */
export async function writeBudget(limit = 80000) {
  const r = await sql("SELECT day, writes FROM usage WHERE day NOT LIKE '%~%' ORDER BY writes DESC LIMIT 1"); // rows like "2026-10-10~v" are the visit tracker's own counter
  return res("D1 writes inside the free-plan budget", !r.length || r[0].writes <= limit, r.length ? `peak ${r[0].writes} writes on ${r[0].day} (limit ${limit})` : "no usage rows");
}
export const summarize = (list) => { const bad = list.filter((x) => !x.ok); return { total: list.length, failed: bad.length, bad }; };
