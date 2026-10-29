// TT-26 (gap plan 2026-10-29): "Two Rahuls; told I won when the other won". Two players join with the SAME name and play a board to the end on their own pages
// (z.html + tttgame.js + ttt.js, wired straight to the real Worker code). Only the winner's page may say "You won"; the other page must say the board is over,
// and while it is the other player's move the page must not claim it is "Waiting for Rahul" without saying which Rahul.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { newWorld, openPage, T, roundAt } from "./harness";
import { TttConsole } from "../../../packages/ttt/src/phone";

setDefaultTimeout(60_000);
const dev = (i: number) => i.toString(16).padStart(4, "0").repeat(8);
const START = roundAt(T) + 1200;

async function game(id: string) {
  const { world, api, json } = newWorld({ DATA_KEY: "k" });
  const org = await json(await api("POST", "/api/start", { email: "o@acme.com" })); const key = org.token as string;
  expect((await api("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, key)).status).toBe(200);
  expect((await api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, key)).status).toBe(200);
  world.raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]);
  const ps: { pid: string; device: string }[] = [];
  for (const i of [1, 2]) { const r = await api("POST", `/api/z/${id}/join`, { name: "Rahul", device: dev(i) }); expect(r.status).toBe(200); ps.push({ pid: (await json(r)).pid, device: dev(i) }); }
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

describe("two players with the same name", () => {
  test("only the winner is told 'You won'; the other page says the board is over; the waiting line says which player", async () => {
    const { world, ps } = await game("SN-1");
    const a = await openFor(world, "SN-1", ps[0]!), b = await openFor(world, "SN-1", ps[1]!);
    try {
      await a.waitFor((t) => /Your turn|Waiting for/.test(t), 9000); await b.waitFor((t) => /Your turn|Waiting for/.test(t), 9000);
      let mover = a.text().includes("Your turn") ? a : b, waiter = mover === a ? b : a;
      expect(waiter.text()).toMatch(/Waiting for Rahul \(the other player\)/);
      const first = mover; // takes the top row; the other player plays the middle row
      for (const [sq, who] of [[0, "m"], [3, "w"], [1, "m"], [4, "w"], [2, "m"]] as const) {
        const p = who === "m" ? first : (first === a ? b : a);
        await p.waitFor((t) => t.includes("Your turn") || t.includes("won this board") || t.includes("board is over"), 9000);
        p.click(`.tsq[data-i="${sq}"]`);
      }
      const other = first === a ? b : a;
      await first.waitFor((t) => /You won this board/.test(t), 9000);
      await other.waitFor((t) => /board is over/i.test(t), 9000);
      expect(first.text()).toMatch(/You won this board/); expect(other.text()).not.toMatch(/You won this board/); expect(other.text()).toMatch(/This board is over/);
      expect(first.errors).toEqual([]); expect(other.errors).toEqual([]);
    } finally { await a.close(); await b.close(); }
  });
});
