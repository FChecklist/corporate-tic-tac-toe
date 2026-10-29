// Gap plan 2026-10-29 (TT-15 and the wording items): the public copy must be true and must use the owner's wording. Reads the real page files, no browser.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PUB = join(import.meta.dir, "../public");
const pages = readdirSync(PUB).filter((f) => f.endsWith(".html"));
const read = (f: string) => readFileSync(join(PUB, f), "utf8");
/** Visible text of a page: scripts, styles and tags removed, entities for the rupee sign and non-breaking space turned back. */
const cache = new Map<string, string>();
const textOf = (f: string) => { let t = cache.get(f); if (t === undefined) { t = textOf0(f); cache.set(f, t); } return t; };
const textOf0 = (f: string) => read(f).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

/** Fails with the few words around the hit, not the whole page. */
const no = (f: string, re: RegExp) => { const m = re.exec(textOf(f)); if (m) throw new Error(`${f} still says: "...${textOf(f).slice(Math.max(0, m.index - 50), m.index + m[0].length + 50)}..."`); };

describe("TT-15: the 1,000-player claim says it was a computer rehearsal", () => {
  test("no page says 'tested with 1,000 players'; the home page says 'simulated' and that a live event of that size has not been run", () => {
    for (const f of pages) no(f, /tested with 1,?000 players/i);
    const t = textOf("index.html");
    expect(t).toMatch(/1,000 simulated players/); expect(t).toMatch(/live event of that size has not been run/i);
  });
});

