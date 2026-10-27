// A join that gets no answer (timeout or lost connection) or a "busy" answer is asked again by itself (found on the real site in a 250-player game: one phone lost its join call).
// The player's page (z.html + ttt.js + termsbox.js) runs in a simulated phone browser; the first join calls fail, the page retries on its own and the person gets in.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import TEXT from "../../edge/src/consent-text.json";
const K4: Record<string, string> = (TEXT as any).K4, VER: string = (TEXT as any).version;
const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

async function page(joinAnswer: (n: number) => Response | Promise<Response>) {
  const w: any = new Window({ url: "https://tictactoe.corporatetambola.com/z.html?e=GAME-1", width: 390, height: 780 });
  w.crypto = globalThis.crypto; w.__joinRetryMs = 20; // the real page waits 6 to 30 seconds; the test waits 20 ms
  let joins = 0;
  w.fetch = async (url: string) => {
    const u = String(url); const ok = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.includes("/api/consent/text")) return ok({ version: VER, kind: "K4", boxes: Object.entries(K4).map(([id, text]) => ({ id, text })) });
    if (u.endsWith("/info")) return ok({});
    if (u.endsWith("/join")) return joinAnswer(++joins);
    if (u.includes("/ttt/setup")) return ok({ eid: "GAME-1", state: "open", joined: 1, serverNow: Date.now(), commit: "ab".repeat(32), pauses: [] });
    return ok({}, 404);
  };
  w.document.body.innerHTML = '<main id="app"></main>';
  new Function("globalThis", pub("tttgame.js"))(w);
  for (const f of ["termsbox.js", "ttt.js"]) new Function("window", "document", "location", "localStorage", "fetch", "history", "navigator", "setTimeout", "clearTimeout", "setInterval", "clearInterval", pub(f))(w, w.document, w.location, w.localStorage, w.fetch, w.history, w.navigator, w.setTimeout.bind(w), w.clearTimeout.bind(w), w.setInterval.bind(w), w.clearInterval.bind(w));
  await tick(40);
  const d = w.document, W = w as any;
  for (const b of [...d.querySelectorAll('input[type="checkbox"]')] as any[]) { b.checked = true; b.dispatchEvent(new W.Event("change")); }
  const nm = d.getElementById("nm") as any; nm.value = "Asha"; nm.dispatchEvent(new W.Event("input")); await tick();
  (d.getElementById("go") as any).click();
  return { d, joins: () => joins };
}
const ok = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

describe("a join that gets no answer is asked again by itself", () => {
  test("the first join call fails with no answer at all; the page retries on its own", async () => {
    const p = await page((n) => (n === 1 ? Promise.reject(new TypeError("fetch failed")) : ok({ pid: "1x000000000001" })));
    await tick(300);
    expect(p.joins()).toBeGreaterThanOrEqual(2); // the second call is the page's own retry
    expect(p.d.body.textContent).not.toMatch(/Could not join/);
  });
  test("a 'busy' answer shows 'Many people are joining right now' and is asked again", async () => {
    const p = await page((n) => (n <= 2 ? ok({ error: "It is busy right now. Please try again in a few minutes.", code: "busy" }, 429) : ok({ pid: "1x000000000001" })));
    await tick(40); expect(p.d.body.textContent).toMatch(/Many people are joining right now/);
    await tick(300); expect(p.joins()).toBe(3);
  });
  test("any other refusal is shown at once and is not asked again", async () => {
    const p = await page(() => ok({ error: "This game is full.", code: "full" }, 409));
    await tick(300); expect(p.joins()).toBe(1); expect(p.d.body.textContent).toMatch(/This game is full/);
  });
});
