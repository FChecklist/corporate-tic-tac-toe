// The big screen says so when the server does not answer (a lost connection must not look like "nothing is happening"): a red bar after 15 seconds without an answer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
/** Waits for the condition itself (polls every 2 ms) and fails with a clear message at the limit; no fixed sleep decides the result. */
const until = async (what: string, pred: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting for: " + what); await tick(2); } };

async function bigScreen(fetchImpl: (u: string) => Promise<Response>) {
  const w: any = new Window({ url: "https://tictactoe.corporatetambola.com/big.html?e=GAME-1", width: 1280, height: 720 });
  w.crypto = globalThis.crypto; w.__lostMs = 0; // the real page waits 15 seconds
  w.fetch = (u: any) => fetchImpl(String(u));
  w.document.body.innerHTML = '<main id="app"></main>';
  new Function("globalThis", pub("tttgame.js"))(w);
  new Function("window", "document", "location", "localStorage", "fetch", "history", "navigator", "setTimeout", "clearTimeout", "setInterval", "clearInterval", pub("big.js"))(w, w.document, w.location, w.localStorage, w.fetch, w.history, w.navigator, w.setTimeout.bind(w), w.clearTimeout.bind(w), w.setInterval.bind(w), w.clearInterval.bind(w));
  await until("the big screen has drawn something", () => String(w.document.body.textContent ?? "").trim().length > 0 || !!w.document.querySelector("#app > *"));
  return w.document;
}

describe("big screen: connection lost", () => {
  test("no answer at all shows the red 'Connection lost' bar", async () => {
    const d = await bigScreen(() => Promise.reject(new TypeError("fetch failed")));
    await until("the red bar appears", () => !!d.querySelector(".lostbar"));
    expect(d.querySelector(".lostbar")?.textContent).toMatch(/Connection lost/);
  });
  test("an answer from the server (even a refusal) is not a lost connection", async () => {
    const d = await bigScreen(async () => new Response(JSON.stringify({ error: "x" }), { status: 404 }));
    await until("the page says what the server answered", () => /not found/i.test(String(d.body.textContent)));
    expect(d.querySelector(".lostbar")).toBeNull(); expect(d.body.textContent).toMatch(/not found/i);
  });
});