// ---- TT-17: the word "private" never appears in what a person reads --------------------------------------------------------------------------------------------------
// Owner rule 2026-10-28: the games are close group online engagement; "private" suggests something it is not. Checked in every public page's visible text, every public script
// and every server file that writes text for people (mails, AI messages, payment texts). Code comments are not text for people and are ignored.
const EDGE = join(import.meta.dir, "../../edge/src");
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, " ").split(/\r?\n/).map((l) => l.replace(/(^|[^:\w"'`\\])\/\/.*$/, "$1")).join("\n");
const SKIP_JS = /^(tttgame|zgame|control|reportgen|pdf|v)\.js$/; // built bundles
/** Pages that are the lawyer's own text, not product copy: the legal statement keeps its term until the lawyer rules (owner ruling Q6 spirit). */
const LAWYER_TEXT = new Set(["legal-position.html"]);

describe("TT-17: no 'private' in text for people", () => {
  test("public pages (visible text)", () => { for (const f of pages) if (!LAWYER_TEXT.has(f)) no(f, /\bprivate\b/i); });
  test("public scripts (strings the page shows)", () => {
    for (const f of readdirSync(PUB).filter((x) => x.endsWith(".js") && !SKIP_JS.test(x))) {
      const m = /\bprivate\b/i.exec(stripComments(read(f))); if (m) throw new Error(`${f} still says: "...${stripComments(read(f)).slice(Math.max(0, m.index - 50), m.index + 60)}..."`);
    }
  });
  test("server files (mails, AI messages, payment texts)", () => {
    for (const f of readdirSync(EDGE).filter((x) => x.endsWith(".ts") || x.endsWith(".json"))) {
      const code = stripComments(readFileSync(join(EDGE, f), "utf8")).replace(/\bprivate\s+(readonly|static|async|get|set|[\w$]+\s*[:=(<;?])/g, "x $1"); const m = /\bprivate\b/i.exec(code); // a TypeScript "private" modifier is code, not text
      if (m) throw new Error(`edge/${f} still says: "...${code.slice(Math.max(0, m.index - 50), m.index + 60)}..."`);
    }
  });
});

// ---- TT-16: one deletion promise, the same numbers everywhere --------------------------------------------------------------------------------------------------------
// The promise to players is "within 24 hours". The code erases guest data at PURGE_AFTER_MS and closes the report link at REPORT_LINK_MS (lifecycle.ts); every sentence that
// names those hours must name THESE hours. The numbers are read from the constants, so changing a window without the words fails here.
import { PURGE_AFTER_MS, REPORT_LINK_MS } from "../../edge/src/lifetimes";
const PURGE_H = PURGE_AFTER_MS / 3_600_000, LINK_H = REPORT_LINK_MS / 3_600_000;
/** terms.html is the contract: changing it needs a new Terms version and the lawyer (owner ruling Q6), so it is the one page not swept here. */
const CONTRACT = new Set(["terms.html"]);
const STALE = /\b(21|22|23)[ -]hours?\b/i; // the old 22/23-hour numbers; 24 is the promise, 19 and 20 are the real windows

describe("TT-16: the hours named for the report link and the erasure are the real ones", () => {
  test("the constants are what the promise needs (erase well inside 24 hours; link closes before the data goes)", () => {
    expect(PURGE_H).toBeLessThan(24); expect(LINK_H).toBeLessThan(PURGE_H);
  });
  test("no page names the old 21/22/23-hour numbers", () => { for (const f of pages) if (!CONTRACT.has(f)) no(f, STALE); });
  test("no public script or server text names the old 21/22/23-hour numbers", () => {
    const files = [...readdirSync(PUB).filter((x) => x.endsWith(".js") && !SKIP_JS.test(x)).map((x) => [x, join(PUB, x)]), ...readdirSync(EDGE).filter((x) => x.endsWith(".ts")).map((x) => ["edge/" + x, join(EDGE, x)])];
    for (const [name, path] of files as [string, string][]) { const code = stripComments(readFileSync(path, "utf8")); const m = STALE.exec(code); if (m) throw new Error(`${name} still says: "...${code.slice(Math.max(0, m.index - 60), m.index + 60)}..."`); }
  });
  test("the organizer guide says when the report link closes and when the data is erased, with the real numbers", () => {
    const t = textOf("organizer-guide.html");
    expect(t).toContain(`Your report link works for ${LINK_H} hours`); expect(t).toContain(`within 24 hours after the game (we do it at ${PURGE_H} hours)`);
  });
  test("the console's After the game step says the same", () => {
    const js = read("zc.js"); expect(js).toContain(`The report link works for ${LINK_H} hours`); expect(js).toContain(`names and numbers are deleted at ${PURGE_H} hours`);
  });
  test("the trust page and the AI facts say the job runs at the real hour", () => {
    expect(textOf("trust.html")).toContain(`(the job runs at ${PURGE_H} hours)`);
    expect(readFileSync(join(EDGE, "ai-facts.ts"), "utf8")).toContain("PURGE_HOURS");
  });
});

// ---- TT-02: the game does not start by itself; the Organizer or a Host presses Start ---------------------------------------------------------------------------------
describe("TT-02: no text says the game starts by itself", () => {
  test("the console says the Organizer presses Start, and pays before the start", () => {
    const js = read("zc.js");
    for (const bad of [/starts on time by itself/, /begins the moment you have/, /game starts 2 minutes after your payment/, /Your game starts <b>/]) expect(bad.test(js)).toBe(false);
    expect(js).toContain("You press Start on the tournament page");
    expect(js).toContain("Paid late? The game opens 2 minutes after your payment is confirmed. You still press Start yourself.");
  });
  test("the organizer guide says a late payment opens the game, not starts it", () => {
    const t = textOf("organizer-guide.html"); expect(t).not.toMatch(/late payment starts the game/); expect(t).toMatch(/Press Start|press Start/);
  });
});

// ---- TT-14: the pages must not say "nobody can change a result" while the host page lets the Organizer pick the winner of a stuck board --------------------------------
// host.js lists "Boards to settle" (the two phones reported different winners, or nobody played the board) and the Organizer or a Host picks the winner (tournament.ts settle route).
describe("TT-14: the fairness copy names the one case where a person picks a winner", () => {
  const EXCEPTION = /picks the winner of that one board/;
  test("home page, legal page and trust page no longer say no person can change a result, and name the exception", () => {
    expect(textOf("index.html")).not.toMatch(/No person, including the organizer and us, can change a draw or a result/);
    expect(textOf("legal.html")).not.toMatch(/no way to change a draw or a result/);
    expect(textOf("trust.html")).not.toMatch(/cannot choose, change or remove a result/);
    for (const f of ["index.html", "legal.html", "trust.html"]) expect(textOf(f)).toMatch(EXCEPTION);
  });
  test("the AI facts say the same as the trust page, and the report's closing note names the exception too", () => {
    const facts = readFileSync(join(EDGE, "ai-facts.ts"), "utf8"); expect(facts).not.toMatch(/cannot choose, change or remove a result/); expect(facts).toMatch(EXCEPTION);
    const rep = readFileSync(join(EDGE, "report-layout.ts"), "utf8"); expect(rep).not.toMatch(/can choose, change or remove a winner/); expect(rep).toMatch(EXCEPTION);
  });
});
