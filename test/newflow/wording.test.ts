// W*: wording guard. No 'private' in anything a player reads, English only, and the retention line exactly as the owner wrote it.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MSG, NO_PERSONAL_DETAILS, guardOk } from "../../vendor/game-core/packages/wording/src";
import { REACTIONS } from "../../vendor/game-core/packages/ui/src/reactions";

const LINE = "No personal details needed. All participant information is deleted within 24 hours of the game.";
const pub = (f: string) => readFileSync(new URL(`../../apps/web/public/${f}`, import.meta.url), "utf8");
const stripC = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
/** What a person reads in a page: the HTML without scripts, styles and tags. */
const visible = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ").replace(/&rsquo;|&lsquo;/g, "'").replace(/&[a-z#0-9]+;/gi, " ");
/** The text in the quotes of a script (the strings a player can see). */
const strings = (js: string) => [...stripC(js).matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "").join("\n");
const PLAYER_PAGES = ["big.html", "host.html", "index.html", "how-it-works.html", "guide.html"];
const PLAYER_SCRIPTS = ["ttt.js", "tttstage.js", "big.js", "host.js"];
const nonLatinLetters = (t: string) => [...t].filter((c) => /\p{L}/u.test(c) && !/\p{Script=Latin}/u.test(c));

describe("W1 no 'private'", () => {
  test("W1: the shared wording of the core has no 'private' (and no 'engagement')", () => {
    for (const m of Object.values(MSG)) expect(guardOk(m)).toBe(true); expect(guardOk(NO_PERSONAL_DETAILS)).toBe(true);
  });
  test("W1b: no reaction text has 'private'", () => { for (const r of REACTIONS) expect(/\bprivate\b/i.test(r.text)).toBe(false); });
  test("W1c: the strings of the player scripts have no 'private' (code comments are not read by players)", () => {
    for (const f of PLAYER_SCRIPTS) expect([f, /\bprivate\b/i.test(strings(pub(f)))]).toEqual([f, false]);
  });
  test("W1d: the text of the player pages has no 'private'", () => {
    for (const f of PLAYER_PAGES) expect([f, /\bprivate\b/i.test(visible(pub(f)))]).toEqual([f, false]);
  });
  test("W1e: no page of the site says 'private' to a reader (the legal page too: say 'close group')", () => {
    const bad: string[] = []; for (const f of new Bun.Glob("*.html").scanSync({ cwd: new URL("../../apps/web/public/", import.meta.url).pathname })) if (/\bprivate\b/i.test(visible(pub(f)))) bad.push(f);
    expect(bad).toEqual([]);
  });
  test("W1f: the new flow's own strings never use the word 'engagement'", () => { expect(/\bengagements?\b/i.test(strings(pub("tttstage.js")))).toBe(false); });
});

describe("W2 English only", () => {
  test("W2: the core wording, the reactions and the stage player script have only Latin letters", () => {
    expect(nonLatinLetters(Object.values(MSG).join(" ") + NO_PERSONAL_DETAILS)).toEqual([]);
    expect(nonLatinLetters(REACTIONS.map((r) => r.text).join(" "))).toEqual([]);
    expect(nonLatinLetters(strings(pub("tttstage.js")))).toEqual([]);
  });
  test("W2b: the player pages of the game have only Latin letters in what is read", () => {
    for (const f of ["big.html", "host.html"]) expect([f, nonLatinLetters(visible(pub(f)))]).toEqual([f, []]);
    for (const f of ["ttt.js", "big.js", "host.js"]) expect([f, nonLatinLetters(strings(pub(f)))]).toEqual([f, []]);
  });
});

describe("W3 the retention line", () => {
  test("W3: the owner's line is exactly: " + LINE, () => { expect(NO_PERSONAL_DETAILS).toBe(LINE); });
  test("W3b: the player page of the game shows the line, word for word", () => {
    const shown = PLAYER_SCRIPTS.map((f) => strings(pub(f))).join("\n") + PLAYER_PAGES.map((f) => visible(pub(f))).join("\n");
    expect(shown.includes(LINE)).toBe(true);
  });
  test("W3c: wherever the page says 'deleted within 24 hours' to a player it is this one line, not another sentence", () => {
    const texts = PLAYER_SCRIPTS.map((f) => strings(pub(f))).concat(["big.html", "host.html"].map((f) => visible(pub(f))));
    for (const t of texts) for (const m of t.matchAll(/[^.\n]*deleted within 24 hours[^.\n]*\./g)) expect(`No personal details needed. ${m[0].trim()}`.includes(LINE) || m[0].trim() === LINE.split(". ")[1] + ".").toBe(true);
  });
  test("W3d: the line has no variant spelling anywhere in the core wording (one source)", () => {
    const src = readFileSync(new URL("../../vendor/game-core/packages/wording/src/index.ts", import.meta.url), "utf8");
    expect(src.split(LINE).length - 1).toBe(1);
  });
});
