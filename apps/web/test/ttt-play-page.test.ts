// The player's page (z.html + tttgame.js + ttt.js) in a simulated phone browser, wired straight to the real Worker code: the page itself works out the board from the moves the server stored,
// a tap is posted as "my square" with the next number, and the other player's page shows it. The server only keeps the move and its time stamp (docs/RULES.md, section I).
import { describe, expect, test } from "bun:test";
import { newWorld, openPage, T, roundAt } from "./harness";
import { TttConsole } from "../../../packages/ttt/src/phone";

const dev = (i: number) => i.toString(16).padStart(4, "0").repeat(8);
const START = roundAt(T) + 1200;

async function twoPlayerGame(id: string) {
  const { world, api, json } = newWorld({ DATA_KEY: "k" });
  const org = await json(await api("POST", "/api/start", { email: "o@acme.com" })); const key = org.token as string;
  expect((await api("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, key)).status).toBe(200);
  expect((await api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, key)).status).toBe(200);
  world.raw.run("UPDATE engagement SET pack=100 WHERE id=?", [id]);
  const ps: { pid: string; device: string; name: string }[] = [];
  for (const [i, name] of [[1, "Asha"], [2, "Ravi"]] as const) { const r = await api("POST", `/api/z/${id}/join`, { name, device: dev(i) }); expect(r.status).toBe(200); ps.push({ pid: (await json(r)).pid, device: dev(i), name }); }
  expect((await api("POST", `/api/z/${id}/ttt/start`, { moveSecs: 20 }, key)).status).toBe(200);
  const con = new TttConsole(async (m, p, b) => { const r = await api(m, p, b, key); const j = await r.json(); if (!r.ok) throw Object.assign(new Error(j.error), { status: r.status, code: j.code, body: j }); return j; }, id);
  expect((await con.tick()).sentPlan).toBe(true);
  return { world, ps, id };
}
const openFor = (world: any, id: string, p: { pid: string; device: string }) => openPage(world, {
  url: `http://localhost/z.html?e=${id}`, html: "z.html", scripts: ["termsbox.js", "tttgame.js", "ttt.js"],
  afterLoad: (win: any, file: string) => {
    if (file === "termsbox.js") { win.crypto = globalThis.crypto; win.structuredClone = structuredClone; win.localStorage.setItem(`ttt:${id}:pid`, p.pid); win.localStorage.setItem("ttt:device", p.device); }
    if (file === "tttgame.js" && !win.TTT) win.TTT = (globalThis as any).TTT; // the bundle announces itself on the global object
  },
});

describe("the player page runs the game on the phone (docs/RULES.md, section I)", () => {
  test("both pages draw the board the phones computed; a tap on the page becomes a stored move; the other page shows it", async () => {
    const { world, ps, id } = await twoPlayerGame("PG-1");
    const a = await openFor(world, id, ps[0]!), b = await openFor(world, id, ps[1]!);
    try {
      await a.waitFor((t) => /Your turn|Waiting for/.test(t), 9000); await b.waitFor((t) => /Your turn|Waiting for/.test(t), 9000);
      expect(a.errors).toEqual([]); expect(b.errors).toEqual([]);
      expect(a.html().match(/class="tsq/g)!.length).toBe(9);
      const mover = a.text().includes("Your turn") ? a : b, waiter = mover === a ? b : a;
      expect(waiter.text()).toContain("Waiting for"); expect(waiter.html()).toContain("disabled");
      mover.click('.tsq[data-i="4"]');
      await waiter.waitFor((t) => t.includes("Your turn"), 9000);
      const moves = world.raw.query("SELECT sq, at_ms, pid FROM ttt_mv WHERE eid=?").all(id) as any[];
      expect(moves.length).toBe(1); expect(moves[0]).toMatchObject({ sq: 4, at_ms: world.now }); // the server's own clock stamp
      expect(waiter.html()).toMatch(/class="tsq [xo]"[^>]*data-i="4"|data-i="4"[^>]*class="tsq [xo]"/);
    } finally { await a.close(); await b.close(); }
  }, 30_000);
  test("the page never sends a rule's result to the server except its own report of a finished board, and never a draw: the game page posts only squares, claims and reports", async () => {
    const { world, ps, id } = await twoPlayerGame("PG-2");
    const seen: string[] = [];
    const a = await openPage(world, { url: `http://localhost/z.html?e=${id}`, html: "z.html", scripts: ["termsbox.js", "tttgame.js", "ttt.js"], afterLoad: (win: any, file: string) => {
      if (file === "termsbox.js") { win.crypto = globalThis.crypto; win.structuredClone = structuredClone; win.localStorage.setItem(`ttt:${id}:pid`, ps[0]!.pid); win.localStorage.setItem("ttt:device", ps[0]!.device); const f = win.fetch; win.fetch = (u: any, init: any) => { if (init?.method === "POST") seen.push(String(u).replace(/^.*\/ttt\//, "")); return f(u, init); }; }
      if (file === "tttgame.js" && !win.TTT) win.TTT = (globalThis as any).TTT;
    } });
    try {
      await a.waitFor((t) => /Your turn|Waiting for/.test(t), 9000);
      if (a.text().includes("Your turn")) a.click('.tsq[data-i="0"]');
      await new Promise((r) => setTimeout(r, 300));
      for (const s of seen) expect(["move", "result", "open", "flag"]).toContain(s);
    } finally { await a.close(); }
  }, 30_000);
});
