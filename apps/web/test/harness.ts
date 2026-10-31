process.env.TZ = "Asia/Kolkata"; // the tests read dates as India time
// A tiny page harness: loads the real page scripts from apps/web/public into a DOM (happy-dom), with fetch wired straight to the real Worker code and
// an in-memory database, so the console, payment page, big screen and phone page are tested as the browser runs them.
import { Window } from "happy-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Env } from "../../edge/src/worker";
import { handle } from "../../edge/test/with-terms";
import { makeD1 } from "../../edge/test/d1-sqlite";

const PUB = join(import.meta.dir, "../public");
/** The test clock starts at the real hour, so pages (which read the real clock) and the Worker (which reads this one) agree that "now" is now. Never a fixed date: a fixed date goes stale and every game starts "in the past". */
export const T = Math.floor(Date.now() / 3_600_000) * 3_600_000;
/** The calendar date (YYYY-MM-DD) in India time, `days` after T. */
export const istDate = (days: number, from = T) => new Date(from + days * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
/** "3 Oct 2026" for a YYYY-MM-DD date, written the way the console writes it. */
export const friendlyDay = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m! - 1]} ${y}`; };
export const GEN = 1692803367;
export const roundAt = (ms: number) => Math.floor((ms / 1000 - GEN) / 3) + 1;
export const roundMs = (r: number) => (GEN + (r - 1) * 3) * 1000;

export function newWorld(extra: Record<string, string> = {}) {
  const d = makeD1();
  const env = { DB: d.db, ORGANIZER_SECRET: "plat", DAILY_WRITE_BUDGET: "1000000", PUBLIC_ORIGIN: "http://localhost", PHONE_SALT: "salt", ...extra } as unknown as Env;
  const world = { env, raw: d.raw, now: T };
  const api = (method: string, path: string, body?: unknown, key?: string, now = world.now) =>
    handle(new Request("http://localhost" + path, { method, headers: { "content-type": "application/json", ...(key ? { "x-organizer": key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env, now);
  return { world, api, json: async (r: Response) => (await r.json()) as any };
}

export type Page = { win: any; text: () => string; html: () => string; $: (sel: string) => any; click: (sel: string) => void; waitFor: (pred: (text: string) => boolean, ms?: number) => Promise<string>; close: () => Promise<void>; errors: string[] };

/** scripts: file names under apps/web/public, in the order the page loads them. */
export async function openPage(world: { env: Env; now: number }, o: { url: string; html: string; scripts: string[]; session?: Record<string, string>; beaconNowMs?: () => number; afterLoad?: (win: any, file: string) => void }): Promise<Page> {
  const win: any = new Window({ url: o.url, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const errors: string[] = [];
  // the page scripts run as `with (window)`: the typed arrays a real browser has must be visible to them too
  for (const n of ["Uint8Array", "Int8Array", "Uint16Array", "Uint32Array", "Int16Array", "Int32Array", "Float64Array"]) if (!win[n]) win[n] = (globalThis as any)[n];
  win.document.write(readFileSync(join(PUB, o.html), "utf8").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<link[^>]*>/g, ""));
  for (const [k, v] of Object.entries(o.session ?? {})) win.sessionStorage.setItem(k, v);
  win.fetch = async (input: any, init?: any) => { // the page talks to the real Worker; nothing else is reachable
    const u = new URL(String(input), "http://localhost");
    if (u.origin !== "http://localhost") throw new Error("offline: " + u.origin);
    return handle(new Request(u, init), world.env, world.now);
  };
  // inside the page scope the DOM window shadows the real globals; fill in anything it does not provide
  for (const k of ["encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "parseInt", "parseFloat", "isNaN", "isFinite", "Math", "JSON", "Date", "Array", "Object", "Promise", "Set", "Map", "WeakMap", "String", "Number", "Boolean", "RegExp", "Error", "TypeError", "RangeError", "Uint8Array", "Uint32Array", "ArrayBuffer", "DataView", "Symbol", "Intl", "BigInt", "TextEncoder", "TextDecoder", "atob", "btoa", "crypto", "Blob", "URL", "URLSearchParams", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "structuredClone", "Request", "Response", "Headers"])
    if ((win as any)[k] === undefined && (globalThis as any)[k] !== undefined) (win as any)[k] = (globalThis as any)[k];
  // the page reads the clock with Date.now(): give it the test's clock, so "an hour before the start" means that in the test too
  win.Date = class extends Date { static now() { return world.now; } constructor(...a: any[]) { if (a.length) super(...(a as [any])); else super(world.now); } };
  try { Object.defineProperty(win, "indexedDB", { value: undefined, configurable: true }); } catch { /* the signing-key store needs a real browser; the page treats it as unavailable */ }
  win.addEventListener("error", (e: any) => errors.push(String(e?.message ?? e)));
  win.addEventListener("unhandledrejection", (e: any) => errors.push(String(e?.reason?.message ?? e?.reason ?? e)));
  for (const f of o.scripts.includes("keep.js") ? o.scripts : ["keep.js", ...o.scripts]) { // keep.js (staying signed in) is the first script of every real page that has a sign-in
    const code = readFileSync(join(PUB, f), "utf8");
    try { new Function("window", `with (window) { ${code}\n}`).call(win, win); } catch (e: any) { errors.push(f + ": " + e.message); }
    o.afterLoad?.(win, f);
    if (f === "zgame.js" && win.ZG) { // the real public randomness is not reachable from a test: the clock is the test's own
      win.ZG.fetchRound = async () => ({ round: roundAt(o.beaconNowMs ? o.beaconNowMs() : world.now), randomness: "00".repeat(32), signature: "aa" });
    }
  }
  const tickBoxes = () => { win.document.querySelectorAll(".tb input[type=checkbox]").forEach((c: any) => { if (!c.checked) { c.checked = true; c.dispatchEvent(new win.Event("change", { bubbles: true })); } }); };
  const text = () => String(win.document.getElementById("app")?.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    win, errors, text, html: () => String(win.document.getElementById("app")?.innerHTML ?? ""),
    $: (sel) => win.document.querySelector(sel),
    click: (sel) => { tickBoxes(); const el = win.document.querySelector(sel); if (!el) throw new Error("no element " + sel); el.click(); },
    waitFor: async (pred, ms = 6000) => { const t0 = Date.now(); for (;;) { tickBoxes(); const t = text(); if (pred(t)) return t; if (Date.now() - t0 > ms) throw new Error("timed out waiting; page says: " + t.slice(0, 1200) + (errors.length ? " | errors: " + errors.join("; ").slice(0, 300) : "")); await new Promise((r) => setTimeout(r, 40)); } },
    close: async () => { try { await win.happyDOM.close(); } catch { /* already closed */ } },
  };
}
