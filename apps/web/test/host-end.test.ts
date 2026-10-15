// O7: the run-the-tournament page (host.html + host.js) offers "End the tournament" while it is running, asks first, sends one signed-in request, and shows "Ended" afterwards.
// The page script runs in a DOM with a stand-in for the Worker's answers; the Worker route itself is tested in apps/edge/test/end-game.test.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function hostPage(view: () => Record<string, unknown>, sure = true) {
  const w: any = new Window({ url: "https://tictactoe.corporatetambola.com/host.html?e=GAME-1", width: 900, height: 800 });
  const sent: { url: string; method: string; headers: any }[] = [];
  const asked: string[] = [];
  w.fetch = async (url: string, init: any = {}) => {
    const u = String(url); sent.push({ url: u, method: init.method ?? "GET", headers: init.headers });
    const ok = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.endsWith("/ttt/view")) return ok(view());
    if (u.endsWith("/ttt/end")) return ok({ ok: true, ended: true });
    return ok({}, 404);
  };
  w.confirm = (m: string) => { asked.push(m); return sure; };
  w.sessionStorage.setItem("cbz-org", "cbk_" + "a".repeat(48));
  w.document.body.innerHTML = '<main id="app"></main>';
  new Function("window", "document", "location", "sessionStorage", "fetch", "history", "confirm", "setTimeout", "clearTimeout", "setInterval", "clearInterval", pub("host.js"))(w, w.document, w.location, w.sessionStorage, w.fetch, w.history, w.confirm, setTimeout, clearTimeout, () => 0, () => {});
  await tick(40);
  return { w, d: w.document, sent, asked };
}
const running = () => ({ state: "running", serverNow: Date.now(), joined: 8, players: 8, rounds: 3, paused: false, commit: "ab".repeat(32), endedEarly: false });

describe("the End control on the run page", () => {
  test("a running tournament shows End the tournament; pressing it asks first, then sends the request with the organizer's key", async () => {
    const { d, sent, asked } = await hostPage(running);
    const btn = d.getElementById("end"); expect(btn).toBeTruthy(); expect(btn!.textContent).toMatch(/End the tournament/);
    expect(d.body.textContent).toMatch(/Nobody is ranked and this cannot be undone/);
    btn!.dispatchEvent(new (d.defaultView as any).MouseEvent("click", { bubbles: true })); await tick(40);
    expect(asked.length).toBe(1); expect(asked[0]).toMatch(/End the tournament for everybody now/);
    const post = sent.find((s) => s.url.endsWith("/ttt/end"))!; expect(post.method).toBe("POST"); expect(post.headers["x-organizer"]).toMatch(/^cbk_/);
  });
  test("if the organizer says no, nothing is sent", async () => {
    const { d, sent, asked } = await hostPage(running, false);
    d.getElementById("end")!.dispatchEvent(new (d.defaultView as any).MouseEvent("click", { bubbles: true })); await tick(40);
    expect(asked.length).toBe(1); expect(sent.some((s) => s.url.endsWith("/ttt/end"))).toBe(false);
  });
  test("a tournament that was ended shows Ended and no End button; one that was played out shows Finished; before the start there is no End button", async () => {
    const ended = await hostPage(() => ({ ...running(), state: "done", endedEarly: true }));
    expect(ended.d.querySelector("h2")!.textContent).toBe("Ended"); expect(ended.d.getElementById("end")).toBeNull();
    const fin = await hostPage(() => ({ ...running(), state: "done", champion: "Maya" }));
    expect(fin.d.querySelector("h2")!.textContent).toBe("Finished");
    const open = await hostPage(() => ({ state: "open", serverNow: Date.now(), joined: 3, commit: "ab".repeat(32) }));
    expect(open.d.getElementById("end")).toBeNull();
  });
});
