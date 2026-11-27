// Shared parts of the payment-page tests (pay-persist.test.ts, pay-country.test.ts): open the real page in a DOM that talks to the REAL Worker, type like a person, watch what the page sends.
import { expect } from "bun:test";
import { newWorld, roundAt, T, type Page } from "./harness";

export const START = roundAt(T) + 1200; // one hour after T
export const KIT = ["common.js", "payfields.js", "paykit.js"];
export const val = (p: Page, sel: string) => (p.$(sel) as any)?.value as string | undefined;
export const snap = (p: Page, sels: string[]) => Object.fromEntries(sels.map((s) => [s, val(p, s)]));
/** Types into a box the way a person does: the value changes and the page is told. */
export const type = (p: Page, sel: string, v: string) => { const el: any = p.$(sel); if (!el) throw new Error("no box " + sel); el.value = v; el.dispatchEvent(new p.win.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); };
export const fillAll = (p: Page, f: Record<string, string>) => { for (const [s, v] of Object.entries(f)) type(p, s, v); };
/** The words in the red message box (empty while it is hidden). */
export const errText = (p: Page) => { const e: any = p.$("#pk-err"); return e && !e.hidden ? String(e.textContent || "").replace(/\s+/g, " ").trim() : ""; };
export const dump = (st: any) => { const o: Record<string, string> = {}; for (let i = 0; i < st.length; i++) { const k = st.key(i); o[k] = st.getItem(k); } return o; };
/** Everything a page keeps in this tab, to hand to the "reloaded" page (a reload keeps the tab's sessionStorage). */
export const tabOf = (p: Page) => dump(p.win.sessionStorage);

export type Seen = string[] & { bodies: Record<string, any>[] };
/** Records every request the page makes (and the JSON body of each); a request that matches is answered by `reply` instead of the Worker. */
export function watch(p: Page, rules: { method: string; match: RegExp; reply: () => Response }[] = []): Seen {
  const real = p.win.fetch, seen = Object.assign([] as string[], { bodies: [] as Record<string, any>[] }) as Seen;
  p.win.fetch = async (u: any, init?: any) => {
    const m = String(init?.method || "GET").toUpperCase(), path = String(u);
    seen.push(m + " " + path);
    let body: any = {}; try { body = init?.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
    seen.bodies.push({ at: m + " " + path, ...body });
    const r = rules.find((x) => x.method === m && x.match.test(path));
    return r ? r.reply() : real(u, init);
  };
  return seen;
}
export const reply = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const closeRazorpay = (p: Page) => { p.win.TB.pay = async () => { throw Object.assign(new Error("The payment window was closed."), { cancelled: true }); }; };
export const failRazorpay = (p: Page) => { p.win.TB.pay = async () => { throw Object.assign(new Error("Razorpay could not start. Please try again."), { status: 502 }); }; };

/** `afterLoad` for openPage: every request of the page carries the network's country header, as Cloudflare adds it (a page opened without this has no header at all). */
export const fromCountry = (cc: string) => (win: any) => {
  if (win.__cc) return; win.__cc = cc;
  const real = win.fetch;
  win.fetch = (u: any, init: any = {}) => real(u, { ...init, headers: { ...(init.headers || {}), "cf-ipcountry": cc } });
};

export async function organizer(extra: Record<string, string> = {}) {
  const w = newWorld(extra);
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  return { ...w, token: s.token as string, aiKey: s.aiKey as string };
}
export type O = Awaited<ReturnType<typeof organizer>>;
export const published = async (o: O, id: string, name: string) => {
  expect((await o.api("POST", "/api/z", { id, startRound: START, callSeconds: 9, cap: 100, join: "phone", name }, o.aiKey)).status).toBe(200);
  expect((await o.api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, o.token)).status).toBe(200);
};
export const draftOnly = async (o: O, id: string, name: string) => { expect((await o.api("POST", "/api/z", { id, startRound: START, callSeconds: 9, cap: 100, join: "phone", name }, o.aiKey)).status).toBe(200); };
export const linkOf = async (o: O, id: string) => { const r = await o.api("POST", `/api/z/${id}/paylink`, {}, o.token); expect(r.status).toBe(200); return new URL((await o.json(r)).url).searchParams.get("t")!; };
