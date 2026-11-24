// TT-05 (gap plan 2026-10-29): "A square filled by itself, marks swapped, no explanation." After a drawn game the next game starts with the marks swapped and the page
// must say so; when a clock runs out and a square is played for someone, the page must say that too. Two real player pages (z.html + tttgame.js + ttt.js) play a board
// to the end against the real Worker code.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { newWorld, openPage, T, roundAt } from "./harness";
import { TttConsole } from "../../../packages/ttt/src/phone";

setDefaultTimeout(90_000);
const dev = (i: number) => i.toString(16).padStart(4, "0").repeat(8);
const START = roundAt(T) + 1200;

async function game(id: string) {
  const { world, api, json } = newWorld({ DATA_KEY: "k" });
  const org = await json(await api("POST", "/api/start", { email: "o@acme.com" })); const key = org.token as string;
  expect((await api("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, key)).status).toBe(200);
  expect((await api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, key)).status).toBe(200);
  world.raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]);
  const ps: { pid: string; device: string }[] = [];
  for (const [i, name] of [[1, "Asha"], [2, "Ravi"]] as const) { const r = await api("POST", `/api/z/${id}/join`, { name, device: dev(i) }); expect(r.status).toBe(200); ps.push({ pid: (await json(r)).pid, device: dev(i) }); }
  expect((await api("POST", `/api/z/${id}/ttt/start`, { moveSecs: 20 }, key)).status).toBe(200);
  const con = new TttConsole(async (m, p, b) => { const r = await api(m, p, b, key); const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error), { status: r.status, code: j.code, body: j }); return j; }, id);
  expect((await con.tick()).sentPlan).toBe(true);
  return { world, ps };
}
const openFor = (world: any, id: string, p: { pid: string; device: string }) => openPage(world, {
  url: `http://localhost/z.html?e=${id}`, html: "z.html", scripts: ["termsbox.js", "tttgame.js", "ttt.js"],
  afterLoad: (win: any, file: string) => {
    if (file === "termsbox.js") { win.crypto = globalThis.crypto; win.structuredClone = structuredClone; win.localStorage.setItem(`ttt:${id}:pid`, p.pid); win.localStorage.setItem("ttt:device", p.device); }
    if (file === "tttgame.js" && !win.TTT) win.TTT = (globalThis as any).TTT;
  },
});

describe("the player page explains what changed by itself", () => {
  test("after a drawn game the next game says the marks are swapped and which mark you now play", async () => {
    const { world, ps } = await game("NT-1");
    const a = await openFor(world, "NT-1", ps[0]!), b = await openFor(world, "NT-1", ps[1]!);
    try {
      await a.waitFor((t) => /Your turn|Waiting for/.test(t), 9000); await b.waitFor((t) => /Your turn|Waiting for/.test(t), 9000);
      const x = a.text().includes("Your turn") ? a : b, o = x === a ? b : a; // x plays X first in game 1
      expect(x.text()).not.toMatch(/this game starts with the marks swapped/); // nothing to explain yet
      // X: 0 2 7 3 8, O: 1 4 6 5 gives a full board with no line: a draw
      for (const [sq, who] of [[0, x], [1, o], [2, x], [4, o], [7, x], [6, o], [3, x], [5, o], [8, x]] as const) {
        await who.waitFor((t) => t.includes("Your turn"), 9000);
        who.click(`.tsq[data-i="${sq}"]`);
      }
      await x.waitFor((t) => /this game starts with the marks swapped/.test(t), 9000); await o.waitFor((t) => /this game starts with the marks swapped/.test(t), 9000);
      expect(x.text()).toMatch(/You now play O/); expect(o.text()).toMatch(/You now play X/);
      expect(x.errors).toEqual([]); expect(o.errors).toEqual([]);
    } finally { await a.close(); await b.close(); }
  });

  test("when a clock runs out and a square is played for someone, both pages say so", async () => {
    const { world, ps } = await game("NT-2");
    const a = await openFor(world, "NT-2", ps[0]!), b = await openFor(world, "NT-2", ps[1]!);
    try {
      await a.waitFor((t) => /Your turn|Waiting for/.test(t), 9000); await b.waitFor((t) => /Your turn|Waiting for/.test(t), 9000);
      const x = a.text().includes("Your turn") ? a : b, o = x === a ? b : a;
      expect(x.text()).not.toMatch(/time ran out/i);
      world.now += 40_000; // X does nothing for longer than the 20-second clock (plus the first-move allowance)
      await o.waitFor((t) => /Time ran out for (Asha|Ravi), so a square was played for them/.test(t), 15000);
      await x.waitFor((t) => /Your time ran out, so a square was played for you/.test(t), 15000);
    } finally { await a.close(); await b.close(); }
  });
});
