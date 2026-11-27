// TT-01 (gap plan 2026-10-29): while the service is in TEST mode the public pages must say plainly that the game is opening soon,
// so no stranger waits for a sign-in code that is never e-mailed. Only the three pages a stranger reads before signing in carry it; never the
// phone page, the big screen or the payment page. In LIVE there is no notice at all. Real page script (rum.js) in a DOM, real Worker code.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { newWorld, openPage, type Page } from "./harness";
import { setMode } from "../../edge/src/mode";

setDefaultTimeout(30_000);
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });
const tick = () => new Promise((r) => setTimeout(r, 40));

async function pageIn(mode: "TEST" | "LIVE", url: string, html: string) {
  const w = newWorld();
  if (mode === "TEST") await setMode(w.world.env as any, "TEST", "opening-soon test", w.world.now);
  const p = await openPage(w.world, { url, html, scripts: ["rum.js"] }); open.push(p);
  await tick(); await tick();
  return p;
}

describe("the Opening soon notice on public pages", () => {
  for (const [url, html] of [["http://localhost/", "index.html"], ["http://localhost/signin", "signin.html"], ["http://localhost/pricing", "pricing.html"]] as const) {
    test(`in TEST mode ${html} says the game is opening soon and that no sign-in code is e-mailed yet`, async () => {
      const p = await pageIn("TEST", url, html);
      const n = p.win.document.getElementById("opening-soon"); expect(n).toBeTruthy();
      expect(n.getAttribute("role")).toBe("status");
      expect(n.textContent).toMatch(/Opening soon/); expect(n.textContent).toMatch(/code/i);
      expect(n.textContent).not.toMatch(/private|engagement|TEST MODE/i); // owner wording rules; the console's own TEST MODE notice stays console-only
      expect(p.win.document.querySelectorAll("#opening-soon").length).toBe(1);
      expect(p.errors).toEqual([]);
    });
    test(`in LIVE mode ${html} has no notice`, async () => {
      const p = await pageIn("LIVE", url, html);
      expect(p.win.document.getElementById("opening-soon")).toBeNull();
      expect(p.errors).toEqual([]);
    });
  }
  test("the phone page, even in TEST mode, carries no notice", async () => {
    const p = await pageIn("TEST", "http://localhost/z", "z.html");
    expect(p.win.document.getElementById("opening-soon")).toBeNull();
  });
});
