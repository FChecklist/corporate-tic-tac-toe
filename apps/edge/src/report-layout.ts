// The engagement report the organizer receives by e-mail: one PDF with everything we hold about the game and its people, and a plain statement of what
// is deleted and when. This file only lays data out; it knows nothing about the database (see lifecycle.ts for where the data comes from).
import { BRAND } from "./brand";
import { GOLD, NAVY, PdfDoc, WHITE, type Column } from "./pdf";

export interface ReportPerson { seat: number | null; name: string | null; phone: string | null; joinedMs: number | null; late: boolean; role: string | null; invitedBy: number | null; onRoster: boolean; joined: boolean; /** the list this person is on: Organizer, Host <name>, Co-host <name> (a guest's own invitees show under that guest) */ via?: string | null; /** who let them in from the waiting room or put them back */ admittedBy?: string | null; removed?: boolean }
export interface ReportWinner { seat: number | null; name: string | null; phone: string | null; role: string | null; verified: boolean; callNo: number | null; atMs: number | null; /** the winner confirmed these details on their own phone after the game */ confirmed?: boolean; /** what they joined with, when they changed it after the game */ changedFrom?: string | null; /** the date the organizer ticked 'prize given' */ given?: string | null }
export interface ReportPrize { round: number; label: string; text: string; winners: ReportWinner[] }
export interface Agg { joined: number; onRoster: number; notJoined: number; late: number; viaInvite: number; inviters: number; topInviter: [number, number] | null; roles: number; joinedInTime: number; firstJoinMs: number | null }
export const emptyAgg = (): Agg => ({ joined: 0, onRoster: 0, notJoined: 0, late: 0, viaInvite: 0, inviters: 0, topInviter: null, roles: 0, joinedInTime: 0, firstJoinMs: null });
export interface ReportData {
  /** The organizer's time zone (an IANA name); India time when absent. */ tz?: string;
  engagementId: string; organizerEmail: string; sentAtMs: number;
  scheduledMs: number; firstNumberMs: number; endMs: number; endReason: string; wasHeld: boolean;
  rounds: number; callSeconds: number; ticketsPerPerson: number; cap: number; inviteOnly: boolean; numbersCalled: number;
  people: ReportPerson[];
  prizes: ReportPrize[];
  lucky: { title: string; winners: ReportWinner[] }[];
  /** Participants present at chosen call numbers of round 1. */
  timeline: { callNo: number; atMs: number; present: number; late: number }[];
  breaks: { after: number; kind: string; title: string }[];
  personalDeleteAtMs: number; fullDeleteAtMs: number; backupDays: number;
  /** Totals about the people, when the list itself is spread over several PDFs. */
  agg?: Agg; omitPeople?: boolean; totalPeople?: number;
  /** The organizer's own company name and logo (a data URL). The report page turns the logo into raw pixels (`logoPix`) before laying the PDF out. */
  brand?: { name?: string; logo?: string }; logoPix?: { w: number; h: number; hex: string };
}

import { DEFAULT_TZ, zoneAbbr, zoneDate, zoneFull, zoneParts } from "./tz";
const p2 = (n: number) => String(n).padStart(2, "0");
/** "Sat 03 Oct 2026, 21:14:05 IST" (in the organizer's time zone when one is given) */
export const istFull = (ms: number, tz: string = DEFAULT_TZ) => zoneFull(ms, tz);
/** "Mon 04 Oct 2027" */
export const istDate = (ms: number, tz: string = DEFAULT_TZ) => zoneDate(ms, tz);
const utcFull = (ms: number) => { const d = new Date(ms); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} UTC`; };
const hm = (ms: number, tz: string = DEFAULT_TZ) => { const d = zoneParts(ms, tz); return `${p2(d.h)}:${p2(d.mi)}:${p2(d.s)}`; };
const dur = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 3600)} h ${p2(Math.floor((s % 3600) / 60))} min`; };
const mob = (p: string | null) => (p ? p.replace(/^(\d{5})(\d{5})$/, "$1 $2") : "-");
const who = (w: { name: string | null; phone: string | null }) => `${w.name || "(no name)"}, ${mob(w.phone)}`;

