// The player's page (z.html + ttt.js + termsbox.js) in a simulated phone browser: the join screen shows the one-line agreement notice BEFORE the name field,
// there is nothing to tick (no tick-boxes since 1 Nov 2026), the button waits for a name, and the request carries the Terms version. Gates K4, U1, U2, U3, LR-6, LR-7.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import TEXT from "../../edge/src/consent-text.json";
const K4: Record<string, string> = (TEXT as any).K4, VER: string = (TEXT as any).version;

const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
// The two sentences, word for word as the owner wrote them (23 Nov 2026). Both screens show them: the ask-to-join screen and the panel after entry.
export const OPTIONAL_SENTENCE = "Above details are optional. You can play without giving these details also.";
export const DELETE_SENTENCE = "All the details will be deleted and erased from the system within 24 hours after the game is over.";

async function openPlayerPage(search = "?e=GAME-1", info0: Record<string, unknown> = {}) {
  const info = info0.verify === "id" && info0.byInvite === undefined ? { ...info0, byInvite: true } : info0; // verify "id" means a game by invitation (the only kind that asks for an ID)
  const w: any = new Window({ url: "https://tictactoe.corporatetambola.com/z.html" + search, width: 390, height: 780 });
  w.crypto = globalThis.crypto;
  const sent: { url: string; method: string; body: any }[] = [];
  w.fetch = async (url: string, init: any = {}) => {
    const u = String(url); const body = init.body ? JSON.parse(init.body) : undefined; sent.push({ url: u, method: init.method ?? "GET", body });
    const ok = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.includes("/api/consent/text")) return ok({ version: VER, kind: "K4", boxes: Object.entries(K4).map(([id, text]) => ({ id, text })) });
    if (u.endsWith("/info")) return ok(info);
    if (u.endsWith("/join")) return ok({ pid: "1x000000000001" });
    if (u.includes("/ttt/setup")) return ok({ eid: "GAME-1", state: "open", joined: 1, serverNow: Date.now(), commit: "ab".repeat(32), pauses: [] });
    return ok({}, 404);
  };
  w.document.body.innerHTML = '<main id="app"></main>';
  new Function("globalThis", pub("tttgame.js"))(w); // the game engine the page runs on the phone (window.TTT), built from packages/ttt
  for (const f of ["termsbox.js", "ttt.js"]) new Function("window", "document", "location", "localStorage", "fetch", "history", "navigator", "setTimeout", "clearTimeout", "setInterval", "clearInterval", pub(f))(w, w.document, w.location, w.localStorage, w.fetch, w.history, w.navigator, (fn: any, ms?: number) => setTimeout(fn, ms), clearTimeout, (fn: any, ms?: number) => setInterval(fn, ms), clearInterval);
  await tick(40);
  return { w, d: w.document, sent };
}

