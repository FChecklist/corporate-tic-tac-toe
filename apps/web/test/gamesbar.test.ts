// The Corporate Games bar: ONE shared component (canonical copy C:\ct\test-sites\corporate-games-bar). Every PUBLIC page loads it (not the play,
// console, pay or report pages); this copy is byte-identical to the canonical one; it shows the home mark and the six games with their badges,
// this site's game marked current; phones get the "All games" sheet.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Window } from "happy-dom";

const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const sha = (f: string) => createHash("sha256").update(readFileSync(new URL("../public/" + f, import.meta.url), "utf8").split(String.fromCharCode(13)).join("")).digest("hex"); // line endings do not count (git may check files out with CRLF)
const PUBLIC = ["index", "about", "contact", "legal", "terms", "refund-policy", "dpa", "subprocessors", "partner", "partner-terms", "organizer-guide", "pricing", "brochure", "404"];
const PRIVATE = ["z", "zc", "big", "host", "pay", "paylink", "paytest", "report", "signin", "demo", "owner-visits", "ai-link"];
const HOST = "tictactoe.corporatetambola.com", CURRENT = "Corporate Tic Tac Toe";

describe("the Corporate Games bar", () => {
  test("every public page loads it, no play / console / pay page does, and the build ships it", () => {
    for (const p of PUBLIC) expect([p, /src="\/gamesbar\.js(\?v=\d+)?"/.test(pub(p + ".html"))]).toEqual([p, true]);
    for (const p of PRIVATE.filter((x) => existsSync(new URL("../public/" + x + ".html", import.meta.url)))) expect([p, pub(p + ".html").includes("gamesbar")]).toEqual([p, false]);
    const b = readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8"); expect(b).toContain('"gamesbar.js"'); expect(b).toContain('"gamesbar.css"');
  });
  test("this copy is identical to the canonical Corporate Games bar (SHA-256 from corporate-games-bar/src/build.py)", () => {
    expect(sha("gamesbar.js")).toBe("29f8813c46b64e72bb90fad8dee2607cfa5c153eaaf2da8729cfc2d966e14a0e");
    expect(sha("gamesbar.css")).toBe("673c05ad2e10e53abf80f3af27629e94ab6faf132e216828af160deed71ee46b");
  });
  test("home first, then the six games with badge, CORPORATE line and proper name; this game current; no old hub, no 'private'", () => {
    const w = new Window({ url: `https://${HOST}/` }); const d = w.document;
    d.body.innerHTML = "<main>page</main>"; d.head.innerHTML = "";
    new Function("window", "document", "location", pub("gamesbar.js")).call(w, w, w.document, w.location);
    const bar = d.querySelector(".cgb")!; expect(bar).toBeTruthy();
    const row = [...bar.querySelectorAll(".cgb-home, .cgb-game")] as any[];
    expect(row.map((a) => [a.textContent, a.href])).toEqual([["Corporate Games", "https://home.corporatetambola.com/"], ["Corporate Tambola", "https://housie.corporatetambola.com/"], ["Corporate Bingo", "https://bingo.corporatetambola.com/"],
      ["Corporate Tic Tac Toe", "https://tictactoe.corporatetambola.com/"], ["Corporate Snakes and Ladders", "https://snakes.corporatetambola.com/"], ["Corporate Luck by Chance", "https://luck.corporatetambola.com/"], ["Corporate Lucky Draw", "https://home.corporatetambola.com/contact"]]);
    for (const a of row) { const id = a.querySelector("use").getAttribute("href"); expect(d.getElementById(id.slice(1))).toBeTruthy(); expect(a.querySelector(".cgb-corp").textContent).toBe("Corporate "); }
    expect([...bar.querySelectorAll('.cgb-game[aria-current="page"]')].map((a: any) => a.textContent)).toEqual([CURRENT]);
    expect(bar.querySelector(".cgb-line")!.textContent).toBe("Close group online engagement");
    expect(d.head.querySelector('link[href^="/gamesbar.css"]')).toBeTruthy();
    const btn = bar.querySelector(".cgb-all") as any, sheet = d.getElementById("cgb-sheet") as any;
    expect(btn.getAttribute("aria-controls")).toBe("cgb-sheet"); expect(sheet.hidden).toBe(true);
    btn.click(); expect(btn.getAttribute("aria-expanded")).toBe("true"); expect(sheet.hidden).toBe(false); expect(sheet.querySelectorAll(".cgb-tile").length).toBe(7);
    d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" })); expect(sheet.hidden).toBe(true); expect(btn.getAttribute("aria-expanded")).toBe("false");
    new Function("window", "document", "location", pub("gamesbar.js")).call(w, w, w.document, w.location); expect(d.querySelectorAll(".cgb").length).toBe(1); // loading it twice adds nothing
    expect(pub("gamesbar.js") + pub("gamesbar.css")).not.toMatch(/\bprivate\b|games\.corporatetambola\.com/i);
  });
});
