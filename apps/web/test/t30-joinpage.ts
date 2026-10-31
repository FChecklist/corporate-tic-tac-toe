// TEST AUTHOR 30 Oct 2026. The join page employee-ID box (ttt.js): the hint line "The system will read this as ...", the 60 typed characters, and that the page's cleaning is the server's cleaning (ids.ts).
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import TEXT from "../../edge/src/consent-text.json";
const K4: Record<string, string> = (TEXT as any).K4, VER: string = (TEXT as any).version;
const pub = (f: string) => readFileSync(new URL("../public/" + f, import.meta.url), "utf8");
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
/** Waits for the condition (polls every 2 ms); no fixed sleep decides the result. */
const until = async (what: string, pred: () => boolean, ms = 4000) => { const t0 = Date.now(); while (!pred()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting for: " + what); await tick(2); } };

export async function openJoin(info: Record<string, unknown>) {
  const w: any = new Window({ url: "https://tictactoe.corporatetambola.com/z.html?e=GAME-1", width: 390, height: 780 }); w.crypto = globalThis.crypto;
  const ok = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
  w.fetch = async (url: string) => { const u = String(url);
    if (u.includes("/api/consent/text")) return ok({ version: VER, kind: "K4", boxes: Object.entries(K4).map(([id, text]) => ({ id, text })) });
    if (u.endsWith("/info")) return ok(info); if (u.includes("/ttt/setup")) return ok({ eid: "GAME-1", state: "open", joined: 1, serverNow: Date.now(), commit: "ab".repeat(32), pauses: [] }); return ok({}, 404); };
  w.document.body.innerHTML = '<main id="app"></main>';
  new Function("globalThis", pub("tttgame.js"))(w);
  for (const f of ["termsbox.js", "ttt.js"]) new Function("window", "document", "location", "localStorage", "fetch", "history", "navigator", "setTimeout", "clearTimeout", "setInterval", "clearInterval", pub(f))(w, w.document, w.location, w.localStorage, w.fetch, w.history, w.navigator, (fn: any, ms?: number) => setTimeout(fn, ms), clearTimeout, (fn: any, ms?: number) => setInterval(fn, ms), clearInterval);
  await until("the join page is drawn", () => !!w.document.getElementById("nm") && !!w.document.getElementById("go"));
  const d = w.document, emp = () => d.getElementById("emp") as any, hint = () => (d.getElementById("emphint")?.textContent ?? "") as string;
  const type = async (v: string) => { emp().value = v; emp().dispatchEvent(new w.Event("input")); await tick(2); };
  return { w, d, emp, hint, type };
}