describe("the join screen (K4, U1-U3)", () => {
  test("U1/K4: the agreement notice is drawn first (one line, three links, nothing to tick); the name field is ready and the button waits for a name", async () => {
    const { d } = await openPlayerPage();
    expect(d.querySelectorAll('input[type="checkbox"]').length).toBe(0); // no tick-boxes since 1 Nov 2026
    const note = d.querySelector("#tbslot .tb-note") as any; expect(note).toBeTruthy();
    expect(note.textContent.trim()).toBe("By continuing, you agree to the Terms and Conditions, Privacy and Data, and Game rules.");
    expect([...note.querySelectorAll("a")].map((a: any) => a.getAttribute("href"))).toEqual(["https://home.corporatetambola.com/terms#terms", "https://home.corporatetambola.com/terms#privacy", "https://home.corporatetambola.com/terms#game-rules"]);
    expect(d.getElementById("nm")!.disabled).toBe(false); expect(d.getElementById("go")!.disabled).toBe(true); expect(d.getElementById("go")!.getAttribute("aria-disabled")).toBe("true"); // a name is still needed
    expect(d.body.textContent).not.toMatch(/tick the box/i);
    const order = d.body.innerHTML; expect(order.indexOf("tbslot")).toBeLessThan(order.indexOf('id="nm"')); // the notice comes before the name field
  });
  test("U3/LR-6 and H-2: only a name is asked (no phone field), and the two exact sentences of the owner are on the join screen", async () => {
    const { d } = await openPlayerPage();
    expect(d.querySelector('input[type="tel"]')).toBeNull(); expect(d.getElementById("ph")).toBeNull();
    expect(d.body.textContent).toContain(OPTIONAL_SENTENCE); expect(d.body.textContent).toContain(DELETE_SENTENCE);
  });
  test("when the organizer asks for an employee ID the join screen has an ID box and the optional box; an ID alone or a name alone is enough to press Join, and the request carries what was typed", async () => {
    const { d, sent } = await openPlayerPage("?e=GAME-1", { verify: "id", employeesOnly: false });
    for (const b of [...d.querySelectorAll('input[type="checkbox"]')] as any[]) { b.checked = true; b.dispatchEvent(new (d.defaultView as any).Event("change")); }
    await tick();
    const W = d.defaultView as any, put = (id: string, v: string) => { const el = d.getElementById(id) as any; el.value = v; el.dispatchEvent(new W.Event("input")); }, go = () => (d.getElementById("go") as any).disabled;
    expect(d.getElementById("emp")).toBeTruthy(); expect(d.getElementById("mob")).toBeTruthy();
    expect(go()).toBe(true); // nothing typed: nothing to send
    put("emp", "e-101"); await tick(); expect(go()).toBe(false); // an ID alone is enough (the server checks the list)
    put("emp", ""); put("nm", "M"); await tick(); expect(go()).toBe(true); // one letter is not a name
    put("nm", "Maya"); await tick(); expect(go()).toBe(false); // H-1: a name alone is enough: the organizer decides
    put("emp", "e-101"); await tick();
    (d.getElementById("go") as any).click(); await tick(60);
    const join = sent.find((s) => s.url.endsWith("/join"))!; expect(join.body).toMatchObject({ name: "Maya", empId: "e-101" }); expect(join.body.phone).toBeUndefined();
  });
  test("H-1/H-2: a game by invitation: only the name is needed; department or team, region, mobile and e-mail sit in a closed optional fold; both exact sentences are shown; the request carries what was typed", async () => {
    const { d, sent } = await openPlayerPage("?e=GAME-1", { verify: "id", byInvite: true, employeesOnly: false });
    for (const b of [...d.querySelectorAll('input[type="checkbox"]')] as any[]) { b.checked = true; b.dispatchEvent(new (d.defaultView as any).Event("change")); }
    await tick();
    const W = d.defaultView as any, put = (id: string, v: string) => { const el = d.getElementById(id) as any; el.value = v; el.dispatchEvent(new W.Event("input")); }, go = () => (d.getElementById("go") as any).disabled;
    expect(d.body.textContent).toMatch(/A-1101, A 1101 and A\/1101 are the same ID/); expect(d.body.textContent).toMatch(/seen by your organizer and hosts only/);
    expect(d.body.textContent).toContain(OPTIONAL_SENTENCE); expect(d.body.textContent).toContain(DELETE_SENTENCE);
    const fold = d.getElementById("moreopt") as any; expect(fold.tagName).toBe("DETAILS"); expect(fold.hasAttribute("open")).toBe(false); // closed until opened
    for (const id of ["emp", "dept", "reg", "mob", "mail"]) expect(d.getElementById(id)).toBeTruthy(); expect((d.getElementById("mail") as any).getAttribute("type")).toBe("email");
    expect(go()).toBe(true);
    put("mob", "98765 43210"); put("mail", "maya@acme.test"); await tick(); expect(go()).toBe(true); // contact alone is not what is asked for: the name is
    put("nm", "Maya Lopez"); await tick(); expect(go()).toBe(false); // H-1: the name alone is enough, no ID, no mobile number, no e-mail needed
    put("dept", "Finance Ops"); put("reg", "South"); await tick();
    (d.getElementById("go") as any).click(); await tick(60);
    const join = sent.find((x) => x.url.endsWith("/join"))!; expect(join.body).toMatchObject({ name: "Maya Lopez", phone: "98765 43210", email: "maya@acme.test", dept: "Finance Ops", region: "South" }); expect(join.body.empId).toBeUndefined();
  });
  test("H-1: a name alone is sent with no contact fields at all", async () => {
    const { d, sent } = await openPlayerPage("?e=GAME-1", { verify: "id", byInvite: true, employeesOnly: false });
    const W = d.defaultView as any, put = (id: string, v: string) => { const el = d.getElementById(id) as any; el.value = v; el.dispatchEvent(new W.Event("input")); };
    await tick(); put("nm", "Maya Lopez"); await tick(); (d.getElementById("go") as any).click(); await tick(60);
    const join = sent.find((x) => x.url.endsWith("/join"))!; expect(join.body.name).toBe("Maya Lopez"); for (const k of ["phone", "email", "dept", "region", "empId"]) expect(join.body[k]).toBeUndefined();
  });
  test("a game anyone may join (not by invitation) asks only for a name, and shows the owner's two sentences", async () => {
    const { d } = await openPlayerPage("?e=GAME-1", { verify: "id", byInvite: false });
    expect(d.getElementById("emp")).toBeNull(); expect(d.getElementById("mail")).toBeNull(); expect(d.body.textContent).toContain(OPTIONAL_SENTENCE); expect(d.body.textContent).toContain(DELETE_SENTENCE);
  });
  test("with the default (nothing asked) there is no ID box and no mobile box", async () => {
    const { d } = await openPlayerPage("?e=GAME-1", { verify: "number" });
    expect(d.getElementById("emp")).toBeNull(); expect(d.getElementById("mob")).toBeNull();
  });
  test("K4: with a name typed the button works, and the request carries the version and the points of the point (notice: true)", async () => {
    const { d, sent } = await openPlayerPage();
    const nm = d.getElementById("nm") as any; expect(nm.disabled).toBe(false); expect(d.getElementById("go")!.disabled).toBe(true); // a name is still needed
    nm.value = "Maya"; nm.dispatchEvent(new (d.defaultView as any).Event("input")); await tick();
    const go = d.getElementById("go") as any; expect(go.disabled).toBe(false);
    go.click(); await tick(60);
    const join = sent.find((s) => s.url.endsWith("/join"))!;
    expect(join.body.name).toBe("Maya"); expect(join.body.consent).toEqual({ v: VER, boxes: ["A", "B"], notice: true }); expect(join.body.device).toMatch(/^[0-9a-f]{32}$/);
    expect(d.body.textContent).toContain("Waiting for the host");
  });
  test("the page never types the consent wording itself (it comes from the server)", () => {
    for (const f of ["ttt.js", "termsbox.js"]) for (const text of Object.values(K4)) expect([f, pub(f).includes(text)]).toEqual([f, false]);
  });
});