export function layoutReport(d: ReportData): Uint8Array {
  const pdf = new PdfDoc();
  pdf.footer = `Corporate Tic Tac Toe  |  Engagement ${d.engagementId}  |  sent ${istFull(d.sentAtMs, d.tz)}`;

  // ---- title band
  pdf.rect(0, pdf.H, pdf.W, 92, NAVY); pdf.rect(0, pdf.H - 92, pdf.W, 3, GOLD);
  if (d.logoPix) pdf.logo(d.logoPix, pdf.W - pdf.M - 64, pdf.H - 14, 64, 64); // the organizer's logo, on a white tile at the right of the band
  pdf.y = pdf.H - 28;
  pdf.para(d.brand && d.brand.name ? `${d.brand.name} | Corporate Tic Tac Toe` : "Corporate Tic Tac Toe", { font: "F2", size: 11, color: GOLD, gap: 2 });
  pdf.para("Complete engagement report", { font: "F2", size: 22, color: WHITE, gap: 2 });
  pdf.para(`Engagement ${d.engagementId}   |   ${d.people.length} people   |   ${d.prizes.reduce((n, p) => n + p.winners.length, 0)} prize wins`, { size: 9.5, color: WHITE });
  pdf.y = pdf.H - 92 - 16;

  pdf.box("Sent to you", [
    `E-mail address: ${d.organizerEmail}`,
    `Sent on: ${istFull(d.sentAtMs, d.tz)}  (${utcFull(d.sentAtMs)})`,
    "This PDF is the complete record of your engagement, including the names and mobile numbers of everyone who took part. Please keep it safe: it is the only copy of this data that exists once we delete ours.",
  ], [0.93, 0.96, 1], NAVY);

  pdf.box("What we keep, and what we delete", [
    `We have given you ALL the data we hold about the people in this engagement. Within 24 hours of the game ending, and no later than ${istFull(d.personalDeleteAtMs, d.tz)}, we permanently delete from our systems every participant's name, mobile number, join record, card assignment and invite link record. After that nobody at Corporate Tic Tac Toe, and nothing in our software or database, holds them.`,
    "We keep, for 365 days, only: (1) the details of the organizer, host and co-hosts (name, e-mail, mobile number); (2) the winners record: which prize, which round, at what time, and the card seat number; and (3) the name and mobile number each winner confirmed for the prize hand-over, with the date it was given. The winners record itself holds no names or numbers.",
    `Everything about this engagement, including those two records, is permanently deleted at 00:00 hours (IST) on ${istDate(d.fullDeleteAtMs)}, which is the end of the 365th day. The only things kept after that are the payment and invoice records, the organizer's details on the invoice (name, e-mail, mobile) and who paid, because invoices and payment records have to be kept for tax and accounting.`,
    `Backups of our database roll off within ${d.backupDays} days, so any copy of deleted data in a backup is gone within ${d.backupDays} days of the deletion.`,
    "For your next game you can reuse the people list until it is deleted (the reuse button in your console), or upload your own list again afterwards from this report.",
  ]);

  // ---- 1 summary
  pdf.h1("1. The game");
  pdf.table([{ head: "Item", width: 32 }, { head: "Detail", width: 78 }], [
    ["Scheduled time you gave", istFull(d.scheduledMs, d.tz)],
    ["First number called", d.wasHeld ? "The game did not start (see note below)" : istFull(d.firstNumberMs, d.tz) + "  (2 minutes after the scheduled time)"],
    ["Game ended", `${istFull(d.endMs, d.tz)}`],
    ["How it ended", d.endReason],
    ["Playing time", d.wasHeld ? "-" : dur(d.endMs - d.firstNumberMs)],
    ["Rounds", String(d.rounds)],
    ["Numbers called in the last round", String(d.numbersCalled)],
    ["Call speed", `one number every ${d.callSeconds} seconds`],
    ["Cards per person", String(d.ticketsPerPerson)],
    ["Participant limit", `${d.cap}${d.inviteOnly ? "  (invitation only)" : ""}`],
  ]);
  if (d.wasHeld) pdf.para("Note: this game was not started (for example it was not paid for by its start time), so no numbers were called.", { size: 9 });
  if (d.breaks.length) { pdf.h2("Brand breaks"); pdf.table([{ head: "After number", width: 13, align: "r" }, { head: "Kind", width: 10 }, { head: "Title", width: 60 }], d.breaks.map((b) => [String(b.after), b.kind, b.title])); }

  // ---- 2 participants over time
  pdf.h1("2. How many people were in the game");
  pdf.para("Counted at chosen numbers of round 1. 'Late' are people who joined after the first number was called: they see only the numbers called from 90 seconds after they joined, and prizes already awarded are gone for them.", { size: 9, gap: 4 });
  pdf.table([{ head: "At number", width: 10, align: "r" }, { head: `Time (${zoneAbbr(d.firstNumberMs || d.scheduledMs, d.tz)})`, width: 12 }, { head: "People", width: 8, align: "r" }, { head: "Of them late", width: 12, align: "r" }], d.timeline.map((t) => [String(t.callNo), hm(t.atMs, d.tz), String(t.present), String(t.late)]), { zebra: true });

  // ---- 3 prizes and winners
  pdf.h1("3. Prizes and winners");
  { const t0 = d.prizes.length, w0 = d.prizes.filter((p) => p.winners.length).length;
  pdf.para(`${t0} prize lines were set up; ${w0} were won (${t0 - w0} not won).`, { size: 9.5, gap: 4 }); }
  for (const pr of d.prizes) {
    pdf.h2(`${d.rounds > 1 ? `Round ${pr.round}  |  ` : ""}${pr.label}${pr.text ? `   -   ${pr.text}` : ""}`);
    if (!pr.winners.length) { pdf.para("Not won.", { size: 9, color: [0.4, 0.43, 0.48] }); continue; }
    pdf.table([{ head: "Seat", width: 5, align: "r" }, { head: "Name", width: 21 }, { head: "Mobile", width: 12 }, { head: "At call", width: 6, align: "r" }, { head: "Time", width: 8 }, { head: "Role", width: 10 }, { head: "Agreed by", width: 8 }, { head: "Prize given", width: 12 }],
      pr.winners.map((w) => [w.seat === null ? "-" : String(w.seat), w.name || "(no name)", mob(w.phone), w.callNo === null ? "-" : String(w.callNo), w.atMs ? hm(w.atMs, d.tz) : "-", w.role || "participant", w.verified ? "phones" : "-", w.given ? w.given : "not yet"]));
    for (const w of pr.winners) if (w.changedFrom) pdf.para(`Seat ${w.seat === null ? "-" : w.seat}: details changed after the game (${w.changedFrom}).`, { size: 8.5, color: [0.7, 0.15, 0.1] });
  }
  { // the ranking: 1st, 2nd, 3rd ... and the top 10 (prize order, then call number); every prize line has exactly one winner
    const base = (l: string) => l.replace(/^\d+(st|nd|rd|th) /, "");
    const flat = d.prizes.flatMap((p) => p.winners.map((w) => ({ p, w })));
    if (flat.length) {
      pdf.h2("Ranking: top winners");
      const rows = flat.slice(0, 10).map((x, i) => { const tied = flat.some((y) => y !== x && base(y.p.label) === base(x.p.label) && y.w.callNo !== null && y.w.callNo === x.w.callNo); return [String(i + 1), x.p.label, x.w.seat === null ? "-" : String(x.w.seat), x.w.name || "(no name)", x.w.callNo === null ? "-" : String(x.w.callNo), tied ? "tied on the same call; decided by fate" : ""]; });
      pdf.table([{ head: "Rank", width: 5, align: "r" }, { head: "Prize", width: 17 }, { head: "Seat", width: 5, align: "r" }, { head: "Name", width: 18 }, { head: "At call", width: 7, align: "r" }, { head: "How decided", width: 24 }], rows);
    }
  }
  for (const l of d.lucky) {
    pdf.h2(`Lucky draw  -  ${l.title}`);
    pdf.table([{ head: "Seat", width: 5, align: "r" }, { head: "Name", width: 24 }, { head: "Mobile", width: 12 }], l.winners.map((w) => [w.seat === null ? "-" : String(w.seat), w.name || "(no name)", mob(w.phone)]));
  }
  pdf.para("Every winner here was worked out by the software from the public numbers, and was accepted only when several different phones reported exactly the same result ('Agreed by: phones'). Neither you nor anyone at Corporate Tic Tac Toe can choose, change or remove a winner or a number. Names and mobile numbers are those the winner confirmed on their own phone after the game; if they changed them, that is shown under the table.", { size: 8.5 });

  // ---- 4 statistics
  const total = d.prizes.length, won = d.prizes.filter((p) => p.winners.length).length;
  const g: Agg = d.agg ?? aggOf(d.people);
  const rate = g.joinedInTime && g.firstJoinMs ? `${(g.joinedInTime / Math.max(1, (d.firstNumberMs - g.firstJoinMs) / 60000)).toFixed(1)} people per minute` : "-";
  pdf.h1("4. Statistics");
  pdf.table([{ head: "Measure", width: 52 }, { head: "Value", width: 48 }], [
    ["People who took part (joined)", String(g.joined)],
    ["On your invitation list", String(g.onRoster)],
    ["Invited but never joined", String(g.notJoined)],
    ["Joined after the first number (late)", String(g.late)],
    ["Joined through someone's invite link", String(g.viaInvite)],
    ["People who invited at least one person", String(g.inviters)],
    ["Most invites by one person", g.topInviter ? `${g.topInviter[1]} (seat ${g.topInviter[0]})` : "0"],
    ["Organizer / host / co-host with a card", String(g.roles)],
    ["Prize lines won / not won", `${won} / ${total - won}`],
    ["Total prize wins (no prize is shared)", String(d.prizes.reduce((n, p) => n + p.winners.length, 0))],
    ["Prize wins by organizer / host / co-host", String(d.prizes.reduce((n, p) => n + p.winners.filter((w) => w.role).length, 0))],
    ["Average join rate before the start", rate],
  ]);

  if (d.omitPeople) { pdf.h1("5. Who invited whom, and 6. Everyone"); pdf.para(`This game had ${d.totalPeople} people, so the invite tree and the full list (names and mobile numbers) come in the following e-mails, in parts of up to 1,500 people each.`, { size: 9.5 }); }
  else { treeSection(pdf, d.people); listSection(pdf, d.people, d.tz); }

  pdf.h1("7. When your data is deleted");
  pdf.table([{ head: "Data", width: 62 }, { head: "Deleted by", width: 48 }], [
    ["Participants' names and mobile numbers, seats, invite links", istFull(d.personalDeleteAtMs, d.tz)],
    ["Backups holding any of the above", `within ${d.backupDays} days after that`],
    ["Organizer / host / co-host details and the winners record", `00:00 hours IST, ${istDate(d.fullDeleteAtMs)}`],
  ]);
  pdf.para("You can ask us to delete everything sooner: press 'Erase' in your console, ask your AI assistant to request it (you confirm in your console), or e-mail us from your registered address.", { size: 9 });

  pdf.h1("8. Our commitment to your data");
  pdf.box("All of it is deleted. Here is exactly what, and when.", [
    `1. Everything about the people in this engagement (every name, mobile number, seat, join record and invite record) is permanently deleted from our systems within 24 hours of the game ending, and no later than ${istFull(d.personalDeleteAtMs, d.tz)}. You have all of it in this report; after that we hold none of it.`,
    "2. We keep only two things, for 365 days: the details of the organizer, host and co-hosts (name, e-mail address and mobile number), and the winners record (which prize, which round, at what time, which seat number). The winners record has no names and no mobile numbers.",
    `3. At 00:00 hours IST on ${istDate(d.fullDeleteAtMs)}, the end of the 365th day, everything else is permanently deleted too. The only things kept after that are the payment and invoice records, the organizer's details on the invoice (name, e-mail, mobile) and who paid, because invoices and payment records have to be kept for tax and accounting.`,
    `4. Backups of our database roll off within ${d.backupDays} days, so no copy of deleted data remains after that.`,
    "5. Names and mobile numbers are stored encrypted while we hold them, and only your own game's report is ever built from them.",
  ]);
  pdf.box("The laws we follow", [
    "Corporate Tic Tac Toe is built to follow India's Digital Personal Data Protection Act, 2023 (DPDP Act), the European Union's General Data Protection Regulation (GDPR) and the United Kingdom's equivalent, and the privacy laws of the United States, including state laws such as the California Consumer Privacy Act (CCPA / CPRA).",
    "In practice this means: we collect only the data needed to run your game; we use it only for that purpose; we protect it with encryption; we keep it for the shortest time we can and tell you exactly how long; we never sell it or use it for advertising; and the people who took part, and you, can ask us to show, correct or delete their data at any time.",
    "You are the organizer of your game and decide who takes part; we process the data on your behalf. To exercise any right, or to ask us anything, reply to the e-mail this report came with.",
  ], [0.93, 0.96, 1], NAVY);
  pdf.para(`Sent on ${istFull(d.sentAtMs, d.tz)} to ${d.organizerEmail}.`, { size: 8.5, color: [0.4, 0.43, 0.48] });
  pdf.para(`${BRAND.name}  |  Questions? Write to ${BRAND.support}  |  Rules, privacy and disclaimer: ${BRAND.defaultOrigin}${BRAND.legalPath}`, { size: 8.5, color: [0.4, 0.43, 0.48] });
  return pdf.build();
}

