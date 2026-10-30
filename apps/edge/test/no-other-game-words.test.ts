// Words of another game must not reach a person: the pages, the pay screen (Razorpay description), the AI link prompt and manual, the e-mails and the report of Corporate Tic Tac Toe say nothing about
// Bingo, Tambola or Housie, and nothing about cards, numbers called, daubing, houses or lucky draws, which this game does not have.
// (The Corporate Games bar and the uniform footer's "More from us" line name the sister games on purpose, and a few internal file names and code comments keep the old words.)
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { layoutReport, type ReportData } from "../src/report-layout";

const WEB = join(import.meta.dir, "../../web/public"), SRC = join(import.meta.dir, "../src");
const SKIP = new Set(["gamesbar.js", "control.js", "zgame.js", "tttgame.js", "reportgen.js"]); // the games bar lists the other games; the others are built bundles with internal names
const WORDS = /\b(bingo|tambola|housie)\b/i;
const UNIFORM_FOOTER = /<footer class="(?:uf|ck-foot)"[\s\S]*?<\/footer>/; // the same footer on every Corporate Games site (games-ops/footer/ufooter.py): it links the other games

describe("no wording from another game", () => {
  for (const f of readdirSync(WEB).filter((x) => /\.(html|js)$/.test(x) && !SKIP.has(x))) {
    test("page file " + f, () => expect(readFileSync(join(WEB, f), "utf8").replace(UNIFORM_FOOTER, "").match(WORDS)?.[0] ?? null).toBeNull());
  }
  for (const f of ["pay.ts", "ai-link.ts", "ai-go.ts", "ai-functions.ts", "ai-facts.ts", "mails.ts", "legal.ts", "worker.ts", "report-layout.ts", "lifecycle.ts"]) {
    test("edge source " + f, () => expect(readFileSync(join(SRC, f), "utf8").match(WORDS)?.[0] ?? null).toBeNull());
  }
});

describe("the report of a tournament says what happened in a tournament", () => {
  const data = (extra: Partial<ReportData> = {}): ReportData => ({
    engagementId: "WORD-1", organizerEmail: "boss@acme.com", sentAtMs: 1_800_000_000_000, scheduledMs: 1_799_990_000_000, firstNumberMs: 1_799_990_100_000, endMs: 1_799_995_000_000, endReason: "The tournament was played to the final and the places were agreed.", wasHeld: false,
    rounds: 1, callSeconds: 9, ticketsPerPerson: 1, cap: 100, inviteOnly: false, numbersCalled: 75, people: [],
    prizes: [{ round: 1, label: "Champion (1st)", text: "Gift hamper", winners: [{ seat: 3, name: "Asha", phone: "9876543210", role: null, verified: true, callNo: 1, atMs: 1_799_995_000_000 }] }],
    lucky: [], timeline: [{ callNo: 1, atMs: 1_799_990_100_000, present: 5, late: 0 }], breaks: [], personalDeleteAtMs: 1_800_050_000_000, fullDeleteAtMs: 1_830_000_000_000,
    play: { format: "One against one", rounds: 3, moveSecs: 20, players: 6, champion: "Asha" }, ...extra,
  });
  const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
  test("it shows the format, the bracket, the move clock, the players and the final places", () => {
    const t = text(layoutReport(data()));
    for (const must of ["Tournament started", "Rounds in the bracket", "Move clock", "20 seconds for every move", "Players in the draw", "Champion", "Final places", "Game WORD-1", "Complete game report"]) expect(t).toContain(must);
  });
  test("it has no bingo wording: no numbers called, calls, cards, lucky draws or brand breaks", () => {
    const t = text(layoutReport(data({ breaks: [{ after: 10, kind: "speech", title: "A word" }] })));
    expect(t.match(/first number|numbers called|Numbers called|Cards per person|Call speed|Lucky draw|At call|Brand breaks|Engagement|engagement|card assignment|After number/)?.[0] ?? null).toBeNull();
  });
});
