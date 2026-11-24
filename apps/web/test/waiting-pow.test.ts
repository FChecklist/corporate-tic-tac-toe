// v1.6.3 (security audit M-2 c): the player's page does the small proof of work by itself when the server asks for it (428 need-pow), and asks again with the proof.
// The test pins the page to the server: the proof the page sends is checked with the SERVER's own text and zero-bit count (apps/edge/src/pow.ts).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Window } from "happy-dom";
import TEXT from "../../edge/src/consent-text.json";
import { powText, zeroBits } from "../../edge/src/pow";
const K4: Record<string, string> = (TEXT as any).K4, VER: string = (TEXT as any).version;
const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const until = async (what: string, pred: () => boolean, ms = 6000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting for: " + what); await tick(2); } };
const ok = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

async function page(joinAnswer: (n: number, body: any) => Response | Promise<Response>) {
  const w: any = new Window({ url: "https://tictactoe.corporatetambola.com/z.html?e=GAME-1", width: 390, height: 780 });
  w.crypto = globalThis.crypto; w.__joinRetryMs = 20;
  const bodies: any[] = [];
  w.fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.includes("/api/consent/text")) return ok({ version: VER, kind: "K4", boxes: Object.entries(K4).map(([id, text]) => ({ id, text })) });
    if (u.endsWith("/info")) return ok({});
    if (u.endsWith("/join")) { const b = JSON.parse(init.body); bodies.push(b); return joinAnswer(bodies.length, b); }
    if (u.includes("/ttt/setup")) return ok({ eid: "GAME-1", state: "open", joined: 1, serverNow: Date.now(), commit: "ab".repeat(32), pauses: [] });
    return ok({}, 404);
  };
  w.document.body.innerHTML = '<main id="app"></main>';
  new Function("globalThis", pub("tttgame.js"))(w);
  for (const f of ["termsbox.js", "ttt.js"]) new Function("window", "document", "location", "localStorage", "fetch", "history", "navigator", "setTimeout", "clearTimeout", "setInterval", "clearInterval", pub(f))(w, w.document, w.location, w.localStorage, w.fetch, w.history, w.navigator, w.setTimeout.bind(w), w.clearTimeout.bind(w), w.setInterval.bind(w), w.clearInterval.bind(w));
  await until("the join form is drawn", () => !!w.document.getElementById("nm") && !!w.document.getElementById("go"));
  const d = w.document, W = w as any;
  for (const b of [...d.querySelectorAll('input[type="checkbox"]')] as any[]) { b.checked = true; b.dispatchEvent(new W.Event("change")); }
  const nm = d.getElementById("nm") as any; nm.value = "Asha"; nm.dispatchEvent(new W.Event("input")); await tick();
  (d.getElementById("go") as any).click();
  return { d, bodies };
}
const goodProof = (body: any, bucket: number, bits: number) => !!body.pow && body.pow.b === bucket && zeroBits(new Uint8Array(createHash("sha256").update(powText("GAME-1", body.device, bucket, body.pow.n)).digest())) >= bits;

describe("the player's page does the proof of work when the server asks for it", () => {
  test("428 need-pow: the page finds a number that the SERVER accepts (same text, same zero bits), asks again with it, and then shows the waiting card", async () => {
    const p = await page((n, b) => (n === 1 ? ok({ error: "One moment please.", code: "need-pow", pow: { v: 1, bucket: 2_912_345, bits: 12 } }, 428) : ok({ error: "This game is by invitation. Your request is with the organizer.", code: "waiting", waiting: true, wid: "aabbccddeeff", with: "the organizer" }, 403)));
    await until("the page asked again", () => p.bodies.length >= 2);
    expect(p.bodies[0].pow).toBeUndefined();
    expect(goodProof(p.bodies[1], 2_912_345, 12)).toBe(true);
    await until("the waiting card", () => /Please wait a moment/.test(String(p.d.body.textContent)));
    expect(p.bodies.length).toBe(2); expect(p.d.body.textContent).not.toMatch(/Could not join/);
  });
  test("the page asks for the proof again when the server wants more work, and gives up with the server's sentence if it never accepts", async () => {
    const p = await page((n) => ok({ error: "One moment please. Your phone is doing a short check before your request is sent. This takes a few seconds.", code: "need-pow", pow: { v: 1, bucket: 7, bits: 8 + n } }, 428));
    await until("the page gave up", () => /One moment please/.test(String(p.d.body.textContent)) && p.bodies.length >= 4);
    expect(p.bodies.length).toBe(4); // the first try, then three proofs (the page's own limit), then the server's sentence is shown
    for (let i = 1; i < p.bodies.length; i++) expect(goodProof(p.bodies[i], 7, 8 + i)).toBe(true);
  }, 20_000);
  test("a refusal that has nothing to do with the proof (closed room, busy window, full list) is shown in the server's words and is not asked again", async () => {
    for (const [code, error] of [["waiting-closed", "The organizer has stopped new requests to join for now. Please ask your organizer to add you to the list."], ["waiting-busy", "Many people are asking to join this game right now. Please try again in a few minutes, or ask your organizer to add you to the list."], ["waiting-full", "The waiting list of this game is full (500 requests), so nobody can ask to join right now. Please ask your organizer to add you to the list, or to clear the waiting list, and then try again."]] as const) {
      const p = await page(() => ok({ error, code }, code === "waiting-closed" ? 403 : 429));
      await until("the sentence is shown", () => String(p.d.body.textContent).includes(error.slice(0, 40))); await tick(100);
      expect(p.bodies.length).toBe(1);
    }
  });
});
