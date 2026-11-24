// v1.6.1 (audit H-2, H-3): after entry, the player's page shows a small closed panel where a person may ADD name, department or team, region, mobile and e-mail. All optional.
// It carries the owner's two sentences word for word, it sits outside the part of the page that redraws every second (typed words survive), and Save reaches the real Worker.
import { describe, expect, test } from "bun:test";
import { newWorld, openPage, T, roundAt } from "./harness";
import { openPii } from "../../edge/src/pii";

const OPTIONAL_SENTENCE = "Above details are optional. You can play without giving these details also.";
const DELETE_SENTENCE = "All the details will be deleted and erased from the system within 24 hours after the game is over.";
const dev = (i: number) => i.toString(16).padStart(4, "0").repeat(8);
const START = roundAt(T) + 1200;

async function oneGuestIn(id: string) {
  const { world, api, json } = newWorld({ DATA_KEY: "k" });
  const org = await json(await api("POST", "/api/start", { email: "o@acme.com" })); const key = org.token as string;
  expect((await api("POST", "/api/z", { id, startRound: START, callSeconds: 6, cap: 100 }, key)).status).toBe(200);
  expect((await api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, key)).status).toBe(200);
  const r = await api("POST", `/api/z/${id}/join`, { name: "Asha", device: dev(1) }); expect(r.status).toBe(200);
  return { world, pid: (await json(r)).pid as string, id };
}
const open = (world: any, id: string, pid: string) => openPage(world, {
  url: `http://localhost/z.html?e=${id}`, html: "z.html", scripts: ["termsbox.js", "tttgame.js", "ttt.js"],
  afterLoad: (win: any, file: string) => {
    if (file === "termsbox.js") { win.crypto = globalThis.crypto; win.structuredClone = structuredClone; win.localStorage.setItem(`ttt:${id}:pid`, pid); win.localStorage.setItem("ttt:device", dev(1)); }
    if (file === "tttgame.js" && !win.TTT) win.TTT = (globalThis as any).TTT;
  },
});

describe("the optional panel after entry", () => {
  test("H-3 and H-2: in the waiting room a closed panel offers the five optional boxes and both exact sentences; Save stores them for the organizer; it survives the page redrawing", async () => {
    const { world, pid, id } = await oneGuestIn("PNL-1");
    const p = await open(world, id, pid);
    try {
      await p.waitFor((t) => /You are in/.test(t), 9000);
      const panel = p.$("#tdetails"); expect(panel).toBeTruthy();
      expect(p.$("#tdet").hasAttribute("open")).toBe(false); // closed until the person opens it
      for (const b of ["pd-nm", "pd-dept", "pd-reg", "pd-mob", "pd-mail"]) expect(p.$("#" + b)).toBeTruthy();
      expect(panel.textContent).toContain(OPTIONAL_SENTENCE); expect(panel.textContent).toContain(DELETE_SENTENCE);
      const W = p.win; const put = (i: string, v: string) => { const el = p.$("#" + i); el.value = v; el.dispatchEvent(new W.Event("input")); };
      put("pd-dept", "Finance Ops"); put("pd-reg", "South"); put("pd-mail", "Asha@Acme.com");
      await new Promise((r) => setTimeout(r, 3500)); // the page redraws itself while the person types
      expect(p.$("#pd-dept").value).toBe("Finance Ops"); // nothing typed is lost
      p.click("#pd-save");
      await p.waitFor(() => /Saved\. Thank you\./.test(p.$("#pd-msg").textContent), 6000);
      const row = world.raw.query("SELECT pii FROM participant WHERE eid=?").get(id) as any;
      const pii = await openPii(world.env as any, row.pii); expect(pii).toMatchObject({ name: "Asha", dept: "Finance Ops", region: "South", email: "asha@acme.com" });
    } finally { await p.close(); }
  }, 30_000);
  test("saving with every box empty says there is nothing to save and sends nothing (nothing is needed to play)", async () => {
    const { world, pid, id } = await oneGuestIn("PNL-2");
    const p = await open(world, id, pid);
    try {
      await p.waitFor((t) => /You are in/.test(t), 9000);
      p.click("#pd-save");
      await p.waitFor(() => /Nothing to save/.test(p.$("#pd-msg").textContent), 3000);
      expect((world.raw.query("SELECT pii FROM participant WHERE eid=?").get(id) as any).pii).toBeTruthy();
    } finally { await p.close(); }
  }, 20_000);
});
