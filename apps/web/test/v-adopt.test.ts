// v.js (this game's browser tracker) adopts a visitor code handed over by another of our sites (#cv=<32 hex>): taken once, removed from the address bar, the earlier code told once (ov);
// nothing is adopted or stored with Global Privacy Control. v.js is run exactly as a browser runs it (happy-dom). Written by site-analytics/tools/apply-game.mjs.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { Window } = await import("happy-dom");
const CODE = readFileSync(join(import.meta.dir, "../public/v.js"), "utf8");
const KEY = "cbv_id", OLD = "a1".repeat(16), NEW = "c3".repeat(16);
const wins: any[] = [];
afterEach(async () => { for (const w of wins.splice(0)) { try { await w.happyDOM.close(); } catch { /* closed */ } } });

function open(hash = "", o: { gpc?: boolean; stored?: string } = {}) {
  const win: any = new Window({ url: `https://tictactoe.corporatetambola.com/${hash}`, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  wins.push(win);
  for (const n of ["Uint8Array", "Uint16Array", "Uint32Array", "Boolean", "Array", "Object", "String", "Number", "Math", "JSON", "Date", "Promise", "RegExp", "Blob", "URL", "URLSearchParams", "encodeURIComponent", "parseInt", "isFinite"]) if ((win as any)[n] === undefined) (win as any)[n] = (globalThis as any)[n];
  win.document.write(`<html><body><header id="top" data-sec="top">Top</header></body></html>`);
  if (o.stored) win.localStorage.setItem(KEY, o.stored);
  if (o.gpc) Object.defineProperty(win.navigator, "globalPrivacyControl", { configurable: true, value: true });
  const sent: any[] = [], pending: Promise<unknown>[] = [];
  Object.defineProperty(win.navigator, "sendBeacon", { configurable: true, value: (_u: string, blob: Blob) => { pending.push(blob.text().then((t) => { sent.push(JSON.parse(t)); })); return true; } });
  win.fetch = async () => new Response(null, { status: 204 });
  new Function("window", `with (window) { ${CODE}\n}`).call(win, win);
  return { win, sent, flush: async () => { win.TBV.flush(); await Promise.all(pending.splice(0)); } };
}

describe("a visitor code from another of our sites", () => {
  test("it is adopted, removed from the address, stored, sent as the visitor code, and the earlier code is told once as ov", async () => {
    const s = open(`#cv=${NEW}`, { stored: OLD });
    expect(s.win.TBV.vid).toBe(NEW); expect(s.win.location.hash).toBe(""); expect(s.win.localStorage.getItem(KEY)).toBe(NEW);
    await s.flush();
    expect(s.sent[0]).toMatchObject({ d: NEW, ov: OLD });
  });
  test("other parts of the # stay; a first-time visitor adopts it with no earlier code to tell; the same code again tells nothing", async () => {
    const a = open(`#a=1&cv=${NEW}`, { stored: OLD }); expect(a.win.location.hash).toBe("#a=1");
    const b = open(`#cv=${NEW}`); await b.flush(); expect(b.win.TBV.vid).toBe(NEW); expect(b.sent[0].ov).toBeUndefined();
    const c = open(`#cv=${NEW}`, { stored: NEW }); await c.flush(); expect(c.sent[0].ov).toBeUndefined();
  });
  test("with no # code the visitor's own code is kept and no ov is sent; a malformed code is ignored", async () => {
    const a = open("", { stored: OLD }); await a.flush(); expect(a.win.TBV.vid).toBe(OLD); expect(a.sent[0].ov).toBeUndefined();
    for (const bad of [`#cv=${NEW.slice(1)}`, `#cv=${NEW.toUpperCase()}`, `#cv=zz`, `#xcv=${NEW}`]) { const b = open(bad, { stored: OLD }); expect(b.win.TBV.vid).toBe(OLD); }
  });
  test("with Global Privacy Control nothing is adopted, stored or sent about the visitor", async () => {
    const s = open(`#cv=${NEW}`, { gpc: true, stored: OLD }); await s.flush();
    expect(s.win.TBV.vid).toBe(""); expect(s.sent[0].d).toBeUndefined(); expect(s.sent[0].ov).toBeUndefined();
    expect(s.win.localStorage.getItem(KEY)).toBe(OLD); // untouched
  });
});
