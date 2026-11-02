// The Corporate Games bar (version 2, the shared copy): every public page loads it with the game named, no play / console / pay page does, and the bar has the six games and the home mark, Tic Tac Toe current.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const PUBLIC = ["index", "how-it-works", "about", "contact", "legal", "terms", "privacy", "legal-position", "refund-policy", "dpa", "subprocessors", "partner", "partner-terms", "helpdesk", "organizer-guide", "pricing", "brochure", "trust", "404", "offline", "signin"];
const NOT_PUBLIC = ["z", "zc", "big", "host", "pay", "paylink", "paytest", "report", "demo", "owner-visits", "ai-link"];
const GAME_LINKS = ["https://housie.corporatetambola.com/", "https://bingo.corporatetambola.com/", "https://tictactoe.corporatetambola.com/", "https://snakes.corporatetambola.com/", "https://luck.corporatetambola.com/", "https://home.corporatetambola.com/contact"];

describe("the Corporate Games bar", () => {
  test("every public page loads it for Tic Tac Toe, no play / console / pay page does, and the build ships it", () => {
    for (const p of PUBLIC) expect([p, /<script src="\/gamesbar\.js\?v=\d+" defer data-game="tictactoe"><\/script>/.test(pub(p + ".html"))]).toEqual([p, true]);
    for (const p of NOT_PUBLIC) expect([p, pub(p + ".html").includes("gamesbar")]).toEqual([p, false]);
    const b = readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8"); expect(b).toContain('"gamesbar.js"'); expect(b).toContain('"gamesbar.css"');
  });
  test("the bar shows the home mark and the six games, Tic Tac Toe is current, it mounts after the skip link, and it never names the old hub", async () => {
    const w = new Window({ url: "https://tictactoe.corporatetambola.com/" }); const d = w.document;
    d.body.innerHTML = '<a class="ck-skip" href="#main">Skip to the content</a><main id="main">page</main>'; d.head.innerHTML = "";
    new Function("window", "document", "with (window) {" + pub("gamesbar.js") + "}").call(w, w, w.document);
    const bar = d.querySelector(".cgb")!; expect(d.body.firstElementChild!.className).toBe("ck-skip"); expect(d.body.children[1]).toBe(d.querySelector(".cgb-sprite")); expect(d.body.children[2]).toBe(bar);
    expect((bar.querySelector(".cgb-home") as any).href).toBe("https://home.corporatetambola.com/");
    expect([...bar.querySelectorAll(".cgb-row a")].map((a: any) => a.href)).toEqual(GAME_LINKS);
    expect([...bar.querySelectorAll(".cgb-row a")].map((a: any) => a.textContent)).toEqual(["Corporate Tambola", "Corporate Bingo", "Corporate Tic Tac Toe", "Corporate Snakes and Ladders", "Corporate Luck by Chance", "Corporate Lucky Draw"]);
    expect(bar.querySelectorAll('.cgb-row [aria-current="page"]').length).toBe(1); expect((bar.querySelector('.cgb-row [aria-current="page"]') as any).dataset.game).toBe("tictactoe");
    expect(bar.querySelector(".cgb-line")!.textContent).toBe("Close group online engagement");
    expect(bar.textContent).not.toMatch(/private/i); expect(bar.innerHTML).not.toContain("games.corporatetambola.com");
    new Function("window", "document", "with (window) {" + pub("gamesbar.js") + "}").call(w, w, w.document); expect(d.querySelectorAll(".cgb").length).toBe(1); // loading it twice adds nothing
  });
});
