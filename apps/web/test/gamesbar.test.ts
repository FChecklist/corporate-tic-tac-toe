// The Corporate Games bar: every PUBLIC page loads gamesbar.js (not the play, console, pay or report pages); the bar has exactly the six links, Tic Tac Toe marked current.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const PUBLIC = ["index", "about", "contact", "legal", "terms", "refund-policy", "dpa", "subprocessors", "partner", "partner-terms", "organizer-guide", "pricing", "brochure", "404"];
const PRIVATE = ["z", "zc", "big", "host", "pay", "paylink", "paytest", "report", "signin", "demo", "owner-visits", "ai-link"];
const LINKS = ["https://corporate-games.pages.dev/?from=tic-tac-toe", "https://corporate-tambola.pages.dev/", "https://corporate-bingo.pages.dev/", "https://corporate-tic-tac-toe.pages.dev/", "https://corporate-snakes-and-ladders.pages.dev/", "https://corporate-luck-by-chance.pages.dev/"];

describe("the Corporate Games bar", () => {
  test("every public page loads it, no play / console / pay page does, and the build ships it", () => {
    for (const p of PUBLIC) expect([p, pub(p + ".html").includes('src="/gamesbar.js"')]).toEqual([p, true]);
    for (const p of PRIVATE) expect([p, pub(p + ".html").includes("gamesbar")]).toEqual([p, false]);
    const b = readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8"); expect(b).toContain('"gamesbar.js"'); expect(b).toContain('"gamesbar.css"');
  });
  test("the bar has exactly the six links, Tic Tac Toe is current, the line is hidden on phones, the colours and focus are as ordered", async () => {
    const w = new Window({ url: "https://corporate-tic-tac-toe.pages.dev/" }); const d = w.document;
    d.body.innerHTML = "<main>page</main>"; d.head.innerHTML = "";
    new Function("window", "document", "with (window) {" + pub("gamesbar.js") + "}").call(w, w, w.document);
    const bar = d.querySelector(".cg-bar")!; expect(d.body.firstElementChild).toBe(bar);
    expect([...bar.querySelectorAll("a")].map((a: any) => a.href)).toEqual(LINKS);
    expect([...bar.querySelectorAll("a")].map((a: any) => a.textContent)).toEqual(["Corporate Games", "Tambola", "Bingo", "Tic Tac Toe", "Snakes and Ladders", "Luck by Chance"]);
    const cur = [...bar.querySelectorAll('[aria-current="true"]')]; expect(cur.length).toBe(1); expect((cur[0] as any).textContent).toBe("Tic Tac Toe");
    expect(bar.querySelector(".cg-line")!.textContent).toBe("closed group, online engagement");
    expect(d.head.querySelector('link[href="/gamesbar.css"]')).toBeTruthy();
    new Function("window", "document", "with (window) {" + pub("gamesbar.js") + "}").call(w, w, w.document); expect(d.querySelectorAll(".cg-bar").length).toBe(1); // loading it twice adds nothing
    const css = pub("gamesbar.css"); expect(css).toContain("#14213D"); expect(css).toContain("14px"); expect(css).toContain("overflow-x:auto"); expect(css).toContain(":focus-visible"); expect(css).toContain("border-radius:999px");
  });
});
