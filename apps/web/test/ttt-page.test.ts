// The player's page (z.html + ttt.js + termsbox.js) in a simulated phone browser: the join screen shows the K4 boxes BEFORE any name field works,
// nothing is ticked in advance, the button stays disabled until both are ticked, and the request carries the ticks and the Terms version. Gates K4, U1, U2, U3, LR-6, LR-7.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import TEXT from "../../edge/src/consent-text.json";
const K4: Record<string, string> = (TEXT as any).K4, VER: string = (TEXT as any).version;

const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

async function openPlayerPage(search = "?e=GAME-1") {
  const w: any = new Window({ url: "https://tictactoe.corporatetambola.com/z.html" + search, width: 390, height: 780 });
  w.crypto = globalThis.crypto;
  const sent: { url: string; method: string; body: any }[] = [];
  w.fetch = async (url: string, init: any = {}) => {
    const u = String(url); const body = init.body ? JSON.parse(init.body) : undefined; sent.push({ url: u, method: init.method ?? "GET", body });
    const ok = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    if (u.includes("/api/consent/text")) return ok({ version: VER, kind: "K4", boxes: Object.entries(K4).map(([id, text]) => ({ id, text })) });
    if (u.endsWith("/info")) return ok({});
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
  test("U1/K4: the boxes are drawn first, with the server's exact wording, unticked; the name field and the button are disabled", async () => {
    const { d } = await openPlayerPage();
    const boxes = [...d.querySelectorAll('input[type="checkbox"]')] as any[];
    expect(boxes.length).toBe(2); expect(boxes.every((b) => b.checked === false)).toBe(true);
    const labels = [...d.querySelectorAll("#tbslot label")].map((l: any) => l.textContent.trim()); expect(labels).toEqual([K4.A, K4.B]); // string for string with the agreed wording
    expect(d.getElementById("go")!.getAttribute("aria-disabled")).toBe("true");
    expect(d.getElementById("nm")!.disabled).toBe(true); expect(d.getElementById("go")!.disabled).toBe(true);
    const order = d.body.innerHTML; expect(order.indexOf("tbslot")).toBeLessThan(order.indexOf('id="nm"')); // the boxes come before the name field
  });
  test("U3/LR-6: only a name is asked (no phone field), and the invite chain is in the wording the person ticks", async () => {
    const { d } = await openPlayerPage();
    expect(d.querySelector('input[type="tel"]')).toBeNull(); expect(d.getElementById("ph")).toBeNull();
    expect(d.body.textContent).toContain("who invited me is recorded until then");
  });
  test("K4: one box is not enough; with both ticked and a name typed the button works, and the request carries both ticks and the version", async () => {
    const { d, sent } = await openPlayerPage();
    const [a, b] = [...d.querySelectorAll('input[type="checkbox"]')] as any[];
    a.checked = true; a.dispatchEvent(new (d.defaultView as any).Event("change")); await tick();
    expect(d.getElementById("nm")!.disabled).toBe(true); expect(d.getElementById("go")!.disabled).toBe(true);
    b.checked = true; b.dispatchEvent(new (d.defaultView as any).Event("change")); await tick();
    const nm = d.getElementById("nm") as any; expect(nm.disabled).toBe(false); expect(d.getElementById("go")!.disabled).toBe(true); // a name is still needed
    nm.value = "Maya"; nm.dispatchEvent(new (d.defaultView as any).Event("input")); await tick();
    const go = d.getElementById("go") as any; expect(go.disabled).toBe(false);
    go.click(); await tick(60);
    const join = sent.find((s) => s.url.endsWith("/join"))!;
    expect(join.body.name).toBe("Maya"); expect(join.body.consent).toEqual({ v: VER, boxes: ["A", "B"] }); expect(join.body.device).toMatch(/^[0-9a-f]{32}$/);
    expect(d.body.textContent).toContain("Waiting for the host");
  });
  test("the page never types the consent wording itself (it comes from the server)", () => {
    for (const f of ["ttt.js", "termsbox.js"]) for (const text of Object.values(K4)) expect([f, pub(f).includes(text)]).toEqual([f, false]);
  });
});
