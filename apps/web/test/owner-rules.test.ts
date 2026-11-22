// Owner rules v1.1 for the organizer and host screens (version 1.4.1).
//  - the screens speak to "you": zero first-person words in what a person reads
//  - the rupee sign, never "Rs"
//  - ONE privacy line and ONE fairness sentence, each with one wording; the fairness one is proved below
//  - no claim the game cannot keep
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { commitOf, newSecret, seedOf, verifyReveal } from "../../../packages/ttt/src/seal";
import { startTournament } from "../../../packages/ttt/src/bracket";

const PUB = (f: string) => new URL("../public/" + f, import.meta.url);
// organizer / host screens (pack/ is copied byte for byte from the console repo and is not loaded by any page yet; see docs/KNOWLEDGE.md)
const SCREENS = ["zc.html", "zc.js", "host.html", "host.js", "signin.html", "signin.js", "zc-flow-game.js"].filter((f) => existsSync(PUB(f)));
const FIRST_PERSON = /(?<![\w/.'-])(I|I'm|I'll|I've|I'd|me|Me|my|My|mine|we|We|we'll|We'll|we're|We're|we've|We've|us|Us|our|Our|ours)(?![\w-])/;

/** the words a person can read in one file: every quoted string of a script, and the text of a page (scripts and styles left out) */
export function readableText(file: string): string[] {
  const src = readFileSync(PUB(file), "utf8");
  const out: string[] = [];
  if (file.endsWith(".html")) out.push(src.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " "));
  for (const m of src.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)) out.push(m[0].slice(1, -1));
  return out;
}

describe("owner rules v1.1: the organizer and host screens speak to you", () => {
  test("the scan itself works: it sees first-person words and ignores addresses", () => {
    expect(FIRST_PERSON.test("We could not read it")).toBe(true);
    expect(FIRST_PERSON.test("Publish my game")).toBe(true);
    expect(FIRST_PERSON.test("Can I get it?")).toBe(true);
    expect(FIRST_PERSON.test("https://wa.me/ and /api/z/1/people/me and en-US")).toBe(false);
    expect(FIRST_PERSON.test("Your game, you can publish it. It is made small for you.")).toBe(false);
  });
  for (const f of SCREENS) test(`${f} has no first-person word (I, me, my, we, us, our)`, () => {
    const bad = readableText(f).filter((t) => FIRST_PERSON.test(t)).map((t) => t.slice(0, 80));
    expect(bad).toEqual([]);
  });
  test("the help answers shown to an organizer or host (guide.js entries added for the console) are free of first-person words too", () => {
    const g = readFileSync(PUB("guide.js"), "utf8");
    const entry = g.split("\n").filter((l) => /This sign-in is for one game only/.test(l) || /Open the console to see your other games/.test(l)).join("\n");
    expect(entry).not.toBe("");
    expect(entry).not.toMatch(/\b(we|We|our|Our|us)\b/);
  });
});

// M3 (audit of f1d18faf): the whole help file the organizer is shown speaks to "you", not only the new entries. The text a server error is MATCHED against (the m: lists) is not shown to anyone and is left as the server writes it.
describe("owner rules v1.1: the help file (guide.js) speaks to you", () => {
  const stripMatchers = (src: string) => src.split("\n").map((l) => l.replace(/\bm: \[[^\]]*\]/g, "m: []")).join("\n");
  test("no first-person word in anything the help file shows (the matcher lists aside)", () => {
    const src = stripMatchers(readFileSync(PUB("guide.js"), "utf8"));
    const bad = [...src.matchAll(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0]).filter((t) => FIRST_PERSON.test(t)).map((t) => t.slice(0, 80));
    expect(bad).toEqual([]);
  });
  test("the stripping works: a first-person word outside a matcher list is seen, one inside is not", () => {
    expect(FIRST_PERSON.test(stripMatchers('{ m: ["We could not find"], t: "We could not find that" }'))).toBe(true);
    expect(FIRST_PERSON.test(stripMatchers('{ m: ["We could not find"], t: "That could not be found" }'))).toBe(false);
  });
});

