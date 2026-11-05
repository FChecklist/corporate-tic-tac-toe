// TT-30 (gap plan 2026-10-29): a Host who opens the run-the-tournament page in a NEW tab was told "Sign in first", because host.js read only this tab's session store
// while the console keeps the sign-in key in the long-lived store (keep.js, window.CTK). The run page now reads the same store as the console.
// The page script runs in a DOM with a stand-in for the Worker's answers; the Worker route itself is tested elsewhere.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const KEY = "cbk_" + "a".repeat(48);

/** Opens host.html's script the way a browser does. `inLocal` puts the key in the long-lived store only (what a second tab sees), `inSession` in this tab's store only. */
async function hostPage(o: { inLocal?: boolean; inSession?: boolean; withKeep?: boolean }) {
  const w: any = new Window({ url: "https://tictactoe.corporatetambola.com/host.html?e=GAME-1", width: 900, height: 800 });
  const sent: { url: string; headers?: any }[] = [];
  w.fetch = async (url: string, init: any = {}) => {
    sent.push({ url: String(url), headers: init.headers });
    return new Response(JSON.stringify(String(url).endsWith("/ttt/view") ? { state: "running", serverNow: Date.now(), joined: 8, players: 8, rounds: 3, paused: false, commit: "ab".repeat(32), endedEarly: false } : {}), { status: 200 });
  };
  if (o.inLocal) w.localStorage.setItem("cbz-org", KEY);
  if (o.inSession) w.sessionStorage.setItem("cbz-org", KEY);
  w.document.body.innerHTML = '<main id="app"></main>';
  const names = ["window", "document", "location", "sessionStorage", "localStorage", "fetch", "history", "confirm", "setTimeout", "clearTimeout", "setInterval", "clearInterval"];
  const args = [w, w.document, w.location, w.sessionStorage, w.localStorage, w.fetch, w.history, () => true, setTimeout, clearTimeout, (() => 0) as any, clearInterval];
  if (o.withKeep !== false) new Function(...names, pub("keep.js"))(...args);
  new Function(...names, pub("host.js"))(...args);
  await tick(60);
  return { d: w.document, sent };
}

describe("the run page and the sign-in store (TT-30)", () => {
  test("host.html loads keep.js (the shared sign-in store) before host.js", () => {
    const h = pub("host.html"); expect(h).toContain('src="/keep.js"'); expect(h.indexOf('src="/keep.js"')).toBeLessThan(h.indexOf('src="/host.js"'));
  });
  test("a new tab (key only in the long-lived store) is signed in: no 'Sign in first', and the request carries the key", async () => {
    const { d, sent } = await hostPage({ inLocal: true });
    expect(d.body.textContent).not.toMatch(/Sign in first/);
    d.getElementById("end")!.dispatchEvent(new (d.defaultView as any).MouseEvent("click", { bubbles: true })); await tick(40); // a button that needs the key
    const post = sent.find((x) => x.url.endsWith("/ttt/end")); expect(post).toBeTruthy(); expect(post!.headers["x-organizer"]).toBe(KEY);
  });
  test("a key held by this tab only still works, and no key at all still says Sign in first", async () => {
    const a = await hostPage({ inSession: true }); expect(a.d.body.textContent).not.toMatch(/Sign in first/);
    const b = await hostPage({}); expect(b.d.body.textContent).toMatch(/Sign in first/); expect(b.sent.some((s) => s.url.endsWith("/ttt/view"))).toBe(false);
  });
});