const aggOf = (people: ReportPerson[]): Agg => {
  const g = emptyAgg(), inv = new Map<number, number>();
  for (const p of people) {
    if (p.joined) { g.joined++; if (p.late) g.late++; else { g.joinedInTime++; if (p.joinedMs && (g.firstJoinMs === null || p.joinedMs < g.firstJoinMs)) g.firstJoinMs = p.joinedMs; } }
    if (p.onRoster) g.onRoster++; if (p.onRoster && !p.joined) g.notJoined++;
    if (p.invitedBy) { g.viaInvite++; inv.set(p.invitedBy, (inv.get(p.invitedBy) ?? 0) + 1); }
    if (p.role) g.roles++;
  }
  g.inviters = inv.size; const top = [...inv.entries()].sort((a, b) => b[1] - a[1])[0]; g.topInviter = top ? [top[0], top[1]] : null;
  return g;
};
export { aggOf };

/** The who-invited-whom lines: grouped by the list people came from (Organizer, Host, Co-host), guests under their own inviter, and who admitted whom. */
export function treeLines(people: ReportPerson[]): string[] {
  const bySeat = new Map<number, ReportPerson>(); for (const p of people) if (p.seat !== null) bySeat.set(p.seat, p);
  const kids = new Map<number | null, ReportPerson[]>();
  for (const p of people) { const k = p.invitedBy && bySeat.has(p.invitedBy) ? p.invitedBy : null; (kids.get(k) ?? kids.set(k, []).get(k)!).push(p); }
  const lines: string[] = []; const seen = new Set<number>();
  const walk = (k: number | null, depth: number) => { for (const c of kids.get(k) ?? []) { if (lines.length >= 4000) return; if (c.seat !== null) { if (seen.has(c.seat)) continue; seen.add(c.seat); } lines.push(`${"    ".repeat(Math.min(depth, 12))}${depth ? "+- " : ""}${c.name || "(no name)"}  seat ${c.seat ?? "-"}  ${mob(c.phone)}${c.role ? "  [" + c.role + "]" : ""}${c.admittedBy ? "  (admitted by " + c.admittedBy + ")" : ""}${c.removed ? "  (removed)" : ""}${c.invitedBy && !bySeat.has(c.invitedBy) ? `  (invited by seat ${c.invitedBy}, listed in another part)` : ""}`); if (c.seat !== null) walk(c.seat, depth + 1); } };
  // roots are grouped under the list they came from, so the tree reads Organizer -> Host -> Co-host -> guest -> guest's guest
  const order = ["Organizer", ...[...new Set(people.map((p) => p.via).filter((v): v is string => !!v && v !== "Organizer" && v.startsWith("Host")))].sort(), ...[...new Set(people.map((p) => p.via).filter((v): v is string => !!v && v.startsWith("Co-host")))].sort()];
  const roots = kids.get(null) ?? [];
  if (roots.some((p) => p.via)) {
    const rest = new Map<string, ReportPerson[]>(); for (const p of roots) { const k = p.via ?? "Organizer"; (rest.get(k) ?? rest.set(k, []).get(k)!).push(p); }
    for (const grp of [...order, ...[...rest.keys()].filter((k) => !order.includes(k))]) { const g = rest.get(grp); if (!g) continue; lines.push(`[${grp}]`); kids.set(null, g); walk(null, 1); }
  } else walk(null, 0);
  return lines;
}
function treeSection(pdf: PdfDoc, people: ReportPerson[]) {
  pdf.h1("5. Who invited whom");
  pdf.para("Each person's share link records who sent it. People at the left edge came through the organizer's own link or list.", { size: 9, gap: 4 });
  const lines = treeLines(people);
  if (!lines.length) pdf.para("Nobody shared an invite link in this game.", { size: 9 });
  else { for (const l of lines) pdf.pre(l); if (lines.length >= 4000) pdf.para("(The list is cut at 4,000 lines.)", { size: 8.5 }); }
}
function listSection(pdf: PdfDoc, people: ReportPerson[], tz?: string) {
  pdf.h1("6. Everyone, with name and mobile number");
  pdf.para(`${people.length} people. 'Joined' is the time they opened the link (${zoneAbbr(people.find((x) => x.joinedMs)?.joinedMs ?? 0, tz)}). Names in scripts other than Latin letters print as ? in this PDF.`, { size: 9, gap: 4 });
  const cols: Column[] = [{ head: "Seat", width: 5, align: "r" }, { head: "Name", width: 24 }, { head: "Mobile", width: 12 }, { head: "Joined", width: 8 }, { head: "Late", width: 4 }, { head: "Role", width: 9 }, { head: "By", width: 5, align: "r" }, { head: "List", width: 4 }];
  pdf.table(cols, [...people].sort((a, b) => (a.seat ?? 1e9) - (b.seat ?? 1e9)).map((p) => [p.seat === null ? "-" : String(p.seat), p.name || "(no name)", mob(p.phone), p.joinedMs ? hm(p.joinedMs, tz) : "-", p.late ? "yes" : "", p.role || "", p.invitedBy ? String(p.invitedBy) : "", p.onRoster ? "yes" : ""]), { zebra: true });
}
/** One of the extra PDFs of a big game: the invite tree and the list for up to 1,500 people. */
export function layoutPeoplePart(d: ReportData, people: ReportPerson[], k: number, n: number): Uint8Array {
  const pdf = new PdfDoc();
  pdf.footer = `Corporate Tic Tac Toe  |  Engagement ${d.engagementId}  |  people part ${k} of ${n}  |  sent ${istFull(d.sentAtMs, d.tz)}`;
  pdf.rect(0, pdf.H, pdf.W, 70, NAVY); pdf.rect(0, pdf.H - 70, pdf.W, 3, GOLD);
  pdf.y = pdf.H - 26;
  pdf.para("Corporate Tic Tac Toe", { font: "F2", size: 11, color: GOLD, gap: 2 });
  pdf.para(`People, part ${k} of ${n}  |  Engagement ${d.engagementId}`, { font: "F2", size: 16, color: WHITE });
  pdf.y = pdf.H - 70 - 14;
  pdf.box("Sent to you", [`E-mail address: ${d.organizerEmail}`, `Sent on: ${istFull(d.sentAtMs, d.tz)}  (${utcFull(d.sentAtMs)})`, `All data about the people is deleted from our systems by ${istFull(d.personalDeleteAtMs, d.tz)}. Keep these PDFs safe: they are the only copy.`], [0.93, 0.96, 1], NAVY);
  treeSection(pdf, people); listSection(pdf, people, d.tz);
  return pdf.build();
}
