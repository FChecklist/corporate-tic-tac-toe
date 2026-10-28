// Landing refresh (owner, 2026-10-29): the hero asks the engagement question, offers the two buttons, and the "Choose your game" row links all six places.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const GAME = "Tic Tac Toe", DEMO = true;
const doc = () => { const w = new Window({ url: "https://tictactoe.corporatetambola.com/" }); w.document.write(html); return w.document; };

describe("landing page hero", () => {
  test("the headline is the engagement question and the sub line follows it", () => {
    const d = doc();
    expect(d.querySelector("h1#h1")!.textContent!.replace(/\s+/g, " ").trim()).toBe(`This week, which teams will you engage with a close group online ${GAME}?`);
    expect(d.querySelector(".lp-sub")!.textContent).toBe("Close group online engagement of employees and associates.");
  });
  test("two buttons: the free 10-person game only where this game has a demo, then Sign in or start", () => {
    const a = [...doc().querySelectorAll(".lp-cta a")] as any[];
    expect(a.map((x) => x.textContent)).toEqual([DEMO ? "Try a free game with 10 people" : "Start your game", "Sign in or start"]);
    expect(a[0].getAttribute("href")).toBe(DEMO ? "/zc.html?demo=1" : "/signin.html"); expect(a[1].getAttribute("href")).toBe("/signin.html");
  });
  test("Choose a game for your close group: the six links, in order, each with its own badge drawn on the page (no outside request), this game marked current", () => {
    const d = doc(); const a = [...d.querySelectorAll(".lp-choose a")] as any[];
    expect(a.map((x) => [x.textContent.trim(), x.getAttribute("href")])).toEqual([
      ["Corporate Tambola", "https://housie.corporatetambola.com/"], ["Corporate Bingo", "https://bingo.corporatetambola.com/"], ["Corporate Tic Tac Toe", "https://tictactoe.corporatetambola.com/"],
      ["Corporate Snakes and Ladders", "https://snakes.corporatetambola.com/"], ["Corporate Luck by Chance", "https://luck.corporatetambola.com/"], ["All games", "https://home.corporatetambola.com/"]]);
    for (const x of a) { const id = x.querySelector("use")!.getAttribute("href"); expect(id).toMatch(/^#gb-/); expect(d.querySelector(id)).toBeTruthy(); }
    expect(a.filter((x) => x.getAttribute("aria-current") === "page").map((x) => x.textContent.trim())).toEqual([`Corporate ${GAME}`]);
    expect(d.querySelector(".lp-choose p")!.textContent).toBe("Choose a game for your close group"); expect(d.querySelector(".lp-hero .eyebrow")!.textContent).toBe("For HR teams and managers");
    expect(d.querySelector(".snav .brand .gn")!.textContent).toBe(`Corporate ${GAME}`); expect(html).not.toMatch(/event managers/i);
  });
  test("the site's own menu uses the same labels as every Corporate Games site", () => {
    const a = [...doc().querySelectorAll(".snav .links a")] as any[];
    expect(a.map((x) => x.textContent)).toEqual(["How it works", "For HR teams", "Data and privacy", "Contact", "Sign in", ...(DEMO ? ["Try a free game with 10 people"] : [])]);
    expect(a.map((x) => x.getAttribute("href")).slice(1, 5)).toEqual(["https://home.corporatetambola.com/for-hr", "https://home.corporatetambola.com/privacy", "https://home.corporatetambola.com/contact", "/signin.html"]);
  });
  test("trust list, contact on the first screen, and none of the banned wording", () => {
    const d = doc(); expect(d.querySelector("#th")!.textContent).toBe("What you can count on");
    const f = [...d.querySelectorAll(".lp-facts li")].map((x: any) => x.textContent);
    expect(f).toContain("Players never pay."); expect(f).toContain("Only the people you invite can join."); expect(f).toContain("No app to install."); expect(f).toContain("Player details are erased within 24 hours.");
    expect(f.includes(`A free ${GAME} demo for 10 people.`)).toBe(DEMO);
    const c = d.querySelector(".lp-contact")!.innerHTML; expect(c).toContain("hello@corporatetambola.com"); expect(c).toContain("(+91) 96503 97480");
    expect(html).not.toMatch(/\bprivate\b|live now|coming soon/i);
    expect(html).toMatch(/href="\/site\.css\?v=\d+"/);
  });
});
