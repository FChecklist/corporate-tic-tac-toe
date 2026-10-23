// D1 / D2 / D11: the data map is complete, the join notice says exactly what the data map says the game asks for, the player page asks for exactly that,
// and the statement of where the data is (and is not) kept is the one the pages carry.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import TEXT from "../src/consent-text.json";

const ROOT = join(import.meta.dir, "../../..");
const PLAYER_SCRIPTS = ["ttt.js"]; // the scripts that draw the join screen a player fills in
const doc = readFileSync(join(ROOT, "docs/PRIVACY_AND_LIFECYCLE.md"), "utf8").replace(/\r\n/g, "\n");
const pub = (f: string) => readFileSync(join(ROOT, "apps/web/public", f), "utf8");
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&rsquo;|&#39;/g, "'").replace(/\s+/g, " ");

const block = /<!-- notice:start -->\n([\s\S]*?)\n<!-- notice:end -->/.exec(doc);
const lists = (() => {
  const out: Record<string, string[]> = {};
  for (const line of (block?.[1] ?? "").split("\n")) { const m = /^(\w+):\s*(.*)$/.exec(line.trim()); if (m) out[m[1]!] = m[2]!.split(",").map((s) => s.trim()).filter((s) => s && s !== "none"); }
  return out;
})();
const always = lists.asked_from_player ?? [], sometimes = lists.asked_if_organizer_switches_on ?? [];
const FIELDS: [string, RegExp][] = [["name", /\bname\b/i], ["mobile number", /mobile number|phone number|\bphone\b/i], ["e-mail", /e-?mail/i], ["address", /\baddress\b/i], ["photo", /\bphoto\b|\bpicture\b/i], ["employee ID", /employee id/i]];

describe("D1: the data map", () => {
  test("it exists, with the player notice block, and says why, where and who for every field", () => {
    expect(block).not.toBeNull();
    const sec2 = doc.slice(doc.indexOf("## 2. The data map"), doc.indexOf("## 3. Who processes"));
    expect(sec2.length).toBeGreaterThan(2000);
    const rows = sec2.split("\n").filter((l) => l.startsWith("|") && !/^\|[-| ]+\|$/.test(l));
    const body = rows.filter((l) => !/^\| (Field|Data) \|/.test(l));
    expect(body.length).toBeGreaterThan(30);
    for (const l of body) {
      const cells = l.split("|").slice(1, -1).map((c) => c.trim());
      expect(cells.length >= 4 && cells.every((c) => c.length > 0)).toBe(true); // field, why, where stored, who (and how long): none empty
    }
    for (const part of sec2.split(/\n(?=### )/)) { // every table says why; every table says who holds it, except 2b (what the player's own phone keeps)
      for (const head of part.split("\n").filter((l) => /^\| (Field|Data) \|/.test(l))) { expect(head).toMatch(/Why/); if (!/^### 2b/.test(part)) expect(head).toMatch(/Who/); }
    }
  });
  test("it names every processor the sub-processors page names", () => {
    const subs = plain(pub("subprocessors.html"));
    for (const p of ["Cloudflare", "Resend", "Razorpay", "Google"]) { expect(subs).toContain(p); expect(doc).toContain(p); }
  });
});

describe("D2: the notice and the data map agree", () => {
  const notice = String((TEXT as any).K4?.A ?? "");
  test("every field the data map says the player is asked for is in the notice, and the notice names no other personal field", () => {
    for (const [name, re] of FIELDS) {
      const listed = always.includes(name) || sometimes.includes(name);
      expect([name, re.test(notice)]).toEqual([name, listed]);
    }
  });
  test("a field asked only when the organizer switches it on is worded as conditional in the notice", () => {
    for (const f of sometimes) { const re = FIELDS.find(([n]) => n === f)![1]; expect(re.test(notice)).toBe(true); expect(notice).toMatch(/only if|if this game asks|only when/i); }
  });
  test("the player page asks for exactly the fields the data map lists (a mobile number field exists only if it is listed)", () => {
    const code = PLAYER_SCRIPTS.map(pub).join("\n");
    const asksNumber = /id="ph"|type="tel"|name="phone"|id="phone"/.test(code);
    expect(asksNumber).toBe(always.includes("mobile number") || sometimes.includes("mobile number"));
    expect(/id="nm"|id="name"|name="name"/.test(code)).toBe(always.includes("name"));
    expect(/type="email"|id="email"|name="email"/.test(code)).toBe(false);
  });
  test("the box wording the server sends is the one the page script carries (no second wording)", () => {
    if (notice && existsSync(join(ROOT, "apps/web/public/consent.js")) && /\bK4:\s*\{/.test(pub("consent.js"))) { expect(pub("consent.js").includes(notice)).toBe(true); } // a game whose page fetches the wording from the server has no second copy
  });
});

describe("D11: where the data is, and no backup claim", () => {
  test("the legal pages say where: Cloudflare's global network for the website and its Asia-Pacific region for the database", () => {
    for (const f of ["subprocessors.html", "legal.html"]) { const t = plain(pub(f)); expect(t).toMatch(/Asia-Pacific/); expect(t).toMatch(/global network/); }
    expect(doc).toMatch(/Asia-Pacific/);
  });
  test("no page, e-mail, report or console text promises a backup period (no backup process exists)", () => {
    const files = ["legal.html", "terms.html", "dpa.html", "subprocessors.html", "trust.html", "index.html", "zc.js", "reportgen.js"].map((f) => [f, pub(f)] as const)
      .concat([["lifecycle.ts", readFileSync(join(ROOT, "apps/edge/src/lifecycle.ts"), "utf8")], ["report-layout.ts", readFileSync(join(ROOT, "apps/edge/src/report-layout.ts"), "utf8")], ["ai-facts.ts", readFileSync(join(ROOT, "apps/edge/src/ai-facts.ts"), "utf8")]]);
    for (const [f, t] of files) expect([f, /backups?\b[^.]{0,80}(roll off|overwritten|clear)|(roll off|overwritten)[^.]{0,60}backups?/i.test(plain(t))]).toEqual([f, false]);
    expect(doc).toMatch(/no backup of our own/i);
  });
});