// "ID matched, not proven" is an owner-accepted, documented decision (docs/KNOWLEDGE.md). The help must say so; it must not promise more.
describe("owner rules v1.1: employee ID is matched, not proven", () => {
  const js = readFileSync(PUB("zc.js"), "utf8");
  test("the help under 'Employee ID' says the game checks the ID against the list and does not prove who typed it", () => {
    expect(js).toMatch(/"ver:id": "[^"]*It does not prove who typed it[^"]*personal link is the strong proof/);
    expect(js).toMatch(/"ver:both": "[^"]*does not prove who typed them[^"]*personal link is the strong proof/);
  });
});

describe("owner rules v1.1: the rupee sign", () => {
  for (const f of SCREENS) test(`${f} writes money with the rupee sign, never Rs`, () => {
    const bad = readableText(f).filter((t) => /\bRs\.?\s?\d/.test(t) || /\bRs\.? ?0\b/.test(t)).map((t) => t.slice(0, 80));
    // the one allowed mention is the code that strips a typed "Rs" from a prize amount before it writes the sign
    expect(bad.filter((t) => !/\^\(Rs\\\.\?/.test(t))).toEqual([]);
  });
  test("a prize typed as 'Rs 500' or '₹ 500' is shown with the rupee sign once", () => {
    const js = readFileSync(PUB("zc.js"), "utf8");
    expect(js).toMatch(/": ₹" \+ d\.replace\(\/\^\(Rs\\\.\?\|₹\)\\s\*\/i, ""\)/);
  });
});

describe("owner rules v1.1: one privacy line, one fairness sentence", () => {
  const js = readFileSync(PUB("zc.js"), "utf8");
  const PRIVACY = "Players' names and numbers are used only to run this game and are deleted within 24 hours of the game ending.";
  const FAIRNESS = "Who plays whom and who goes first is drawn from one seed that nobody picks: its fingerprint is published before the game starts and the seed is shown afterwards, so anyone can check the whole draw. You cannot choose or change it.";
  const count = (s: string, sub: string) => s.split(sub).length - 1;
  test("each sentence is defined once, word for word, and nowhere else is a second wording of it", () => {
    expect(count(js, `const PRIVACY = "${PRIVACY}"`)).toBe(1);
    expect(count(js, `const FAIRNESS = "${FAIRNESS}"`)).toBe(1);
    expect(count(js, "are deleted within 24 hours of the game ending")).toBe(1);
    expect(count(js, "You cannot choose or change it")).toBe(1);
  });
  test("they are the ones shown: the screens use the constants, not copies", () => {
    expect(js).toMatch(/small\(PRIVACY \+/);
    expect(js).toMatch(/small\(FAIRNESS \+/);
    expect(js).toMatch(/small\(`\$\{FAIRNESS\}/);
  });
  test("PROOF of the fairness sentence: the commitment is published first, the seed cannot be steered by the organizer, the reveal is checkable, and the same seed gives the same draw", async () => {
    const secret = newSecret(), eid = "FAIR-1", pids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
    const commit = await commitOf(secret); // published before the start
    expect(commit).toMatch(/^[0-9a-f]{64}$/); expect(commit).not.toContain(secret);
    const seed = await seedOf(secret, eid, pids); // made at the start from the secret and the closed list: the organizer supplies neither
    expect(await verifyReveal(secret, commit)).toBe(true); // shown afterwards: anyone can check it
    expect(await verifyReveal(newSecret(), commit)).toBe(false); // a different secret cannot pass as the committed one
    expect(await seedOf(secret, eid, [...pids].reverse())).toBe(seed); // the order the list was typed in changes nothing
    expect(await seedOf(secret, eid, pids.slice(1))).not.toBe(seed); // a different list is a different seed
    const players = pids.map((pid) => ({ pid, name: pid.toUpperCase() }));
    const a = await startTournament({ eid, seed, players, startAt: 1 }), b = await startTournament({ eid, seed, players: [...players].reverse(), startAt: 1 });
    const noNames = (t: any) => JSON.stringify({ ...t, names: undefined });
    expect(noNames(b)).toBe(noNames(a)); // "anyone can check the whole draw": the same seed gives the same bracket, however the list was typed
    const other = await startTournament({ eid, seed: await seedOf(newSecret(), eid, pids), players, startAt: 1 });
    expect(noNames(other)).not.toBe(noNames(a)); // and a different secret really draws differently
  });
});

describe("owner rules v1.1: no claim the game cannot keep", () => {
  const FORBIDDEN = /guarantee|100\s?%|bank-?grade|military-?grade|unhackable|hack-?proof|tamper-?proof|completely (safe|secure)|fully (safe|secure)|risk-?free|never fails?|certified|government[- ]approved|\bSEBI\b|\bRBI[- ]approved|money[- ]back|cannot be cheated|impossible to cheat/i;
  for (const f of SCREENS) test(`${f} makes none of the forbidden claims`, () => {
    expect(readableText(f).filter((t) => FORBIDDEN.test(t)).map((t) => t.slice(0, 80))).toEqual([]);
  });
});
