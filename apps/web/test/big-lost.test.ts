// The big screen says so when the server does not answer (a lost connection must not look like "nothing is happening"): a red bar after 15 seconds without an answer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

async function bigScreen(fetchImpl: (u: string) => Promise<Response>) {
  const w: any = new Window({ url: "https://tictactoe.corporatetambola.com/big.html?e=GAME-1", width: 1280, height: 720 });
  w.crypto = globalThis.crypto; w.__lostMs = -1; // the real page waits 15 seconds; the test shows the bar at once (0 failed when the first failure came in the same millisecond as the load: 0 > 0 is false)
  w.fetch = (u: any) => fetchImpl(String(u));
  w.document.body.innerHTML = '<main id="app"></main>';
  new Function("globalThis", pub("tttgame.js"))(w);
  new Function("window", "document", "location", "localStorage", "fetch", "history", "navigator", "setTimeout", "clearTimeout", "setInterval", "clearInterval", pub("big.js"))(w, w.document, w.location, w.localStorage, w.fetch, w.history, w.navigator, w.setTimeout.bind(w), w.clearTimeout.bind(w), w.setInterval.bind(w), w.clearInterval.bind(w));
  await tick(80);
  return w.document;
}

describe("big screen: connection lost", () => {
  test("no answer at all shows the red 'Connection lost' bar", async () => {
    const d = await bigScreen(() => Promise.reject(new TypeError("fetch failed")));
    expect(d.querySelector(".lostbar")?.textContent).toMatch(/Connection lost/);
  });
  test("an answer from the server (even a refusal) is not a lost connection", async () => {
    const d = await bigScreen(async () => new Response(JSON.stringify({ error: "x" }), { status: 404 }));
    expect(d.querySelector(".lostbar")).toBeNull(); expect(d.body.textContent).toMatch(/not found/i);
  });
});
