// The player page offers "Leave this game" and "What do you hold about me / delete me" (U5, U6): rights.js loaded the way z.html loads it, in a simulated phone browser, with the
// player's own keys on the phone (ttt:device, ttt:GAME-1:pid, ttt:last) and a stand-in for the server that records every call. The server side is tested in apps/edge/test/rights.test.ts.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
setDefaultTimeout(30_000);

const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const DEVICE = "a".repeat(32), PID = "1x000000000001";

async function openRights({ player = true }: { player?: boolean } = {}) {
  const w: any = new Window({ url: "https://game.test/z.html?e=GAME-1", width: 390, height: 780 });
  const calls: { url: string; body: any }[] = [];
  w.fetch = async (url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined; calls.push({ url: String(url), body });
    const ok = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (String(url).endsWith("/leave")) return ok({ ok: true, left: true, message: "You have left the game. Your name and your place were deleted from our system just now. You can close this page." });
    if (String(url).endsWith("/datareq")) {
      if (body.kind === "status") return ok({ promiseDays: 7, promise: "within 7 days", requests: [] });
      if (body.kind === "erasure") return ok({ ok: true, erased: true, status: "done", message: "Done. Your name and your place were deleted just now. We told the organizer." });
      return ok({ ok: true, kind: body.kind, status: "open", promise: "within 7 days", message: "We have your request. You will have your answer within 7 days, by 21 Oct 2026.", held: [{ what: "Your name for this game", value: "Maya" }] });
    }
    return ok({}, 404);
  };
  if (player) { w.localStorage.setItem("ttt:device", DEVICE); w.localStorage.setItem("ttt:GAME-1:pid", PID); w.localStorage.setItem("ttt:last", "GAME-1"); }
  w.document.body.innerHTML = '<main id="app"></main>';
  new Function("window", "document", "location", "localStorage", "fetch", "navigator", "setTimeout", "setInterval", "clearTimeout", "clearInterval", pub("rights.js"))(w, w.document, w.location, w.localStorage, w.fetch, w.navigator, setTimeout, setInterval, clearTimeout, clearInterval);
  await tick(30);
  return { w, d: w.document, calls };
}
const text = (d: any) => String(d.body.textContent ?? "").replace(/\s+/g, " ");

describe("the player page offers the player's rights", () => {
  test("once the player has a place in the game, both controls are on the page, outside the game screen, as real buttons with names", async () => {
    const { d } = await openRights();
    expect(d.getElementById("rt-leave")!.tagName).toBe("BUTTON"); expect(d.getElementById("rt-leave")!.textContent).toBe("Leave this game");
    expect(d.getElementById("rt-hold")!.textContent).toBe("What do you hold about me / delete me");
    expect(d.getElementById("app")!.contains(d.getElementById("rt-leave"))).toBe(false); // the game redraws #app: the controls must live outside it
  });
  test("a person who has not joined sees neither control", async () => {
    const { d } = await openRights({ player: false });
    expect(d.getElementById("rt-leave")).toBeNull(); expect(d.getElementById("rt-hold")).toBeNull();
  });
  test("Leave: asks first; 'No, stay' sends nothing; 'Yes' sends the player id and the device id, says so in plain words and makes the phone forget the game", async () => {
    const { d, calls, w } = await openRights();
    (d.getElementById("rt-leave") as any).click(); await tick();
    expect(text(d)).toMatch(/Leave this game\?/); expect(calls.length).toBe(0);
    (d.getElementById("rt-no") as any).click(); await tick(); expect(calls.length).toBe(0);
    (d.getElementById("rt-leave") as any).click(); await tick(); (d.getElementById("rt-yes") as any).click(); await tick(40);
    expect(calls).toEqual([{ url: "/api/z/GAME-1/leave", body: { pid: PID, device: DEVICE } }]);
    expect(text(d)).toMatch(/You have left the game/); expect(text(d)).toMatch(/deleted/);
    expect(w.localStorage.getItem("ttt:device")).toBeNull(); expect(w.localStorage.getItem("ttt:GAME-1:pid")).toBeNull();
  });
  test("What do you hold about me: the promised time shows before sending; sending asks for 'access' with the player's own ids and shows the answer and what is held", async () => {
    const { d, calls } = await openRights();
    (d.getElementById("rt-hold") as any).click(); await tick(40);
    expect(text(d)).toMatch(/within 7 days/);
    expect([...d.querySelectorAll('input[name="rt-kind"]')].map((i: any) => i.value)).toEqual(["access", "correction", "erasure", "nomination"]);
    (d.getElementById("rt-send") as any).click(); await tick(40);
    const sent = calls.filter((c) => c.body.kind !== "status");
    expect(sent).toEqual([{ url: "/api/z/GAME-1/datareq", body: { pid: PID, device: DEVICE, kind: "access", note: "" } }]);
    expect(text(d)).toMatch(/We have your request/); expect(text(d)).toMatch(/Maya/); expect(text(d)).toMatch(/within 7 days/);
  });
  test("Delete me: choosing deletion shows the warning and the button says so; sending deletes at once and the phone forgets the game", async () => {
    const { d, calls, w } = await openRights();
    (d.getElementById("rt-hold") as any).click(); await tick(40);
    (d.querySelector('input[value="erasure"]') as any).click(); await tick();
    expect((d.getElementById("rt-warn") as any).hidden).toBe(false); expect(d.getElementById("rt-send")!.textContent).toBe("Delete me now");
    (d.getElementById("rt-send") as any).click(); await tick(40);
    expect(calls.filter((c) => c.body.kind === "erasure").length).toBe(1);
    expect(text(d)).toMatch(/deleted just now/i); expect(w.localStorage.getItem("ttt:GAME-1:pid")).toBeNull();
  });
  test("Name another person (DPDP Act s14): choosing it shows the e-mail route; sending asks for 'nomination' with the player's own ids and nothing is deleted", async () => {
    const { d, calls, w } = await openRights();
    (d.getElementById("rt-hold") as any).click(); await tick(40);
    expect((d.getElementById("rt-nom") as any).hidden).toBe(true);
    (d.querySelector('input[value="nomination"]') as any).click(); await tick();
    expect((d.getElementById("rt-nom") as any).hidden).toBe(false); expect(text(d)).toContain("rajatsiroffice@gmail.com"); expect(d.querySelector('#rt-nom a')!.getAttribute("href")).toBe("mailto:rajatsiroffice@gmail.com");
    expect(d.getElementById("rt-send")!.textContent).toBe("Send"); expect((d.getElementById("rt-warn") as any).hidden).toBe(true);
    (d.getElementById("rt-send") as any).click(); await tick(40);
    const sent = calls.filter((c) => c.body.kind !== "status");
    expect(sent.length).toBe(1); expect(sent[0]!.body).toMatchObject({ pid: PID, device: DEVICE, kind: "nomination" });
    expect(w.localStorage.getItem("ttt:GAME-1:pid")).toBe(PID); // nothing is deleted
  });
  test("z.html loads rights.js after the game's own script, and the build ships it", () => {
    const html = pub("z.html"); const own = html.indexOf("ttt.js"), rt = html.indexOf("/rights.js");
    expect(own).toBeGreaterThan(-1); expect(rt).toBeGreaterThan(own);
    expect(readFileSync(new URL("../../../pages/build.mjs", import.meta.url), "utf8")).toContain('"rights.js"');
  });
});
