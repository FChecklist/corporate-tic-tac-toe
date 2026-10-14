// O7: the AI can only ASK to stop the tournament; the organizer's own press in the console is what carries it out, through the tournament's own address (the same one the run page's End button uses).
// The real console script runs in a DOM and talks to the real Worker code with an in-memory database.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { newWorld, openPage, roundAt, T, type Page } from "./harness";
import { PRIZE_HOUSES } from "../../../packages/beacon/src/config";

setDefaultTimeout(60_000);
const START = roundAt(T) + 1200;
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function startedTournament(id: string) {
  const w = newWorld();
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  const token = s.token as string, aiKey = s.aiKey as string;
  expect((await w.api("POST", "/api/z", { id, startRound: START, callSeconds: 9, cap: 100 }, aiKey)).status).toBe(200);
  expect((await w.api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, token)).status).toBe(200);
  w.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id=?").run(id);
  for (let i = 1; i <= 4; i++) expect((await w.api("POST", `/api/z/${id}/join`, { name: `Player ${i}`, device: String(i).padStart(2, "0").repeat(16) })).status).toBe(200);
  expect((await w.api("POST", `/api/z/${id}/ttt/start`, {}, token)).status).toBe(200);
  return { ...w, token, aiKey, aiMessage: s.aiMessage as string };
}
async function console_(o: Awaited<ReturnType<typeof startedTournament>>, id: string, sure = true) {
  const p = await openPage(o.world, {
    url: `http://localhost/zc?e=${id}`, html: "zc.html", scripts: ["zgame.js", "control.js", "termsbox.js", "zc.js"], session: { "cbz-org": o.token, "cbz-aimsg": o.aiMessage, "cbz-email": "boss@acme.com" },
    afterLoad: (win: any, f: string) => { if (f === "zgame.js" && win.ZG && !win.ZG.PRIZE_HOUSES) win.ZG.PRIZE_HOUSES = PRIZE_HOUSES; win.confirm = () => sure; },
  });
  open.push(p); return p;
}
const view = async (o: Awaited<ReturnType<typeof startedTournament>>, id: string) => o.json(await o.api("GET", `/api/z/${id}/ttt/view`));

describe("the AI asks to stop, the organizer approves in the console", () => {
  test("the AI's stop request waits; the organizer's Approve ends the tournament (after asking), and the request is cleared", async () => {
    const o = await startedTournament("AS-1");
    const ask = await o.json(await o.api("POST", "/api/z/AS-1/control/request", { action: "stop", note: "fire drill" }, o.aiKey)); expect(ask.ok).toBe(true);
    expect((await view(o, "AS-1")).state).not.toBe("done"); // asking changes nothing
    const c = await console_(o, "AS-1");
    await c.waitFor((t) => /Your AI assistant is asking/.test(t) && /fire drill/.test(t));
    c.click("#reqok"); await c.waitFor((t) => /The tournament was ended/.test(t));
    const v = await view(o, "AS-1"); expect(v.state).toBe("done"); expect(v.endedEarly).toBe(true);
    const q = await o.json(await o.api("GET", "/api/z/AS-1/control/request", undefined, o.token)); expect(q.requests).toEqual([]);
  });
  test("if the organizer says no to the question, nothing is ended and the request stays; Dismiss clears it without ending", async () => {
    const o = await startedTournament("AS-2");
    await o.api("POST", "/api/z/AS-2/control/request", { action: "stop" }, o.aiKey);
    const c = await console_(o, "AS-2", false);
    await c.waitFor((t) => /Your AI assistant is asking/.test(t));
    c.click("#reqok"); await tick(150);
    expect((await view(o, "AS-2")).state).not.toBe("done");
    expect((await o.json(await o.api("GET", "/api/z/AS-2/control/request", undefined, o.token))).requests.length).toBe(1);
    c.click("#reqno"); await tick(200);
    expect((await o.json(await o.api("GET", "/api/z/AS-2/control/request", undefined, o.token))).requests.length).toBe(0);
    expect((await view(o, "AS-2")).state).not.toBe("done");
  });
  test("the AI key itself cannot end the tournament", async () => {
    const o = await startedTournament("AS-3");
    expect((await o.api("POST", "/api/z/AS-3/ttt/end", {}, o.aiKey)).status).toBe(403);
    expect((await view(o, "AS-3")).state).not.toBe("done");
  });
});
