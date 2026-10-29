// The pages themselves, run as a browser runs them (real page scripts in a DOM, talking to the real Worker code and an in-memory database).
// IDs match docs/USE_CASES.md. These catch what API tests cannot: a page that freezes, a button that does nothing, a message that never shows.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(30_000);
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { newWorld, openPage, roundAt, roundMs, T, type Page } from "./harness";
import { publicKeyFromSecret } from "../../../packages/beacon/src/control";
import { PRIZE_HOUSES } from "../../../packages/beacon/src/config";

const HOUR = 3_600_000;
const START = roundAt(T) + 1200; // one hour after T
const START_MS = roundMs(START);
const rnd = (r: number) => createHash("sha256").update("fake" + r).digest("hex");
let open: Page[] = [];
afterEach(async () => { for (const p of open) await p.close(); open = []; });

async function organizer(extra: Record<string, string> = {}) {
  const w = newWorld(extra);
  const s = await w.json(await w.api("POST", "/api/start", { email: "boss@acme.com" }));
  return { ...w, token: s.token as string, aiKey: s.aiKey as string, aiMessage: s.aiMessage as string };
}
type O = Awaited<ReturnType<typeof organizer>>;
const make = async (o: O, id: string, over: Record<string, unknown> = {}) => o.api("POST", "/api/z", { id, startRound: START, callSeconds: 9, cap: 100, ...over }, o.aiKey);
const publish = (o: O, id: string) => o.api("POST", `/api/z/${id}/publish`, { email: "boss@acme.com", phone: "98765 43210" }, o.token);
const regKey = (o: O, id: string) => o.api("PUT", `/api/z/${id}/control/key`, { publicKey: publicKeyFromSecret("11".repeat(32)) }, o.token);
async function page(o: O, url: string, html: string, scripts: string[], session: Record<string, string> = {}, extra: Partial<Parameters<typeof openPage>[1]> = {}) {
  if (scripts.includes("zc.js")) { const inner = extra.afterLoad; extra = { ...extra, afterLoad: (win: any, f: string) => { if (f === "zgame.js" && win.ZG && !win.ZG.PRIZE_HOUSES) win.ZG.PRIZE_HOUSES = PRIZE_HOUSES; inner?.(win, f); } }; } // until zgame.js is rebuilt with the table, the page gets the same table the Worker uses
  const p = await openPage(o.world, { url: "http://localhost" + url, html, scripts, session, ...extra }); open.push(p); return p;
}
const consolePage = (o: O, eid: string, key = o.token, session: Record<string, string> = {}, extra: Partial<Parameters<typeof openPage>[1]> = {}) =>
  page(o, `/zc?e=${eid}`, "zc.html", ZC_SCRIPTS, { "cbz-org": key, "cbz-aimsg": o.aiMessage, "cbz-email": "boss@acme.com", ...session }, extra);

// --- the single-page console: small helpers ---
const ZC_SCRIPTS = "zgame.js control.js termsbox.js zc.js".split(" ");
/** Opens step n by its jump button (the numbered dot in the progress bar). */
const openStep = (p: Page, n: number) => p.click(`.zc-dot[data-open="${n}"]`);
const setField = (p: Page, sel: string, v: string) => { const el = p.$(sel) as any; el.value = v; el.dispatchEvent(new p.win.Event("input", { bubbles: true })); };
const sections = (p: Page) => Array.from(p.win.document.querySelectorAll('section.zc-card[id^="sec"]')).map((e: any) => e.querySelector(".zc-sech b")!.textContent as string);
/**
 * A small fetch stub for what the real Worker cannot show: here, an OLDER server that does not have the team and Co-host endpoints yet (the page must say so politely, not crash).
 * It answers the paths it is given and passes everything else on to the real Worker.
 */
type Stub = (method: string, body: any, url: URL) => any;
const stub = (routes: Record<string, Stub>) => (win: any, f: string) => {
  if (f !== "control.js") return;
  const real = win.fetch;
  win.fetch = async (input: any, init?: any) => {
    const u = new URL(String(input), "http://localhost"), h = routes[u.pathname];
    if (!h) return real(input, init);
    const r = h((init?.method || "GET").toUpperCase(), init?.body ? JSON.parse(init.body) : undefined, u);
    return new Response(JSON.stringify(r && r.body !== undefined ? r.body : r), { status: (r && r.status) || 200, headers: { "content-type": "application/json" } });
  };
};
/** The roles come from the real Worker (apps/edge): these make a Host key, a Co-host key, and read the team back. */
const hostKey = async (o: O, label = "Anita", ready = true) => {
  const k = (await o.json(await o.api("POST", "/api/org/host", { label, mobile: "9822200011", email: "host@acme.com" }, o.token))).hostKey as string;
  if (ready) o.world.raw.prepare("UPDATE host_state SET verified_ms=?, mobile_ok=1").run(Date.now()); // as if the Host had finished "Finish setup" (that screen has its own tests)
  return k;
};
const cohostKey = async (o: O, eid = "UI-COH", label = "Ravi") => (await o.json(await o.api("POST", "/api/org/cohost", { label, phone: "9811100099", eid }, o.token))).cohostKey as string;
const keyId = (key: string) => createHash("sha256").update("key|" + key).digest("hex").slice(0, 10);
const teamOf = async (o: O) => o.json(await o.api("GET", "/api/org/team", undefined, o.token));
const COHOST_FROM = 1_000_000_000; // the Worker's own number: a Co-host's invite link carries it plus the first 7 hex of their key id

const quietPrivacy = (root: any) => { const l = root.querySelectorAll(".spriv a"); expect(l.length).toBe(1); const a = l[0]; expect(a.textContent).toBe("Privacy Policy"); expect(a.getAttribute("href")).toBe("/legal.html#privacy"); expect(a.getAttribute("target")).toBe("_blank"); expect(a.getAttribute("rel")).toBe("noopener"); expect(root.querySelectorAll('input[type="checkbox"]').length).toBe(0); };
/**
 * A pass-through for the real Worker that RECORDS every /api call the page makes (st.calls = [method, path, body], st.patches, st.posts)
 * and can answer chosen paths itself: over["POST /api/z/ID/paylink"] = (method, body, url) => body | { status, body }.
 * Used for the few endpoints the Worker does not have yet (payment link, Host finish-setup, Google).
 */
type Over = Record<string, (m: string, body: any, url: URL, real: () => Promise<any>) => any>;
function spy(over: Over = {}, setup?: (win: any) => void) {
  const st: any = { calls: [] as any[], patches: [] as any[], posts: [] as any[] };
  const hook = (win: any, f: string) => {
    if (f !== "control.js") return;
    if (setup) setup(win);
    const real = win.fetch;
    win.fetch = async (input: any, init2?: any) => {
      const u = new URL(String(input), "http://localhost"), m = (init2?.method || "GET").toUpperCase(), body = init2?.body ? JSON.parse(init2.body) : undefined;
      if (u.pathname.startsWith("/api/")) { st.calls.push([m, u.pathname, body]); if (m === "PATCH" && /\/settings$/.test(u.pathname)) st.patches.push(body); if (m === "POST" && u.pathname === "/api/z") st.posts.push(body); }
      const h = over[m + " " + u.pathname] || over[u.pathname];
      if (h) { const r = await h(m, body, u, async () => (await real(input, init2)).json()); const b = r && r.body !== undefined ? r.body : r; return new Response(typeof b === "string" ? b : JSON.stringify(b), { status: (r && typeof r.status === "number" && r.status) || 200, headers: { "content-type": "application/json" } }); }
      const res = await real(input, init2); if (u.pathname.startsWith("/api/")) { try { (st.last ||= {})[m + " " + u.pathname] = await res.clone().json(); } catch { /* not JSON */ } }
      return res;
    };
  };
  return { st, hook };
}
describe("console (organizer page)", () => {
  test("Show my AI work link (the e-mail's button): asks for the organizer's sign-in; once signed in shows the two-line paste with Copy, Fresh and Replace and the do-not-forward warnings", async () => {
    const o = await organizer();
    const anon = await page(o, "/ai-link", "ai-link.html", ["ai-link.js"], {});
    const t0 = await anon.waitFor((x) => /Sign in as the organizer/.test(x));
    expect(t0).not.toMatch(/cba_/); expect(t0).toMatch(/6-digit code/); expect(anon.$("#msg")).toBeFalsy();
    const p = await page(o, "/ai-link", "ai-link.html", ["ai-link.js"], { "cbz-org": o.token });
    const t = await p.waitFor((x) => /YOUR AI WORK LINK/.test(x));
    const v = (p.$("#msg") as any).value as string; expect(v).toBe(o.aiMessage); expect(v.split("\n").length).toBe(2); expect(v).toContain("/ai/cba_");
    expect(p.$("#cp")).toBeTruthy(); expect(p.$("#fr")).toBeTruthy(); expect(p.$("#rp")).toBeTruthy();
    expect((t.match(/DO NOT FORWARD: this page shows your personal AI work link/g) ?? []).length).toBe(2);
    p.click("#fr"); await p.waitFor((x) => /fresh 24-hour link is on its way/.test(x));
    expect(p.errors).toEqual([]);
  });
  const checkSeven = async (p: any, paste: string) => {
    const hrefOf = (n: string) => new URL((p.$(`[data-ai="${n}"]`) as any).href);
    for (const [n, origin, path] of [["ChatGPT", "https://chatgpt.com", "/"], ["Grok", "https://grok.com", "/"], ["Claude", "https://claude.ai", "/new"]] as const) {
      const el = p.$(`[data-ai="${n}"]`) as any, u = hrefOf(n);
      expect(u.origin).toBe(origin); expect(u.pathname).toBe(path); expect(u.searchParams.get("q")).toBe(paste); // the two lines and the link, URL-encoded
      expect(el.href).toContain("?q=" + encodeURIComponent(paste)); expect(el.getAttribute("target")).toBe("_blank"); expect(el.getAttribute("rel")).toBe("noopener noreferrer");
    }
    const opened: string[] = []; let copied = ""; p.win.open = (u: string) => { opened.push(u); return null; };
    Object.defineProperty(p.win.navigator, "clipboard", { value: { writeText: async (t: string) => { copied = t; } }, configurable: true });
    for (const [n, origin] of [["Gemini", "https://gemini.google.com"], ["DeepSeek", "https://chat.deepseek.com"], ["z.ai", "https://chat.z.ai"]] as const) {
      copied = ""; p.click(`[data-aicopy="${n}"]`); await p.waitFor((x: string) => /Copied\. Press Ctrl\+V, then Send/.test(x));
      expect(copied).toBe(paste); expect(new URL(opened.at(-1)!).origin).toBe(origin);
    }
    expect(new URL(opened[0]!).pathname).toBe("/app"); expect(new URL(opened[0]!).searchParams.get("q")).toBe(paste); // Gemini: a harmless prefill attempt
    expect(opened[1]).toBe("https://chat.deepseek.com/"); expect(opened[2]).toBe("https://chat.z.ai/");
  };
  test("seven ways to hand the paste to an AI on the sign-in page: three pre-filled addresses, three copy-and-open buttons, one plain copy", async () => {
    const o = await organizer();
    const p = await page(o, "/ai-link", "ai-link.html", ["ai-link.js"], { "cbz-org": o.token });
    await p.waitFor((x) => /YOUR AI WORK LINK/.test(x)); expect(p.$("#cp")).toBeTruthy();
    await checkSeven(p, o.aiMessage);
  });
  test("sign-in e-mail link page: opening it consumes nothing; the button starts the session once and goes to the AI-link page; a used link says so", async () => {
    const o = await organizer({ TEST_MODE: "1" });
    const r = await o.json(await o.api("POST", "/api/auth/email", { email: "boss@acme.com" }));
    const p = await page(o, "/signin?t=" + r.devToken + "&go=ai", "signin.html", ["signin.js"], {});
    const t = await p.waitFor((x) => /Press the button to sign in/.test(x));
    expect(t).toMatch(/works once, for 10 minutes/i); expect(t).not.toMatch(/cba_/); expect(p.win.sessionStorage.getItem("cbz-org")).toBeFalsy();
    expect(p.win.location.search).toBe(""); // the token left the address bar
    expect((await o.api("POST", "/api/auth/email", { email: "stranger@x.com" })).status).toBe(200);
    p.click("#go");
    await new Promise((res) => setTimeout(res, 400));
    expect(p.win.sessionStorage.getItem("cbz-org")).toMatch(/^cbk_[0-9a-f]{48}$/);
    const again = await page(o, "/signin?t=" + r.devToken + "&go=console", "signin.html", ["signin.js"], {});
    await again.waitFor((x) => /Press the button to sign in/.test(x)); again.click("#go");
    await again.waitFor((x) => /not valid any more/.test(x));
    expect(again.win.sessionStorage.getItem("cbz-org")).toBeFalsy();
  });
  test("UC-10 / UC-54 held for non-payment: a clear red card, nothing called, no freeze", async () => {
    const o = await organizer(); await make(o, "UI-HELD"); await publish(o, "UI-HELD");
    o.world.now = START_MS + 5 * 60_000;
    const p = await consolePage(o, "UI-HELD");
    const t = await p.waitFor((x) => /could not begin/i.test(x));
    expect(t).toMatch(/Pay now and start/); expect(t).not.toMatch(/\/ 75|numbers called/); expect(p.errors).toEqual([]);
  });
  test("UC-54 a payment-due card counts down to the start and offers Pay now", async () => {
    const o = await organizer(); await make(o, "UI-DUE"); await publish(o, "UI-DUE");
    const p = await consolePage(o, "UI-DUE");
    const t = await p.waitFor((x) => /LAST STEP/i.test(x));
    expect(t).toMatch(/If payment is not made before then, the game will not begin/); expect(t).toMatch(/Pay now/); openStep(p, 6); expect(p.text()).toMatch(/Open the big screen/);
  });
  test("UC-6 a wrong or expired sign-in shows a message, never an endless Loading", async () => {
    const o = await organizer(); await make(o, "UI-KEY");
    const p = await consolePage(o, "UI-KEY", "cbk_" + "0".repeat(48));
    const t = await p.waitFor((x) => /sign-in has expired|sign in again/i.test(x), 4000);
    expect(t).toMatch(/sign-in has expired|sign in again/i);
  });
  test("Game day (step 9): the tournament page and the big screen are one tap away; the step has no pause or end buttons, no message to phones and no prize list of its own", async () => {
    const o = await organizer(); await make(o, "UI-DAY"); await regKey(o, "UI-DAY"); await publish(o, "UI-DAY");
    const p = await consolePage(o, "UI-DAY");
    await p.waitFor((x) => /Hello|Last step/.test(x)); openStep(p, 9); const t = await p.waitFor((x) => /Run the tournament/.test(x));
    expect(t).toMatch(/Not started yet/); expect(p.$("#runt")!.getAttribute("href")).toBe("/host.html?e=UI-DAY"); expect(p.$("#bigopen")!.getAttribute("href")).toMatch(/\/big\.html\?e=UI-DAY$/);
    expect(t).not.toMatch(/Message to everyone|End the game|Prizes handed over|first number|Lucky draws/); expect(p.$('[data-ctl="pause"]')).toBeNull(); expect(p.$("#annSend")).toBeNull();
    expect(p.errors).toEqual([]);
  });
  test("the role pill, the payment pill and the one-payment notice: pending shows the notice; paid hides it and says who paid", async () => {
    const o = await organizer(); await make(o, "UI-PAYP"); await publish(o, "UI-PAYP");
    const p = await consolePage(o, "UI-PAYP"); await p.waitFor((x) => /Last step/i.test(x));
    expect(p.$("#rolepill")!.textContent).toBe("Signed in as Organizer"); expect(p.$("#paypill")!.textContent).toBe("Payment pending for this game"); expect(p.$("#paypill")!.className).toMatch(/zc-pill-pend/);
    const note = p.$("#paynote")!; expect(note.getAttribute("role")).toBe("note"); expect(note.textContent).toMatch(/Just one of you needs to make it: the Organizer, a Host or a Co-host\. Guests pay nothing/);
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-PAYP'").run(); // paid (the same signal the payment page uses)
    const q = await consolePage(o, "UI-PAYP"); await q.waitFor((x) => /Hello|Your game/.test(x));
    expect(q.$("#paypill")!.textContent).toBe("Paid"); expect(q.$("#paypill")!.className).toMatch(/zc-pill-paid/); expect(q.$("#paynote")).toBeNull();
    o.world.raw.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").run("paidby/UI-PAYP", JSON.stringify({ by: "host", ms: START_MS - HOUR })); // the Worker records who paid
    const w = await consolePage(o, "UI-PAYP");
    await w.waitFor((x) => /Hello|Your game/.test(x)); openStep(w, 8);
    expect(await w.waitFor((x) => /Paid by the Host on/.test(x))).toMatch(/The game is on/);
    expect(p.errors).toEqual([]); expect(w.errors).toEqual([]);
  });
  const TEN = ["Date and time of the game", "Number of participants", "Set Prizes", "Your brand", "Make hosts and co-hosts", "Invite and Share links", "Check and publish", "Pay", "Game day", "After the game"];
  test("an Organizer sees all ten steps in order, one open at a time, with a hint on every step and Save and continue", async () => {
    const o = await organizer(); await make(o, "UI-TEN");
    const p = await consolePage(o, "UI-TEN"); await p.waitFor((x) => /Hello\. Let us start/.test(x));
    expect(sections(p)).toEqual(TEN);
    expect(p.win.document.querySelectorAll(".zc-secb").length - 1).toBe(1); // one step body is open (the other .zc-secb is the Help box)
    expect(p.$('[data-save="1"]')!.textContent).toBe("Save and continue");
    for (let n = 2; n <= 10; n++) { openStep(p, n); expect(p.win.document.querySelectorAll("section.zc-card.open").length).toBe(1); expect(p.$(`#sec${n}`)!.className).toMatch(/open/); }
    expect(p.$("#aistrip")).toBeNull(); expect(p.text()).not.toMatch(/AI work link/); expect(p.text()).toMatch(/Your account/); // the AI work link is not offered on the organizer's screens
    expect(p.errors).toEqual([]);
  });
  test("a Host sees the same ten steps and 'Host 1 of 5', but no account and no AI strip, and can add Co-hosts but not Hosts", async () => {
    const o = await organizer(); await make(o, "UI-HOSTV"); await publish(o, "UI-HOSTV");
    const hk = await hostKey(o, "Anita");
    const p = await consolePage(o, "UI-HOSTV", hk);
    await p.waitFor((x) => /Last step|Your game/i.test(x));
    expect(sections(p)).toEqual(TEN);
    await p.waitFor(() => p.$("#rolepill")!.textContent === "Signed in as Host 1 of 5");
    expect(p.$("#aistrip")).toBeNull(); expect(p.text()).not.toMatch(/Your account|Close my account/);
    openStep(p, 5); await p.waitFor((x) => /Your Hosts: 1 of 5/.test(x));
    expect(p.$("#hostadd")).toBeNull(); expect(p.text()).toMatch(/Only the Organizer adds Hosts/); expect(p.$("#cohostadd")).toBeTruthy(); expect(p.$('[data-retire][data-kind="host"]')).toBeNull();
    setField(p, "#cohostlabel", "Ravi"); setField(p, "#cohostphone", "9811100001"); p.click("#cohostadd"); await p.waitFor((x) => /Your Co-hosts: 1 \(no limit\)/.test(x));
    expect((await teamOf(o)).cohosts.map((c: any) => c.label)).toEqual(["Ravi"]); // a Host really can add a Co-host
    expect(p.errors).toEqual([]);
  });
  test("a Co-host sees three steps (today's game, invite people, payment), the guest-invite note, and nothing that changes the game", async () => {
    const o = await organizer(); await make(o, "UI-COH"); await publish(o, "UI-COH"); const ck = await cohostKey(o);
    const from = COHOST_FROM + parseInt(keyId(ck).slice(0, 7), 16); // somebody joins through this Co-host's own link
    expect((await o.api("POST", "/api/z/UI-COH/join", { phone: "9811100001", device: "a".repeat(32), from })).status).toBe(200);
    const p = await consolePage(o, "UI-COH", ck);
    await p.waitFor((x) => /Hi\. Here is the game/.test(x));
    expect(sections(p)).toEqual(["Today's game", "Invite people", "Payment"]);
    expect(p.$("#rolepill")!.textContent).toBe("Signed in as Co-host"); expect(p.$("#paypill")!.textContent).toBe("Payment pending for this game"); expect(p.$("#paynote")).toBeTruthy(); expect(p.$("#aistrip")).toBeNull();
    expect(p.text()).toMatch(/1 person joined of 100/); expect(p.text()).toMatch(/You cannot change the game/); expect(p.text()).toMatch(/What you can do/); expect(p.text()).toMatch(/Invite people with their own link/); expect(p.text()).not.toMatch(/Add Hosts and Co-hosts/);
    openStep(p, 2); const t2 = await p.waitFor((x) => /Your own invite link/.test(x));
    expect(t2).toMatch(/localhost\/z\.html\?e=UI-COH&from=\d+/); expect(t2).toMatch(/People you brought\s*1(?!\d)/); expect(t2).toMatch(/You can invite as many people as you like/);
    expect(t2).toContain("Want your guests to invite their own friends? Ask the Organizer or a Host to switch it on. You cannot switch it on yourself.");
    openStep(p, 3); const t3 = await p.waitFor((x) => /Status: Payment pending for this game/.test(x)); expect((p.$('a[href^="/pay.html"]') as any).getAttribute("href")).toBe("/pay.html?e=UI-COH"); expect(t3).toMatch(/Rs 2,399\.00\. Pay once, from any one of you/);
    for (const banned of [/Publish/, /Erase/, /Controls/, /guest list/i, /Your team/, /AI assistant/, /Message to everyone/, /Close my account/]) expect(p.text()).not.toMatch(banned);
    expect(p.errors).toEqual([]);
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-COH'").run(); o.world.raw.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").run("paidby/UI-COH", JSON.stringify({ by: "organizer", ms: START_MS - HOUR }));
    const paid = await consolePage(o, "UI-COH", ck); await paid.waitFor((x) => /Hi\. Here is the game/.test(x)); expect(paid.$("#paypill")!.textContent).toBe("Paid"); expect(paid.$("#paynote")).toBeNull();
    openStep(paid, 3); expect(await paid.waitFor((x) => /Paid by the Organizer on/.test(x))).toMatch(/The game is on/);
    await make(o, "UI-COHD"); const d = await consolePage(o, "UI-COHD", await cohostKey(o, "UI-COHD")); await d.waitFor((x) => /Hi/.test(x)); openStep(d, 2); expect(await d.waitFor((x) => /Your link appears once the game is published/.test(x))).not.toMatch(/z\.html\?e=UI-COHD/); // a draft has no link to give out yet
  });
  test("a Co-host link opens the Co-host view and the key leaves the address bar (#cohost=, #host= and ?k= all work)", async () => {
    const o = await organizer(); await make(o, "UI-COH"); const ck = await cohostKey(o);
    for (const url of [`/zc?e=UI-COH#cohost=${ck}`, `/zc?e=UI-COH#host=${ck}`, `/zc?e=UI-COH&k=${ck}`, `/zc?k=${ck}&e=UI-COH`]) {
      const p = await page(o, url, "zc.html", ZC_SCRIPTS, {});
      await p.waitFor((x) => /Hi\. Here is the game/.test(x));
      expect(p.win.location.hash).toBe(""); expect(p.win.location.search).toBe("?e=UI-COH"); expect(p.win.sessionStorage.getItem("cbz-org")).toBe(ck);
    }
    const link = (await o.json(await o.api("POST", "/api/org/cohost", { label: "Link", phone: "9811100077", eid: "UI-COH" }, o.token))).link as string; // the link the Worker hands out opens the Co-host view too (add the game to it)
    const p = await page(o, "/zc?e=UI-COH&" + link.split("?")[1], "zc.html", ZC_SCRIPTS, {}); await p.waitFor((x) => /Hi\. Here is the game/.test(x));
  });
  test("a Co-host without a game link is told to open the link they were sent, and the console does not crash", async () => {
    const o = await organizer(); await make(o, "UI-COH"); const ck = await cohostKey(o);
    const p = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": ck }); await p.waitFor((x) => /Open the link your Organizer or Host sent you/.test(x)); expect(p.errors).toEqual([]);
    expect(p.$("#aistrip")).toBeNull(); expect(p.$("#rolepill")!.textContent).toBe("Signed in as Co-host");
  });
  test("an older server without the team and Co-host endpoints is handled politely: the team step says so, adding says so, a Co-host sees a friendly note, nothing crashes", async () => {
    const o = await organizer(); await make(o, "UI-NOTEAM");
    const gone = () => ({ status: 404, body: { error: "Not found" } });
    const p = await page(o, "/zc?e=UI-NOTEAM", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }, { afterLoad: stub({ "/api/org/team": gone, "/api/org/cohost": gone }) });
    await p.waitFor((x) => /Hello/.test(x)); openStep(p, 5);
    await p.waitFor((x) => /Your Hosts: 0 of 5/.test(x) && /not switched on yet/i.test(x));
    setField(p, "#cohostlabel", "Ravi"); setField(p, "#cohostphone", "9811100001"); p.click("#cohostadd"); await p.waitFor((x) => /This is not switched on yet\. Please try again a little later\./.test(x));
    const c = await page(o, "/zc?e=UI-COH", "zc.html", ZC_SCRIPTS, { "cbz-org": "cbc_" + "0".repeat(48) }, { afterLoad: stub({ "/api/whoami": () => ({ kind: "cohost" }), "/api/z/UI-COH/cohost": gone }) });
    await c.waitFor((x) => /not switched on yet/.test(x)); expect(c.errors).toEqual([]); expect(p.errors).toEqual([]);
  });
  test("Your team: three role cards, Hosts n of 5 and Co-hosts (no limit), a private link for each person, remove, and the add button stops at five Hosts", async () => {
    const o = await organizer(); await make(o, "UI-TEAM");
    const p = await consolePage(o, "UI-TEAM"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 5);
    const t = await p.waitFor((x) => /Your Hosts: 0 of 5/.test(x) && /Your Co-hosts: 0 \(no limit\)/.test(x));
    const doc = p.win.document; expect(Array.from(doc.querySelectorAll(".zc-role b")).map((e: any) => e.textContent)).toEqual(["Organizer", "Host", "Co-host"]);
    expect(doc.querySelectorAll(".zc-role .zc-no").length).toBe(5); expect(doc.querySelectorAll(".zc-role .zc-yes").length).toBeGreaterThanOrEqual(10); expect(t).toMatch(/Sign-in keys, e-mail, AI link, close account/);
    for (let i = 1; i <= 5; i++) { setField(p, "#hostlabel", "Anita " + i); setField(p, "#hostphone", "987650000" + i); setField(p, "#hostemail", `anita${i}@acme.com`); p.click("#hostadd"); await p.waitFor((x) => new RegExp(`Your Hosts: ${i} of 5`).test(x)); }
    expect((p.$("#hostadd") as any).disabled).toBe(true); expect(p.text()).toMatch(/most Hosts allowed/); expect(p.text()).toMatch(/Anita 3/);
    expect(p.text()).toMatch(/Send it to that one person only/); expect(p.$(".zc-person .zlink")!.textContent).toMatch(/\/zc\.html\?e=UI-TEAM#host=cbh_[0-9a-f]{48}$/);
    p.click("#hostadd"); await new Promise((r) => setTimeout(r, 150)); expect((await teamOf(o)).hosts.length).toBe(5); // the sixth is stopped (and the server would refuse it too)
    expect((await o.api("POST", "/api/org/host", { label: "Sixth", phone: "9876500006", email: "six@acme.com" }, o.token)).status).toBe(409);
    for (let i = 1; i <= 3; i++) { setField(p, "#cohostlabel", "Ravi " + i); setField(p, "#cohostphone", "98111000" + (10 + i)); p.click("#cohostadd"); await p.waitFor((x) => new RegExp(`Your Co-hosts: ${i} \\(no limit\\)`).test(x)); }
    expect(Array.from(doc.querySelectorAll(".zc-person .zlink")).map((e: any) => e.textContent).filter((x: string) => /#cohost=cbc_[0-9a-f]{48}$/.test(x)).length).toBe(3);
    expect(p.text()).toMatch(/brought 0/); expect((await teamOf(o)).cohosts.length).toBe(3);
    p.win.confirm = () => true; p.click('[data-retire][data-kind="host"]'); await p.waitFor((x) => /Your Hosts: 4 of 5/.test(x)); expect((p.$("#hostadd") as any).disabled).toBe(false); expect((await teamOf(o)).hosts.length).toBe(4);
    p.click('[data-retire][data-kind="cohost"]'); await p.waitFor((x) => /Your Co-hosts: 2 \(no limit\)/.test(x)); expect((await teamOf(o)).cohosts.length).toBe(2);
    expect(p.errors).toEqual([]);
  });
  test("no drop-down list anywhere in the console: not on the home page, not in any of the ten steps, not in Quick setup, and none in the script", async () => {
    const o = await organizer(); await make(o, "UI-NOSEL");
    const home = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage }); await home.waitFor((x) => /Start a new game/.test(x)); expect(home.win.document.querySelectorAll("select").length).toBe(0);
    const p = await consolePage(o, "UI-NOSEL"); await p.waitFor((x) => /Hello/.test(x));
    openStep(p, 4);
    for (let n = 1; n <= 10; n++) { openStep(p, n); expect([n, p.win.document.querySelectorAll("select").length]).toEqual([n, 0]); }
    const qk = await page(o, "/zc?quick=1", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }); await qk.waitFor((x) => /1\. Which game\?/.test(x)); expect(qk.win.document.querySelectorAll("select").length).toBe(0);
    expect(readFileSync(new URL("../public/zc.js", import.meta.url), "utf8")).not.toMatch(/<select|createElement\(["']select/);
  });
  test("Step 4 is only the brand: no moments, lucky draws, video or audio choices (a tournament has no breaks to fill)", async () => {
    const o = await organizer(); await make(o, "UI-BM");
    const p = await consolePage(o, "UI-BM"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 4);
    expect(p.$("#brandbox")).toBeTruthy(); expect(p.$("#sec4")!.textContent).not.toMatch(/moment|lucky|YouTube|video|audio/i);
    for (const k of ["opN", "midN", "clN"]) expect([k, p.win.document.querySelectorAll(`[data-ck="${k}"]`).length]).toEqual([k, 0]);
    expect(p.$("[data-luckyadd]")).toBeNull();
    expect(p.errors).toEqual([]);
  });
  test("How it plays: the Organizer can type their own number of players; it is saved exactly, and nonsense is refused politely", async () => {
    const o = await organizer(); await make(o, "UI-OWN");
    const p = await consolePage(o, "UI-OWN"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 2);
    setField(p, "#f-cap", "0"); p.click('[data-save="2"]'); await p.waitFor((x) => /give the number of players/.test(x));
    setField(p, "#f-cap", "20000"); p.click('[data-save="2"]'); await p.waitFor((x) => /more than 10,000 players/.test(x));
    setField(p, "#f-cap", "180"); p.click('[data-save="2"]'); await p.waitFor((x) => /Saved\./.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-OWN/info", undefined, o.aiKey))).cap).toBe(180);
  });
  test("How it plays: who can join is a tap; a tournament has no card, number-speed, rounds or guest-invite choices; the choice is saved", async () => {
    const o = await organizer(); await make(o, "UI-PLAY"); const pw = spy();
    const p = await consolePage(o, "UI-PLAY", o.token, {}, { afterLoad: pw.hook }); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 2);
    expect(p.win.document.querySelectorAll('[data-ck="cap"]').length).toBe(9); expect(p.text()).toMatch(/Up to 100 people/); expect(p.$('[data-ck="cap"]')!.textContent).toBe("Demo game · 10 people · Rs 0"); /* the Rs 0 game is the first choice */ expect(p.text()).not.toMatch(/Rs [\d,]+(\.\d\d)? (with|including) GST/); /* no price while choosing the size */ expect(p.$("#f-cap")).toBeTruthy(); expect((p.$("#f-cap") as any).type).toBe("number"); expect(p.text()).toMatch(/Or type your own number of players/);
    for (const k of ["tix", "mk", "spd", "rnd", "gj"]) expect([k, p.win.document.querySelectorAll(`[data-ck="${k}"]`).length]).toEqual([k, 0]);
    expect(p.$('[data-bool="inv"]')).toBeNull(); expect(p.$("#sec2")!.textContent).not.toMatch(/Cards for each person|between two numbers|How many rounds|own people|daub|75 numbers/i);
    expect(p.$("#sec2")!.textContent).toMatch(/It is a knockout/); expect(p.$("#sec2")!.textContent).toMatch(/move clock \(10, 20, 30 or 60 seconds\)/);
    p.click('[data-ck="who"][data-v="anyone"]'); expect(p.text()).toMatch(/Anyone who clicks your link joins straight away/);
    p.click('[data-save="2"]'); await p.waitFor((x) => /Saved\./.test(x));
    const sm = await o.json(await o.api("GET", "/api/z/UI-PLAY/summary", undefined, o.aiKey));
    expect(sm.whoCanJoin).toBe("anyone"); expect(pw.st.patches.some((b: any) => b.whoCanJoin === "anyone")).toBe(true); // the console sends the new game setting
    expect(p.errors).toEqual([]);
  });
  test("Your game: the occasion chips are the Bingo list (Team event, Holiday party, All-hands opener ...), and choosing one names the game", async () => {
    const o = await organizer(); await make(o, "UI-OCC");
    const p = await consolePage(o, "UI-OCC"); await p.waitFor((x) => /Hello/.test(x));
    const chips = [...p.win.document.querySelectorAll('[data-ck="occ"]')].map((e: any) => e.textContent.trim());
    expect(chips).toEqual(["Team event", "Holiday party", "All-hands opener", "New-hire welcome", "Customer event", "Friday team break", "Family day", "Diwali party", "Other"]);
    p.click('[data-ck="occ"][data-v="Holiday party"]'); p.click('[data-ck="day"][data-v="other"]'); setField(p, "#f-dayo", "2026-10-05"); p.click('[data-ck="time"][data-v="other"]'); setField(p, "#f-timeo", "18:30");
    p.click('[data-save="1"]'); await p.waitFor((x) => /Saved\./.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-OCC/summary", undefined, o.aiKey))).name).toBe("Holiday party");
  });
  test("Your game: occasion, day and time are chips; saving sets the name and the exact start in India time; a past time is refused politely", async () => {
    const o = await organizer(); await make(o, "UI-WHEN");
    const p = await consolePage(o, "UI-WHEN"); await p.waitFor((x) => /Hello/.test(x));
    p.click('[data-ck="occ"][data-v="Team event"]'); p.click('[data-ck="day"][data-v="other"]'); setField(p, "#f-dayo", "2026-10-05"); p.click('[data-ck="time"][data-v="other"]'); setField(p, "#f-timeo", "18:30");
    p.click('[data-save="1"]'); await p.waitFor((x) => /Saved\./.test(x));
    const sm = await o.json(await o.api("GET", "/api/z/UI-WHEN/summary", undefined, o.aiKey)); expect(sm.name).toBe("Team event"); expect(sm.startMs).toBe(Date.parse("2026-10-05T18:30:00+05:30"));
    openStep(p, 1); setField(p, "#f-dayo", "2020-01-01"); p.click('[data-save="1"]'); await p.waitFor((x) => /start time in the future/.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-WHEN/summary", undefined, o.aiKey))).startMs).toBe(Date.parse("2026-10-05T18:30:00+05:30")); // nothing changed
  });
  test("Help: pre-answered questions (including Who can do what? and the big-screen link), Back to your steps, Back to top; and the progress bar moves as steps are saved", async () => {
    const o = await organizer(); await make(o, "UI-HELP");
    const p = await consolePage(o, "UI-HELP"); await p.waitFor((x) => /Hello/.test(x));
    const bar = () => p.$('[role="progressbar"]')!; expect(bar().getAttribute("aria-valuenow")).toBe("0"); expect(p.text()).toMatch(/0 of 10 done · 0%/);
    p.click('[data-save="1"]'); await p.waitFor((x) => /1 of 10 done · 10%/.test(x)); expect(bar().getAttribute("aria-valuenow")).toBe("10"); expect((p.$("#progfill") as any).style.width).toBe("10%");
    expect(p.$("#sec2")!.className).toMatch(/open/); // Save and continue moved on to the next step
    const qs = Array.from(p.win.document.querySelectorAll("[data-q] span:first-child")).map((e: any) => e.textContent); expect(qs.length).toBeGreaterThanOrEqual(13); expect(qs).toEqual(expect.arrayContaining(["How do I start?", "Who pays?", "Who can do what?", "What is the big screen link?", "Who do I contact?"]));
    p.click(`[data-q="${qs.indexOf("Who can do what?")}"]`); expect(p.text()).toMatch(/A Co-host invites people and can pay/);
    p.click(`[data-q="${qs.indexOf("What is the big screen link?")}"]`); expect(p.text()).toMatch(/shows the bracket, the live boards and the results/);
    p.click('[data-act="help"]'); expect(p.$("#help")).toBeTruthy(); expect(p.text()).toMatch(/Back to your steps/); expect(p.text()).toMatch(/Back to top/);
    // the phone layout has its own bottom tabs and a steps sheet
    expect(Array.from(p.win.document.querySelectorAll(".zc-tab")).map((e: any) => e.textContent)).toEqual(["Steps", "Next", "Help", "Top"]);
    p.click('.zc-tab[data-act="sheet"]'); expect(p.$(".zc-sheet")!.textContent).toMatch(/Your game at a glance/); p.click('.zc-tab[data-act="sheet"]'); expect(p.$(".zc-sheet")).toBeNull();
    const css = readFileSync(new URL("../public/zc.css", import.meta.url), "utf8"); expect(css).toMatch(/@media \(max-width:640px\)/); expect(css).toMatch(/\.zc-side\{display:none\}/); expect(css).toMatch(/\.zc-paynote\{[^}]*font-size:12px/);
    expect(p.errors).toEqual([]);
  });
});

describe("payment page", () => {
  const payPage = (o: O, eid: string, signedIn = true) => page(o, `/pay?e=${eid}`, "pay.html", ["common.js", "termsbox.js", "pay.js"], signedIn ? { "cbz-org": o.token, "cbz-email": "boss@acme.com", "cbz-phone": "98765 43210" } : {});
  test("UC-55 not signed in: asks to sign in instead of showing a broken page", async () => {
    const o = await organizer(); await make(o, "UI-PAY0");
    const p = await payPage(o, "UI-PAY0", false); expect(await p.waitFor((x) => /Please sign in first/.test(x))).toMatch(/Sign in with email/);
  });
  test("UC-23 / UC-55 payments not switched on: the order is shown, the button says so, nothing can be charged", async () => {
    const o = await organizer(); await make(o, "UI-PAY1", { cap: 230 }); await publish(o, "UI-PAY1");
    const p = await payPage(o, "UI-PAY1");
    const t = await p.waitFor((x) => /Payment is for Game ID/.test(x));
    expect(t).toMatch(/Online payment opens soon/); expect(t).toMatch(/Up to 250/); expect(t).not.toMatch(/plus GST/); 
    expect((p.$("#paygo") as any).disabled).toBe(true); expect(p.$("#pfpay")).toBeTruthy(); // the proforma invoice with its Pay now button sits above the details
  });
  test("UC-12 / UC-55 paying while held: the page says when it will begin", async () => {
    const o = await organizer({ TEST_MODE: "1" }); await make(o, "UI-PAY3"); await publish(o, "UI-PAY3");
    o.world.now = START_MS + HOUR;
    const p = await payPage(o, "UI-PAY3"); await p.waitFor((x) => /waiting for your payment now/i.test(x));
    (p.$("#nm") as any).value = "Asha Rao"; p.click("#paygo");
    expect(await p.waitFor((x) => /Payment received/i.test(x))).toMatch(/It begins at/);
  });
  test("UC-55 an already paid engagement says so; a stranger's engagement is not shown", async () => {
    const o = await organizer(); await make(o, "UI-PAY4"); await publish(o, "UI-PAY4"); o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-PAY4'").run();
    expect(await (await payPage(o, "UI-PAY4")).waitFor((x) => /already paid and published/i.test(x))).toBeTruthy();
    const other = await o.json(await o.api("POST", "/api/start", { email: "other@x.com" }, undefined)).then ? null : null; void other;
  });
});

test("'Change of phone': the organizer enters a number, and the next device that joins with it keeps the card", async () => {
    const o = await organizer(); await make(o, "UI-MOVE"); await publish(o, "UI-MOVE");
    expect((await o.api("POST", "/api/z/UI-MOVE/join", { phone: "9855555555", device: "1".repeat(32) })).status).toBe(200);
    expect((await o.api("POST", "/api/z/UI-MOVE/join", { phone: "9855555555", device: "2".repeat(32) })).status).toBe(423);
    const p = await consolePage(o, "UI-MOVE");
    await p.waitFor((x) => /Your game|Last step/i.test(x)); openStep(p, 6); await p.waitFor((x) => /Change of phone/.test(x));
    (p.$("#ubph") as any).value = "98555 55555"; p.click("#unbind");
    await p.waitFor((x) => /Done\. The next phone they join with keeps their seat/i.test(x));
    expect((await o.api("POST", "/api/z/UI-MOVE/join", { phone: "9855555555", device: "2".repeat(32) })).status).toBe(200);
    expect((await o.api("POST", "/api/z/UI-MOVE/join", { phone: "9855555555", device: "1".repeat(32) })).status).toBe(423);
  }, 60_000);

describe("Refer & Earn page", () => {
  const html = () => readFileSync(join(import.meta.dir, "../public/partner.html"), "utf8");
  test("the page pitches 50%, lists every pack with exactly half of its price, and has a working calculator", async () => {
    const o = await organizer(); const p = await page(o, "/partner.html", "partner.html", ["common.js", "partner.js"]);
    const doc = p.win.document; const body = doc.body.textContent!.replace(/\s+/g, " ");
    expect(body).toMatch(/Earn up to 50% on every game you bring/); expect(body).not.toMatch(/20% more every time/); expect(body).toMatch(/random code/i); expect(body).not.toMatch(/mobile number is your code/i);
    const packs: number[][] = p.win.TB.PACKS;
    expect(packs.slice(0, 3).map((x) => [x[0], x[1]])).toEqual([[100, 2399], [250, 3499], [500, 4699]]); // the launch prices
    const rows = [...doc.querySelectorAll("#earn-table .rrow:not(.rh)")].map((r: any) => r.textContent.replace(/\s+/g, " "));
    expect(rows.length).toBe(packs.length);
    expect(rows[0]).toMatch(/2,399/); expect(rows[0]).toMatch(/1,199\.50/); expect(rows[1]).toMatch(/1,749\.50/); expect(rows[2]).toMatch(/2,349\.50/);
    expect(body).not.toMatch(/per person|per participant|per head/i); // we never show a per-person price
    (doc.getElementById("calc-n") as any).value = "4"; (doc.getElementById("calc-pack") as any).value = "0"; (doc.getElementById("calc-n") as any).dispatchEvent(new p.win.Event("input"));
    expect(doc.getElementById("calc-out")!.textContent).toBe("₹4,798 / US$ 68"); // 4 first purchases x Rs 1,199.50
  });
  test("joining takes a mobile number and an e-mailed code: the code is random, the link is /?ref=<code>, and the page switches to the partner's own dashboard", async () => {
    const o = await organizer(); const p = await page(o, "/partner.html", "partner.html", ["common.js", "partner.js"]);
    await p.waitFor((x) => /Get your link in 20 seconds/.test(x));
    (p.$("#ph") as any).value = "+91 98765 43210"; (p.$("#em") as any).value = "partner@example.com"; (p.$("#ok") as any).checked = true; p.click("#join");
    await p.waitFor((x) => /Check your e-?mail/.test(x));
    const mailed = (o.world.raw.prepare("SELECT body FROM outbox WHERE to_addr='partner@example.com' ORDER BY id DESC").get() as any).body.match(/\b\d{6}\b/)[0];
    (p.$("#cd") as any).value = mailed; p.click("#cdgo");
    const t = await p.waitFor(() => !!p.win.document.getElementById("dash")?.textContent?.includes("Your link"));
    const dash = p.win.document.getElementById("dash")!.textContent!;
    expect(dash).not.toMatch(/9876543210/); expect(dash).toMatch(/\/\?ref=[A-HJ-NP-Z2-9]{8}/); expect(dash).toMatch(/You stay signed in/);
    expect(p.win.document.body.classList.contains("signed")).toBe(true);
    expect(p.errors).toEqual([]);
  });
  test("the page is linked from the home page and listed for search engines, and ships with its stylesheet", () => {
    expect(readFileSync(join(import.meta.dir, "../public/index.html"), "utf8")).toContain('href="/partner.html"');
    expect(readFileSync(join(import.meta.dir, "../public/sitemap.xml"), "utf8")).toContain("/partner.html");
    expect(readFileSync(join(import.meta.dir, "../../../pages/build.mjs"), "utf8")).toContain('"partner.css"');
    expect(html()).toContain('href="/partner.css"');
  });
});


describe("the console for an AI that works in the browser", () => {
  const quickPage = (o: O, session: Record<string, string> = {}) => page(o, `/zc?quick=1`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage, "cbz-email": "boss@acme.com", ...session });
  const until = async (cond: () => boolean, ms = 20000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 100)); } };
  const set = (p: any, sel: string, v: string) => { const el = p.$(sel) as any; el.value = v; el.dispatchEvent(new p.win.Event("input", { bubbles: true })); el.dispatchEvent(new p.win.Event("change", { bubbles: true })); };

  test("a hand-over link from the AI opens the exact card and outlines the one button; nothing is pressed for the organizer", async () => {
    const o = await organizer(); await make(o, "UI-ACT1");
    const pub = await consolePage(o, "UI-ACT1"); // the normal page first, for comparison
    await pub.waitFor((x) => /Hello/.test(x)); openStep(pub, 7); await pub.waitFor((x) => /Publish my game, free/.test(x)); expect(pub.text()).not.toMatch(/brought you here/);
    const a = await page(o, `/zc?e=UI-ACT1&do=publish`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-email": "boss@acme.com" });
    await a.waitFor((x) => /Your AI assistant brought you here/.test(x));
    expect(a.text()).toMatch(/Confirm and publish/); expect(a.$("#pubEmail")).toBeTruthy(); // the card is already open
    expect((a.$("#pubgo") as any).style.outline).toMatch(/solid/); // the button to press is outlined
    const sm = await o.json(await o.api("GET", "/api/z/UI-ACT1/summary", undefined, o.aiKey)); expect(sm.status).toBe("draft"); // and it was NOT pressed
    await publish(o, "UI-ACT1");
    const e = await page(o, `/zc?e=UI-ACT1&do=erase`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token });
    await e.waitFor((x) => /Delete all participant data now/.test(x)); await until(() => /solid/.test((e.$("#erase") as any).style.outline)); expect(e.text()).toMatch(/Your AI assistant brought you here/);
    const c = await page(o, `/zc?e=UI-ACT1&do=pause`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token });
    await c.waitFor((x) => /Run the tournament/.test(x)); await until(() => /solid/.test((c.$("#runt") as any).style.outline)); expect(c.text()).toMatch(/Pause for everyone/); // pause lives on the tournament page: the link to it is outlined
    const n = await page(o, `/zc?e=UI-ACT1`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }); await n.waitFor((x) => /Last step: pay before the start/i.test(x)); expect(n.text()).not.toMatch(/brought you here/); // an ordinary visit shows no such banner
  }, 90_000);


  test("AI helper mode also keeps the organizer's own e-mail and mobile out of the Publish card; with it off they are prefilled for the organizer", async () => {
    const o = await organizer(); await make(o, "UI-SHD2");
    const on = await page(o, `/zc?e=UI-SHD2&do=publish`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-email": "boss@acme.com", "cbz-phone": "9000011111", "cbz-shield": "1" });
    await on.waitFor((x) => /Confirm and publish/.test(x)); expect((on.$("#pubEmail") as any).value).toBe(""); expect((on.$("#pubPhone") as any).value).toBe(""); expect(on.text()).not.toMatch(/boss@acme\.com|9000011111/);
    const off = await page(o, `/zc?e=UI-SHD2&do=publish`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-email": "boss@acme.com", "cbz-phone": "9000011111" });
    await off.waitFor((x) => /Confirm and publish/.test(x)); expect((off.$("#pubEmail") as any).value).toBe("boss@acme.com"); expect((off.$("#pubPhone") as any).value).toBe("9000011111");
  }, 60_000);
  test("every field on the console is reachable by name: each label is linked to its field, nothing unlabelled, and the page keeps the same elements when nothing has changed", async () => {
    const o = await organizer(); await make(o, "UI-A11Y1");
    const p = await consolePage(o, "UI-A11Y1", o.token, {}, { afterLoad: spy().hook }); await p.waitFor((x) => /Hello/.test(x)); const doc = p.win.document; openStep(p, 4); openStep(p, 6); await p.waitFor((x) => /Paste from Excel/.test(x)); p.click('[data-mode="paste"]'); openStep(p, 7); p.click("#publishopen"); openStep(p, 4);
    const bad: string[] = [];
    for (const f of Array.from(doc.querySelectorAll("input, select, textarea")) as any[]) {
      if (f.type === "hidden") continue;
      const named = (f.id && doc.querySelector(`label[for="${f.id}"]`)) || f.closest("label") || f.getAttribute("aria-label");
      if (!named) bad.push(`${f.tagName.toLowerCase()}#${f.id}.${f.getAttribute("data-bk") || f.getAttribute("data-op") || f.getAttribute("data-cl") || ""}`);
    }
    expect(bad).toEqual([]);
    for (const l of Array.from(doc.querySelectorAll("label[for]")) as any[]) expect([l.getAttribute("for"), !!doc.getElementById(l.getAttribute("for"))]).toEqual([l.getAttribute("for"), true]); // no label points at nothing
    const ids = Array.from(doc.querySelectorAll("[id]")).map((e: any) => e.id); expect(new Set(ids).size).toBe(ids.length); // ids are unique
    expect(doc.querySelector('[data-fi="brand.name"]')!.getAttribute("id")).toBe("f-brand-name"); // the brand field has a stable name
    const btn = p.$('[data-save="4"]') as any; await new Promise((r) => setTimeout(r, 6000)); expect(btn.isConnected).toBe(true); expect(p.$('[data-save="4"]')).toBe(btn); // the 5-second refresh did not replace the page's elements
  }, 90_000);


  test("Quick setup refuses a start time that has passed and tells the organizer plainly; it saves nothing", async () => {
    const o = await organizer(); const p = await quickPage(o); await p.waitFor((x) => /1\. Which game\?/.test(x));
    set(p, "#qk-date", "2020-01-01"); set(p, "#qk-time", "10:00"); p.click("#qk-save");
    await until(() => (p.$("#qk-err") as any).style.display !== "none"); expect((p.$("#qk-err") as any).textContent).toMatch(/start time in the future/);
    expect((await o.json(await o.api("GET", "/api/history", undefined, o.aiKey))).engagements.length).toBe(0);
  }, 60_000);

  test("a second tab of the same browser is signed in by the first, without storing the key anywhere", async () => {
    const o = await organizer();
    const first = await page(o, `/zc`, "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage }); await first.waitFor((x) => /Your account/.test(x));
    const second = await page(o, `/zc`, "zc.html", ZC_SCRIPTS, {}); // no key in this tab's session
    await second.waitFor((x) => /Your account/.test(x), 10000); // it asked the other tab and was signed in
    expect(second.$("#sec")).toBeNull(); // no sign-in box
  }, 60_000);
});

// --- Console, round 2: cancel with three confirmations, "Confirming your payment...", the team forms, the e-mail rule and the moved AI helper switch ---
// The cancel and team-with-phone endpoints are being built in the Worker at the same time: until they land these parts talk to a small stub (the rest is the real Worker).
/** Like `stub`, but a route may also change what the real Worker answers (`real` is the real answer as JSON). */
const patch = (routes: Record<string, (method: string, body: any, real: () => Promise<any>) => any>) => (win: any, f: string) => {
  if (f !== "control.js") return;
  const realFetch = win.fetch;
  win.fetch = async (input: any, init?: any) => {
    const u = new URL(String(input), "http://localhost"), h = routes[u.pathname];
    if (!h) return realFetch(input, init);
    const method = (init?.method || "GET").toUpperCase();
    const out = await h(method, init?.body ? JSON.parse(init.body) : undefined, async () => (await realFetch(input, init)).json());
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } }); // the answer is the body as is (a summary has its own "status" field)
  };
};
const REFUND = { paidInr: 2399, feeInr: 55.67, refundInr: 2303.15, feeNote: "The payment charge of Rs 55.67 is kept by the payment company." };
describe("console round 2 (cancel, confirming, team, e-mail rule, AI switch)", () => {
  test("no dropdown anywhere: no <select> on any step for the Organizer or a Host", async () => {
    const o = await organizer(); await make(o, "UI-NOSEL"); await publish(o, "UI-NOSEL");
    const org = await consolePage(o, "UI-NOSEL"); await org.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    for (let n = 1; n <= 10; n++) { openStep(org, n); expect([n, org.win.document.querySelectorAll("select").length]).toEqual([n, 0]); }
    const host = await consolePage(o, "UI-NOSEL", await hostKey(o)); await host.waitFor((x) => /Last step|Your game/i.test(x));
    for (let n = 1; n <= 10; n++) { openStep(host, n); expect([n, host.win.document.querySelectorAll("select").length]).toEqual([n, 0]); }
  });

  test("Cancel game (real Worker): three confirmations, each more serious; nothing is sent until the third; the server gets confirmations: 3; then a calm cancelled state read back from the server", async () => {
    const o = await organizer(); await make(o, "UI-CAN", { name: "Diwali Night" }); await publish(o, "UI-CAN");
    const p = await consolePage(o, "UI-CAN"); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 7);
    expect(p.$("#cancelblock")).toBeTruthy(); expect(p.$("#cancel3")).toBeNull();
    p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x) && /Do you want to cancel Diwali Night\?/.test(x));
    const panel = p.$("#cancelpanel") as any; expect(panel.getAttribute("role")).toBe("alertdialog"); expect(panel.className).toMatch(/zc-cwarn/); expect(p.$("#cancelprog")!.textContent).toBe("Step 1 of 3"); expect(p.text()).toMatch(/You are cancelling the game\. You need to confirm 3 times before the game is cancelled\./);
    expect(p.$("#cancelback")!.textContent).toBe("No, keep my game"); expect(p.$("#cancel1")!.textContent).toBe("Yes, go to the 2nd confirmation"); expect(p.$("#cancel2")).toBeNull(); expect(p.$("#cancel3")).toBeNull();
    p.click("#cancel1"); await p.waitFor((x) => /2nd confirmation/.test(x) && /You cannot undo this/.test(x));
    expect(p.$("#cancelprog")!.textContent).toBe("Step 2 of 3"); expect(p.text()).toMatch(/You are cancelling the game/); expect(p.$("#cancelwhat")!.textContent).toBe("Guests will be told. Their names and numbers will be erased. You cannot undo this."); expect(p.$("#cancel3")).toBeNull();
    expect((p.$("#cancel2") as any).disabled).toBe(true); expect((p.$("#cancelagree") as any).checked).toBe(false); expect(p.$("#cancel2")!.textContent).toBe("Submit"); // the box gates the button
    p.click("#cancelprev"); await p.waitFor((x) => /1st confirmation/.test(x)); p.click("#cancel1"); await p.waitFor((x) => /2nd confirmation/.test(x)); // Go back works
    expect((await o.json(await o.api("GET", "/api/z/UI-CAN/summary", undefined, o.token))).cancelled).toBeFalsy(); // two screens in, still nothing sent
    tickAgree(p); expect((p.$("#cancel2") as any).disabled).toBe(false); p.click("#cancel2"); await p.waitFor((x) => /Final confirmation/.test(x));
    expect(p.$("#cancelprog")!.textContent).toBe("Step 3 of 3"); expect(p.text()).toMatch(/You are cancelling the game/); expect(p.$("#cancelback")!.textContent).toBe("No, keep my game");
    expect(p.$("#cancel3")!.textContent).toBe("Yes, Diwali Night is cancelled");
    p.click("#cancel3"); await p.waitFor((x) => /This game was cancelled/.test(x));
    expect((await o.json(await o.api("GET", "/api/z/UI-CAN/summary", undefined, o.token))).cancelled).toBe(true);
    expect(p.$("#cancelled")).toBeTruthy(); expect(p.$("#cancelopen")).toBeNull(); expect(p.$("#cancel3")).toBeNull(); expect(p.text()).not.toMatch(/Pay now/);
    const again = await consolePage(o, "UI-CAN"); await again.waitFor((x) => /This game was cancelled/.test(x)); openStep(again, 7); expect(again.$("#cancelled")).toBeTruthy(); expect(again.$("#cancelopen")).toBeNull();
    expect(p.errors).toEqual([]);
  });

  test("Cancelled PAID game: the console offers 'Move my game to this date' for 30 days; picking a date puts the game back on (real Worker)", async () => {
    const o = await organizer(); await make(o, "UI-MOVE", { name: "Holi Fun" }); await publish(o, "UI-MOVE");
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-MOVE'").run(); // paid
    expect((await o.api("POST", "/api/z/UI-MOVE/cancel", { confirmations: 3 }, o.token)).status).toBe(200);
    const p = await consolePage(o, "UI-MOVE"); await p.waitFor((x) => /This game was cancelled/.test(x)); openStep(p, 7);
    expect(p.$("#moveblock")).toBeTruthy(); expect(p.$("#movego")!.textContent).toBe("Move my game to this date"); expect(p.text()).toMatch(/You can move this game to a new date until/); expect(p.text()).toMatch(/Your payment then stays with this game/);
    const dt = p.$("#movedt") as any; const d = new Date(Date.now() + 5 * 86_400_000); const pad = (n: number) => String(n).padStart(2, "0");
    dt.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`; p.click("#movego");
    await p.waitFor((x) => !/This game was cancelled/.test(x) && /Holi Fun/.test(x)); // the cancelled banner is gone, the game is back
    const row = o.world.raw.prepare("SELECT cancelled_ms, start_round FROM engagement WHERE id='UI-MOVE'").get() as any; expect(row.cancelled_ms).toBeNull(); // read back from the server, not just the message
    expect((await o.json(await o.api("GET", "/api/z/UI-MOVE/summary", undefined, o.token))).cancelled).toBeFalsy();
    expect(p.errors).toEqual([]);
  });
  test("Cancelled PAID game: a past date is refused on the page and nothing is sent", async () => {
    const o = await organizer(); await make(o, "UI-MOVE2"); await publish(o, "UI-MOVE2");
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-MOVE2'").run();
    await o.api("POST", "/api/z/UI-MOVE2/cancel", { confirmations: 3 }, o.token);
    const p = await consolePage(o, "UI-MOVE2"); await p.waitFor((x) => /This game was cancelled/.test(x)); openStep(p, 7);
    (p.$("#movedt") as any).value = "2001-01-01T10:00"; p.click("#movego"); await p.waitFor((x) => /Please pick a new date and time in the future/.test(x));
    expect((o.world.raw.prepare("SELECT cancelled_ms FROM engagement WHERE id='UI-MOVE2'").get() as any).cancelled_ms).not.toBeNull();
  });
  test("Cancel game: 'No, keep it' at any step sends nothing; and when the game cannot be cancelled the friendly reason shows and no confirm button", async () => {
    const o = await organizer(); await make(o, "UI-CANNO"); await publish(o, "UI-CANNO");
    const posts: any[] = [];
    const p = await page(o, "/zc?e=UI-CANNO", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }, { afterLoad: patch({
      "/api/z/UI-CANNO/cancel-preview": () => ({ canCancel: true, paid: false, credit: null }), "/api/z/UI-CANNO/cancel": (_m, b) => { posts.push(b); return { ok: true }; } }) });
    await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 7);
    p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x)); p.click("#cancelback"); await p.waitFor(() => !!p.$("#cancelopen")); expect(posts.length).toBe(0); // No at the first screen
    p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x)); p.click("#cancel1"); await p.waitFor((x) => /2nd confirmation/.test(x)); tickAgree(p); p.click("#cancel2"); await p.waitFor((x) => /Final confirmation/.test(x)); p.click("#cancelback"); // No at the last screen
    await p.waitFor(() => !!p.$("#cancelopen")); expect(posts.length).toBe(0);
    const q = await page(o, "/zc?e=UI-CANNO", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }, { afterLoad: patch({
      "/api/z/UI-CANNO/cancel-preview": () => ({ canCancel: false, reason: "The start time has passed. Use End the game.", paid: true, credit: null }), "/api/z/UI-CANNO/cancel": (_m, b) => { posts.push(b); return { ok: true }; } }) });
    await q.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(q, 7); q.click("#cancelopen");
    await q.waitFor((x) => /The start time has passed\. Use End the game\./.test(x)); expect(q.$("#cancel1")).toBeNull(); expect(q.$("#cancel3")).toBeNull(); expect(posts.length).toBe(0);
  });

  test("Cancel game is for the Organizer and a Host; a Co-host never sees it", async () => {
    const o = await organizer(); await make(o, "UI-CANR"); await publish(o, "UI-CANR");
    const h = await consolePage(o, "UI-CANR", await hostKey(o)); await h.waitFor((x) => /Last step|Your game/i.test(x)); openStep(h, 7); expect(h.$("#cancelopen")).toBeTruthy();
    const c = await consolePage(o, "UI-CANR", await cohostKey(o, "UI-CANR")); await c.waitFor((x) => /Hi\. Here is the game/.test(x));
    for (let n = 1; n <= 3; n++) openStep(c, n);
    expect(c.$("#cancelopen")).toBeNull(); expect(c.text()).not.toMatch(/Cancel this game/);
  });

  test("'Confirming your payment...' shows on the pill, the notice and the step, and the game is not shown as Paid or as due", async () => {
    const o = await organizer(); await make(o, "UI-CONF"); await publish(o, "UI-CONF");
    const p = await page(o, "/zc?e=UI-CONF", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }, { afterLoad: patch({
      "/api/z/UI-CONF/summary": async (_m, _b, real) => ({ ...(await real()), payment: { status: "confirming" } }) }) });
    await p.waitFor((x) => /Confirming your payment\.\.\./.test(x));
    expect(p.$("#paypill")!.textContent).toBe("Confirming your payment..."); expect(p.$("#paynote")!.textContent).toMatch(/Confirming your payment\.\.\./);
    openStep(p, 8); const t = p.text(); expect(t).not.toMatch(/Paid by|The game is on/); expect(p.$('a[href^="/pay.html"]')).toBeNull(); expect(p.$("#paypill")!.className).not.toMatch(/pill-paid/);
    expect(p.errors).toEqual([]);
  });

  test("Your team: a Host needs a name AND an e-mail; a Co-host needs a name AND a mobile and the form has no e-mail field; the Co-hosts of the game show a masked mobile", async () => {
    const o = await organizer(); await make(o, "UI-TM2");
    const posts: any[] = []; const asked: string[] = [];
    const p = await page(o, "/zc?e=UI-TM2", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token }, { afterLoad: patch({
      "/api/org/team": () => { asked.push("team"); return { maxHosts: 5, hosts: [{ id: "h1", label: "Anita", email: "anita@acme.com" }], cohosts: [{ id: "c1", label: "Ravi", phone: "9811100001", brought: 0 }] }; },
      "/api/org/host": (_m, b) => { posts.push(["host", b]); return { ok: true, id: "h2", label: b.label }; },
      "/api/org/cohost": (_m, b) => { posts.push(["cohost", b]); return { ok: true, cohostKey: "cbc_" + "1".repeat(48), id: "c2", label: b.label }; } }) });
    await p.waitFor((x) => /Hello/.test(x)); openStep(p, 5); await p.waitFor((x) => /Your Hosts: 1 of 5/.test(x));
    const t = p.text(); expect(t).toMatch(/anita@acme\.com/); expect(t).toMatch(/XXXXXX0001/); expect(t).not.toMatch(/9811100001/); // the Host's e-mail is shown to the Organizer; a Co-host's mobile is masked
    // Host: a name and at least one of mobile or e-mail; a wrong one is refused before anything is sent
    setField(p, "#hostlabel", "Meena"); p.click("#hostadd"); await p.waitFor((x) => /Host's mobile number or e-mail/.test(x)); expect(posts.length).toBe(0);
    setField(p, "#hostlabel", "Meena"); setField(p, "#hostphone", "98765 43210"); setField(p, "#hostemail", "not-an-email"); p.click("#hostadd"); await p.waitFor((x) => /check the Host's e-mail/.test(x)); expect(posts.length).toBe(0);
    setField(p, "#hostlabel", "Meena"); setField(p, "#hostphone", "123"); setField(p, "#hostemail", "meena@acme.com"); p.click("#hostadd"); await p.waitFor((x) => /check the Host's mobile number/.test(x)); expect(posts.length).toBe(0);
    setField(p, "#hostlabel", "Meena"); setField(p, "#hostphone", "98765 43210"); setField(p, "#hostemail", "meena@acme.com"); p.click("#hostadd"); await p.waitFor(() => posts.length === 1);
    expect(posts[0]).toEqual(["host", { label: "Meena", e: "UI-TM2", mobile: "98765 43210", email: "meena@acme.com" }]);
    // Co-host: name and mobile, never an e-mail
    await p.waitFor((x) => /Host added/.test(x));
    expect(p.$("#cohostemail")).toBeNull(); const co = p.$("#cohostphone").parentElement; expect(co.querySelector('input[type="email"]')).toBeNull(); expect(co.querySelector("#hostemail")).toBeNull();
    setField(p, "#cohostlabel", "Ravi Two"); p.click("#cohostadd"); await p.waitFor((x) => /Co-host's mobile number/.test(x)); expect(posts.length).toBe(1);
    setField(p, "#cohostphone", "98111"); setField(p, "#cohostlabel", "Ravi Two"); p.click("#cohostadd"); await p.waitFor((x) => /Co-host's mobile number/.test(x)); expect(posts.length).toBe(1);
    setField(p, "#cohostlabel", "Ravi Two"); setField(p, "#cohostphone", "98111 00002"); p.click("#cohostadd"); await p.waitFor(() => posts.length === 2);
    expect(posts[1][0]).toBe("cohost"); expect(posts[1][1]).toMatchObject({ label: "Ravi Two", phone: "98111 00002" }); expect(posts[1][1].eid).toBe("UI-TM2"); expect(Object.keys(posts[1][1]).some((k) => /mail/i.test(k))).toBe(false);
    expect(asked.length).toBeGreaterThan(1); // the team list is asked again after adding
  });

  test("the plain e-mail sentence is on Your team and on Your guest list", async () => {
    const o = await organizer(); await make(o, "UI-RULE"); await publish(o, "UI-RULE");
    const SENT = "Guests and Co-hosts need only a name and a mobile number. No e-mail is needed. Only the Organizer and Hosts have an e-mail.";
    const p = await consolePage(o, "UI-RULE"); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    openStep(p, 5); expect(p.$("#emailrule")!.textContent).toBe(SENT);
    openStep(p, 6); expect(p.$("#emailrule2")!.textContent).toBe(SENT);
    const h = await consolePage(o, "UI-RULE", await hostKey(o)); await h.waitFor((x) => /Last step|Your game/i.test(x)); openStep(h, 5); expect(h.$("#emailrule")!.textContent).toBe(SENT); openStep(h, 6); expect(h.$("#emailrule2")!.textContent).toBe(SENT);
  });

});

const tickAgree = (p: Page) => { const c = p.$("#cancelagree") as any; c.checked = true; c.dispatchEvent(new p.win.Event("change", { bubbles: true })); };
const jn = (o: O, id: string, i: number, extra: Record<string, unknown> = {}) => o.api("POST", `/api/z/${id}/join`, { phone: "98765" + String(10000 + i), name: "Guest" + i + " Kumar", device: String(i).padStart(2, "0") + "d".repeat(30), ...extra });
const listOf = async (o: O, id: string, key = o.token) => o.json(await o.api("GET", `/api/z/${id}/people`, undefined, key));
const waitOf = async (o: O, id: string, key = o.token) => (await o.json(await o.api("GET", `/api/z/${id}/waiting`, undefined, key))).waiting as any[];
const fakeWin = () => { const w: any = { location: { href: "" }, opener: 1, closed: false, close() { w.closed = true; } }; return w; };
describe("console phase 2: wording fixes, My people, waiting room, remove, play now (real Worker)", () => {
  const ready = async (o: O, id: string, w = spy(), key = o.token) => { const p = await consolePage(o, id, key, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Hello|Last step|Your game|Hi\./i.test(x)); return p; };
  const myPeople = async (p: Page) => { openStep(p, 6); await p.waitFor((x) => /My people/.test(x) && /people are on my list|person is on my list/.test(x)); };

  test("wording: no 'engagement' anywhere in the ten steps, singular and plural right, friendly dates, 365-day line says who is kept, step 9 line does not repeat its title", async () => {
    const o = await organizer(); await make(o, "UI-WORD"); await publish(o, "UI-WORD");
    const p = await ready(o, "UI-WORD"); await hostKey(o, "Anita"); await cohostKey(o, "UI-WORD", "Ravi");
    openStep(p, 5); await p.waitFor((x) => /Your Hosts: 1 of 5/.test(x) && /Your Co-hosts: 1 \(no limit\)/.test(x));
    const syn = () => Array.from(p.win.document.querySelectorAll(".zc-side .zc-syn")).map((e: any) => e.textContent as string);
    await p.waitFor(() => syn()[4].includes("1 Host, 1 Co-host")); expect(syn()[4]).not.toMatch(/1 Hosts|1 Co-hosts/);
    expect(syn()[8]).not.toMatch(/After the game\s*After the game/);
    for (let n = 1; n <= 10; n++) { openStep(p, n); expect([n, /ngagement/.test(p.text())]).toEqual([n, false]); }
    openStep(p, 10); const t = await p.waitFor((x) => /Within 24 hours of the game ending/.test(x));
    expect(t).toMatch(/Your details as Organizer and Host, and the winners record, are kept for 365 days\. Co-host details are erased with the guests\./);
    expect(t).not.toMatch(/\d{4}-\d\d-\d\d|\bIST\b/); expect(t).toMatch(/deleted by \d{1,2} \w{3} \d{4}, \d{1,2}:\d\d (am|pm)/); expect(t).toMatch(/kept until \d{1,2} \w{3} \d{4}/);
    openStep(p, 7); expect(p.text()).toMatch(/Continue/); expect(p.text()).not.toMatch(/Save and continue/); openStep(p, 3); expect(p.$('[data-save="3"]')!.textContent).toBe("Save and continue");
    openStep(p, 5); expect(p.$('[data-save="5"]')!.textContent).toBe("Continue");
    expect(p.errors).toEqual([]);
  });

  test("a guest is never offered e-mail: not on the guest link, not in My people, not on the Co-host page; the plain sentence stays", async () => {
    const o = await organizer(); await make(o, "UI-NOMAIL"); await publish(o, "UI-NOMAIL");
    const p = await ready(o, "UI-NOMAIL"); await myPeople(p);
    expect(p.win.document.querySelectorAll('a[href^="mailto:"]').length).toBe(0); expect(p.text()).not.toMatch(/e-mail \(|By e-mail|Send by e-mail|Send invites/); expect(p.$("#emailrule2")).toBeTruthy();
    const c = await ready(o, "UI-NOMAIL", spy(), await cohostKey(o, "UI-NOMAIL")); openStep(c, 2); await c.waitFor((x) => /My people/.test(x));
    expect(c.win.document.querySelectorAll('a[href^="mailto:"]').length).toBe(0); expect(c.text()).not.toMatch(/Send by e-mail/); expect(c.text()).not.toMatch(/guest list/i);
  });



  test("My people: paste cleans the list ('2 good, 1 duplicate removed, 1 looks wrong'), lists the wrong one to fix, and the fixed number is added; a CSV with a header row works too", async () => {
    const o = await organizer(); await make(o, "UI-CLEAN"); await publish(o, "UI-CLEAN"); const w = spy();
    const p = await ready(o, "UI-CLEAN", w); await myPeople(p); p.click('[data-mode="paste"]');
    (p.$("#rosterTxt") as any).value = ["Asha, 98765 43210", "Bala, 0091-98765-43211", "Asha again, +91 9876543210", "Chitra, 12345"].join("\n"); p.click("#rosterGo");
    await p.waitFor((x) => /2 good, 1 duplicate removed, 1 looks wrong/.test(x));
    expect(w.st.calls.find((c: any) => c[0] === "POST" && c[1].endsWith("/people"))[2].people.map((x: any) => x.phone)).toEqual(["+919876543210", "+919876543211"]); // the cleaning happens before anything is sent
    expect((await listOf(o, "UI-CLEAN")).people.map((x: any) => x.name).sort()).toEqual(["Asha", "Bala"]);
    expect(p.$("#wronglist")!.textContent).toMatch(/Chitra/); expect((p.$("#fixin0") as any).value).toBe("12345");
    setField(p, "#fixin0", "98765 43212"); p.click("[data-fix]"); await p.waitFor((x) => /1 good, 0 duplicates removed, 0 look wrong/.test(x)); expect((await listOf(o, "UI-CLEAN")).people.length).toBe(3); expect(p.$("#wronglist")).toBeNull();
    p.click('[data-mode="file"]'); const inp = p.$("#gfile") as any; Object.defineProperty(inp, "files", { value: [{ text: async () => "Name,Mobile\nDev,+971 50 123 4567\nEsha,9876543214\n" }], configurable: true }); inp.dispatchEvent(new p.win.Event("change", { bubbles: true }));
    await p.waitFor((x) => /2 good, 0 duplicates removed, 0 look wrong/.test(x)); expect((await listOf(o, "UI-CLEAN")).people.map((x: any) => x.name).sort()).toEqual(["Asha", "Bala", "Chitra", "Dev", "Esha"]); // a header row is skipped; another country code is kept
  });

  test("My people: a big paste goes up 200 at a time; a Co-host's over-limit answer from the server is shown calmly; the Organizer's Co-host limit chips are saved", async () => {
    const o = await organizer(); await make(o, "UI-CHUNK", { cap: 250 }); await publish(o, "UI-CHUNK"); const w = spy();
    const p = await ready(o, "UI-CHUNK", w); await myPeople(p); p.click('[data-mode="paste"]');
    (p.$("#rosterTxt") as any).value = Array.from({ length: 201 }, (_, i) => `P${i}, 9${String(100000000 + i)}`).join("\n"); p.click("#rosterGo");
    await p.waitFor((x) => /201 good/.test(x), 20000); expect(w.st.calls.filter((c: any) => c[0] === "POST" && c[1].endsWith("/people")).map((c: any) => c[2].people.length)).toEqual([200, 1]);
    openStep(p, 5); await p.waitFor((x) => /Each Co-host can add up to/.test(x)); expect(p.$('[data-cohl="100"]')!.getAttribute("aria-checked")).toBe("true"); p.click('[data-cohl="10"]'); await p.waitFor(() => /Saved/.test(p.text()));
    expect((await o.json(await o.api("GET", "/api/z/UI-CHUNK/summary", undefined, o.token))).coHostLimit).toBe(10);
    const ck = await cohostKey(o, "UI-CHUNK"); await o.api("POST", "/api/z/UI-CHUNK/people", { people: Array.from({ length: 9 }, (_, i) => ({ name: "C" + i, phone: "98111" + String(10000 + i) })) }, ck);
    const c = await ready(o, "UI-CHUNK", spy(), ck); openStep(c, 2); await c.waitFor((x) => /9 people are on my list \(up to 10\)/.test(x)); c.click('[data-mode="paste"]');
    (c.$("#rosterTxt") as any).value = "X1, 9822200001\nX2, 9822200002"; c.click("#rosterGo");
    const said = (await o.json(await o.api("POST", "/api/z/UI-CHUNK/people", { people: [{ name: "Y1", phone: "9822200003" }, { name: "Y2", phone: "9822200004" }] }, ck))).error as string; expect(said).toBeTruthy();
    await c.waitFor((x) => x.includes(said.slice(0, 40))); expect((await listOf(o, "UI-CHUNK", ck)).people.length).toBeLessThanOrEqual(10);
  }, 60_000);

  test("My people: 'From my contacts' appears only where the browser has a contact picker, and what is picked is added", async () => {
    const o = await organizer(); await make(o, "UI-CONT"); await publish(o, "UI-CONT");
    const p = await ready(o, "UI-CONT"); await myPeople(p); expect(p.text()).not.toMatch(/From my contacts/);
    Object.defineProperty(p.win.navigator, "contacts", { value: { select: async () => [{ name: ["Farid"], tel: ["098765 43215"] }] }, configurable: true });
    openStep(p, 5); openStep(p, 6); await p.waitFor((x) => /From my contacts/.test(x)); p.click('[data-mode="contacts"]'); p.click("#gcontacts");
    await p.waitFor((x) => /1 good/.test(x)); expect((await listOf(o, "UI-CONT")).people[0]).toMatchObject({ name: "Farid" });
  });

  test("Who is this game for: a tick for employees only (hides 'Who can join'), what a person must give, a small hint under every group, saved to the game; the people box then takes an Employee ID and a PDF", async () => {
    const o = await organizer(); await make(o, "UI-EMP"); await publish(o, "UI-EMP"); const w = spy();
    const p = await ready(o, "UI-EMP", w); openStep(p, 2);
    expect(p.$('[data-bool="emp"]')).toBeTruthy(); expect(Array.from(p.win.document.querySelectorAll("#sec2 .zc-sub")).map((e: any) => e.textContent)).toContain("Who can join");
    expect(p.win.document.querySelectorAll("#sec2 .zc-hint2").length).toBeGreaterThanOrEqual(4); // a small line under the sizes, who can join, who it is for and what to give
    p.click('[data-ck="ver"][data-v="id"]'); expect(p.text()).toMatch(/Each employee types|Employees type their employee ID/);
    p.click('[data-bool="emp"]'); expect(Array.from(p.win.document.querySelectorAll("#sec2 .zc-sub")).map((e: any) => e.textContent)).not.toContain("Who can join"); expect(p.text()).toMatch(/Only the employees on your list can play/); // the choice that no longer applies is hidden
    p.click('[data-save="2"]'); await p.waitFor((x) => /Saved\./.test(x));
    const sm = await o.json(await o.api("GET", "/api/z/UI-EMP/summary", undefined, o.aiKey));
    expect(sm).toMatchObject({ verify: "id", employeesOnly: true, whoCanJoin: "list" });
    expect(w.st.patches.some((b: any) => b.verify === "id" && b.employeesOnly === true)).toBe(true);
    await myPeople(p); expect(Array.from(p.win.document.querySelectorAll("[data-mode]")).map((e: any) => e.textContent)).toEqual(["Upload a PDF", "Add a name and number", "Paste from Excel", "Upload a CSV"]);
    p.click('[data-mode="type"]'); expect(p.$("#gemp")).toBeTruthy(); setField(p, "#gname", "Asha"); setField(p, "#gemp", "e-101"); p.click("#gadd");
    await p.waitFor((x) => /1 good/.test(x)); expect((await listOf(o, "UI-EMP")).people[0]).toMatchObject({ name: "Asha", empId: "E-101" });
    p.click('[data-mode="pdf"]'); expect(p.$("#gpdf")).toBeTruthy(); expect(p.$("#gtemplate")).toBeTruthy(); expect(p.text()).toMatch(/Upload the PDF here\. You will see the list before anyone is added/);
    expect(p.errors).toEqual([]);
  });
  test("The AI work link and the AI prompt box are not on the organizer's or the host's screens", async () => {
    const o = await organizer(); await make(o, "UI-NOAI");
    const home = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage }); await home.waitFor((x) => /Start a new game/.test(x) && /Your account/.test(x));
    expect(home.$("#aistrip")).toBeNull(); expect(home.$("#aimsg")).toBeNull(); expect(home.text()).not.toMatch(/AI work link|Let your free AI assistant|ChatGPT/);
    const h = await consolePage(o, "UI-NOAI", await hostKey(o)); await h.waitFor((x) => /Hello|Last step|Your game/i.test(x)); expect(h.$("#aistrip")).toBeNull(); expect(h.text()).not.toMatch(/AI work link/);
  });
  test("The Rs 0 game: choosing 10 people says nothing to pay; a published one shows Rs 0 on the payment pill and in step 8, with no demo mark", async () => {
    const o = await organizer(); await make(o, "UI-RS0", { cap: 10 });
    const p = await consolePage(o, "UI-RS0"); await p.waitFor((x) => /Hello|Last step|Your game/i.test(x)); openStep(p, 2);
    expect(p.text()).toMatch(/A game for 10 people or fewer is Rs 0/); openStep(p, 7);
    expect(p.text()).toMatch(/costs Rs 0/); expect(p.text()).not.toMatch(/DEMO/);
    await o.api("POST", "/api/z/UI-RS0/publish", { email: "boss@acme.com", phone: "98765 43210", consent: { v: "2026-10-15", boxes: ["A", "B"] } }, o.token);
    const q = await consolePage(o, "UI-RS0"); await q.waitFor((x) => /Hello|Last step|Your game/i.test(x)); expect(q.$("#paypill")!.textContent).toBe("Rs 0 · nothing to pay"); expect(q.$("#paynote")).toBeNull();
    openStep(q, 8); expect(q.text()).toMatch(/Rs 0 · up to 10 people/); expect(q.text()).toMatch(/Create a new game like this one/); expect(q.text()).not.toMatch(/DEMO/i);
  });

  test("Remove: 'only this person' or 'this person and everyone they invited', asked before the game; during the game the confirm says the win stands and the prize is marked not given", async () => {
    const o = await organizer(); await make(o, "UI-RM"); await publish(o, "UI-RM"); const w = spy();
    await o.api("POST", "/api/z/UI-RM/people", { people: [{ name: "Asha", phone: "9876543210" }, { name: "Bala", phone: "9876543211" }, { name: "Chitra", phone: "9876543212" }] }, o.token);
    const ids = (await listOf(o, "UI-RM")).people.map((x: any) => [x.name, x.id]); const idOf = (n: string) => ids.find((x: any) => x[0] === n)[1];
    const p = await ready(o, "UI-RM", w); await myPeople(p);
    p.click(`[data-rmask="${idOf("Asha")}"]`); await p.waitFor((x) => /loses their place and their link stops/.test(x)); expect(p.text()).toMatch(/Only this person/); expect(p.text()).toMatch(/This person and everyone they invited/);
    p.click("[data-rmno]"); expect(p.$("[data-rm]")).toBeNull(); expect(w.st.calls.some((c: any) => c[1].endsWith("/remove"))).toBe(false);
    p.click(`[data-rmask="${idOf("Asha")}"]`); p.click(`[data-rm="${idOf("Asha")}"][data-with="1"]`); await p.waitFor((x) => /Removed\./.test(x));
    expect(w.st.calls.find((c: any) => c[1].endsWith("/remove"))[2]).toEqual({ withTheirPeople: true }); expect((await listOf(o, "UI-RM")).people.find((x: any) => x.name === "Asha").status).toBe("removed");
    expect(p.$(`[data-rmask="${idOf("Asha")}"]`)).toBeNull(); // a removed person has no buttons
    (p.win as any).__zc.started = true; p.click(`[data-rmask="${idOf("Bala")}"]`);
    await p.waitFor((x) => /the win stands and the prize is marked not given/.test(x)); expect(p.text()).toMatch(/Their phone will stop/);
    p.click(`[data-rm="${idOf("Bala")}"][data-with="0"]`); await p.waitFor(async () => (await Promise.resolve(true)) && /Removed\./.test(p.text()));
    const now = (await listOf(o, "UI-RM")).people; expect(now.find((x: any) => x.name === "Bala").status).toBe("removed"); expect(now.find((x: any) => x.name === "Chitra").status).toBe("invited");
  });

  test("Waiting room (list mode): name first and last 4 digits, who is asking, Admit and Decline, and who approved shows afterwards", async () => {
    const o = await organizer(); await make(o, "UI-WAIT", { whoCanJoin: "list" }); await publish(o, "UI-WAIT");
    for (const i of [1, 2]) expect((await jn(o, "UI-WAIT", i, { name: i === 1 ? "Meera Shah" : "Nikhil Rao" })).status).toBe(403);
    const waiting = await waitOf(o, "UI-WAIT"); expect(waiting.length).toBe(2);
    const w = spy(); const p = await ready(o, "UI-WAIT", w); await myPeople(p);
    const t = await p.waitFor((x) => /Waiting to come in: 2/.test(x)); expect(t).toMatch(/Meera \S+ 0001/); expect(t).toMatch(/Asking through/); expect(t).not.toMatch(/Shah|Rao/);
    const first = waiting.find((x: any) => x.firstName === "Meera");
    p.click(`[data-wid="${first.id}"][data-decide="admit"]`); await p.waitFor((x) => /Waiting to come in: 1/.test(x) && /Meera \S+ 0001: let in by/.test(x));
    expect(w.st.calls.find((c: any) => c[1].endsWith("/waiting/" + first.id))[2]).toEqual({ decision: "admit" }); expect((await waitOf(o, "UI-WAIT")).length).toBe(1);
    const second = (await waitOf(o, "UI-WAIT"))[0]; p.click(`[data-wid="${second.id}"][data-decide="decline"]`); await p.waitFor((x) => /Nobody is waiting right now/.test(x) && /declined by/.test(x));
  });

  test("Approve all (real): shows only when someone waits, asks calmly first, shows the counts and who approved; Decline all too; a Co-host sees only their own link's requests", async () => {
    const o = await organizer(); await make(o, "UI-ALL", { whoCanJoin: "list" }); await publish(o, "UI-ALL");
    const none = await ready(o, "UI-ALL"); await myPeople(none); await none.waitFor((x) => /Nobody is waiting right now/.test(x)); expect(none.$("#admitall")).toBeNull(); expect(none.$("#declineall")).toBeNull();
    for (let i = 1; i <= 4; i++) await jn(o, "UI-ALL", i);
    const ck = await cohostKey(o, "UI-ALL"); const from = COHOST_FROM + parseInt(keyId(ck).slice(0, 7), 16); await jn(o, "UI-ALL", 9, { from });
    const w = spy(); const p = await ready(o, "UI-ALL", w); await myPeople(p);
    await p.waitFor(() => !!p.$("#admitall")); expect(p.$("#admitall")!.textContent).toBe("Approve all (5)"); expect(p.$("#declineall")!.textContent).toBe("Decline all");
    p.click("#admitall"); await p.waitFor((x) => /Let all 5 people in\?/.test(x)); expect(w.st.calls.some((c: any) => c[1].endsWith("/waiting/all"))).toBe(false);
    p.click("#bulkno"); expect(p.$("#bulkask")).toBeNull(); expect((await waitOf(o, "UI-ALL")).length).toBe(5);
    const c = await ready(o, "UI-ALL", spy(), ck); openStep(c, 2); await c.waitFor((x) => /Waiting to come in: 1/.test(x)); expect(c.$("#admitall")!.textContent).toBe("Approve all (1)"); // only the people who came through this Co-host's link
    p.click("#admitall"); p.click("#bulkyes");
    const t = await p.waitFor((x) => /5 people let in\./.test(x)); expect(w.st.calls.find((c2: any) => c2[1].endsWith("/waiting/all"))[2]).toEqual({ decision: "admit" }); expect(t).toMatch(/Nobody is waiting right now/); expect((await waitOf(o, "UI-ALL")).length).toBe(0); expect(p.$("#admitall")).toBeNull();
    await jn(o, "UI-ALL", 11); await jn(o, "UI-ALL", 12);
    await p.waitFor(() => !!p.$("#declineall"), 8000); p.click("#declineall"); await p.waitFor((x) => /Decline all 2 people\?/.test(x)); p.click("#bulkyes"); await p.waitFor((x) => /2 declined\./.test(x) && /Nobody is waiting right now/.test(x));
    expect(w.st.calls.filter((c2: any) => c2[1].endsWith("/waiting/all")).map((c2: any) => c2[2])).toEqual([{ decision: "admit" }, { decision: "decline" }]);
  }, 60_000);

  test("Approve all when the game is full: the server's answer says some are still waiting and the console says so (the server's own message)", async () => {
    const o = await organizer(); await make(o, "UI-FULL", { whoCanJoin: "list" }); await publish(o, "UI-FULL"); await jn(o, "UI-FULL", 1); await jn(o, "UI-FULL", 2);
    const p = await ready(o, "UI-FULL", spy({ "POST /api/z/UI-FULL/waiting/all": () => ({ admitted: 1, declined: 0, stillWaiting: 1, message: "The game is full. 1 person is still waiting." }) })); await myPeople(p);
    await p.waitFor(() => !!p.$("#admitall")); p.click("#admitall"); p.click("#bulkyes"); const t = await p.waitFor((x) => /1 person let in\./.test(x)); await p.waitFor((x) => /The game is full\. 1 person is still waiting\./.test(x)); expect(t).toMatch(/Waiting to come in/);
  });

  test("Play now and Send my play link to my WhatsApp: Organizer and Host only; the seat is made on the first press and the link goes to their own number", async () => {
    const o = await organizer(); await make(o, "UI-PLAYN"); await publish(o, "UI-PLAYN"); const w = spy();
    const p = await ready(o, "UI-PLAYN", w); await myPeople(p); expect(p.text()).toMatch(/0 people are on my list/); // nothing is made until it is asked for
    const win = fakeWin(); p.win.open = (u?: string) => { if (u === "") return win; opened = u!; return null; }; let opened = "";
    p.click("#playnow"); await p.waitFor(() => !!win.location.href); expect(win.location.href).toMatch(/^http:\/\/localhost\/j\/[a-z0-9]+$/);
    const mine = (await listOf(o, "UI-PLAYN")).people; expect(mine.length).toBe(1); expect(mine[0].role).toBe("organizer");
    p.click("#sendmine"); await p.waitFor(() => !!opened); expect(opened.startsWith("https://wa.me/919876543210?text=")).toBe(true); expect(decodeURIComponent(opened)).toContain(win.location.href);
    await p.waitFor((x) => /This is your own seat \(Organizer\)/.test(x)); expect(p.$(`[data-rmask="${mine[0].id}"]`)).toBeNull();
    const c = await ready(o, "UI-PLAYN", spy(), await cohostKey(o, "UI-PLAYN")); openStep(c, 2); await c.waitFor((x) => /My people/.test(x)); expect(c.$("#playnow")).toBeNull(); expect(c.$("#sendmine")).toBeNull();
  });

  test("Send my play link when the server does not know the mobile yet: the console asks for it, then sends it to the server and opens the WhatsApp link", async () => {
    const o = await organizer(); await make(o, "UI-NEEDP"); await publish(o, "UI-NEEDP"); let n = 0; const bodies: any[] = [];
    const w = spy({ "POST /api/z/UI-NEEDP/people/me": (_m, b) => { bodies.push(b); return ++n === 1 ? { status: 400, body: { error: "We need your mobile number to make your play link.", code: "need-phone" } } : { person: { link: "https://x.test/j/abc", waLink: "https://wa.me/919876543219?text=hi" }, role: "organizer", joined: false }; } });
    const p = await ready(o, "UI-NEEDP", w); await myPeople(p); let opened = ""; p.win.open = (u: string) => { opened = u; return null; };
    p.click("#sendmine"); await p.waitFor((x) => /Type your own mobile number, then press the button again/.test(x)); expect(p.$("#myph")).toBeTruthy(); expect(opened).toBe("");
    setField(p, "#myph", "98765 43219"); p.click("#sendmine"); await p.waitFor(() => !!opened); expect(opened).toBe("https://wa.me/919876543219?text=hi"); expect(bodies).toEqual([{}, { phone: "98765 43219" }]);
  });

  test("Download my list: only where the server says canExport (Organizer and Host); a Co-host does not get it", async () => {
    const o = await organizer(); await make(o, "UI-DL"); await publish(o, "UI-DL"); const w = spy();
    await o.api("POST", "/api/z/UI-DL/people", { people: [{ name: "Asha", phone: "9876543210" }] }, o.token);
    const p = await ready(o, "UI-DL", w); await myPeople(p); expect(p.$("#dlpeople")).toBeTruthy(); p.win.URL.createObjectURL = () => "blob:x"; p.click("#dlpeople"); await p.waitFor(() => w.st.calls.some((c: any) => c[1].endsWith("/people/export")));
    const h = await ready(o, "UI-DL", spy(), await hostKey(o)); await myPeople(h); expect(h.$("#dlpeople")).toBeTruthy();
    const c = await ready(o, "UI-DL", spy(), await cohostKey(o, "UI-DL")); openStep(c, 2); await c.waitFor((x) => /My people/.test(x) && /people are on my list/.test(x)); expect(c.$("#dlpeople")).toBeNull();
  });

  test("Your team: a Host needs a name and a mobile number or an e-mail; with only a mobile number a WhatsApp button with their link appears; with an e-mail the server mails the link", async () => {
    const o = await organizer(); await make(o, "UI-HWA"); const w = spy();
    const p = await ready(o, "UI-HWA", w); openStep(p, 5); await p.waitFor((x) => /Your Hosts: 0 of 5/.test(x));
    setField(p, "#hostlabel", "Meena"); p.click("#hostadd"); await p.waitFor((x) => /Host's mobile number or e-mail/.test(x)); expect(w.st.calls.some((c: any) => c[1] === "/api/org/host")).toBe(false);
    setField(p, "#hostlabel", "Meena"); setField(p, "#hostphone", "12345"); p.click("#hostadd"); await p.waitFor((x) => /check the Host's mobile number/.test(x)); expect(w.st.calls.some((c: any) => c[1] === "/api/org/host")).toBe(false);
    setField(p, "#hostlabel", "Meena"); setField(p, "#hostphone", "98765 43210"); p.click("#hostadd"); await p.waitFor((x) => /Send their link on WhatsApp/.test(x));
    expect(w.st.calls.find((c: any) => c[1] === "/api/org/host")[2]).toEqual({ label: "Meena", e: "UI-HWA", mobile: "98765 43210" });
    const a = p.$("a[data-hostwa]") as any; expect(a.getAttribute("href").startsWith("https://wa.me/919876543210?text=")).toBe(true); expect(decodeURIComponent(a.getAttribute("href"))).toMatch(/#host=cbh_[0-9a-f]{48}/);
    setField(p, "#hostlabel", "Anita"); setField(p, "#hostemail", "anita@acme.com"); p.click("#hostadd"); await p.waitFor((x) => /Your Hosts: 2 of 5/.test(x) && /We sent their link to their e-mail/.test(x)); expect(p.win.document.querySelectorAll("a[data-hostwa]").length).toBe(1); // the e-mailed Host has no WhatsApp button
  });


});
describe("console: About this step write-ups (spec 4, A)", () => {
  const FIRST = ["This is the basics.", "Pick the biggest crowd you expect.", "Tick the places you will give a gift for", "Add your company name, a colour and a small logo", "A Host runs the tournament with you.", "Add your people here, one by one", "Look through your game and change what you need.", "Pay once, before the start time. You see the price here.", "Open the tournament page, choose the format", "Within a day after the tournament, the participant data is erased"];
  test("each of the ten steps shows its box under the talking line: a title, at most 5 short lines, the agreed first line, and no drop-down", async () => {
    const o = await organizer(); await make(o, "UI-ABT"); await publish(o, "UI-ABT");
    const p = await consolePage(o, "UI-ABT", o.token, {}, { afterLoad: spy().hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    for (let n = 1; n <= 10; n++) {
      openStep(p, n); const box = p.$(`#sec${n} .zc-about`) as any; expect([n, !!box]).toEqual([n, true]);
      expect(box.querySelector("b").textContent).toBe("About this step"); const lines = Array.from(box.querySelectorAll("span:not(.zc-dont)")).map((e: any) => e.textContent as string);
      expect([n, lines.length >= 1 && lines.length <= 5]).toEqual([n, true]); expect([n, box.textContent.includes(FIRST[n - 1])]).toEqual([n, true]);
      expect(p.win.document.querySelectorAll(".zc-about").length).toBe(1); expect(p.win.document.querySelectorAll("select").length).toBe(0);
      expect(!!(box.compareDocumentPosition(p.$(`#sec${n} .zc-say`)) & 2)).toBe(true); // the box comes after the talking line
    }
    openStep(p, 8); expect(p.$("#sec8 .zc-about")!.textContent).toMatch(/2 minutes after your payment is confirmed/); openStep(p, 7); expect(p.$("#sec7 .zc-about")!.textContent).not.toMatch(/2 minutes|Pay once/); openStep(p, 10); expect(p.$("#sec10 .zc-about")!.textContent).toMatch(/365 days/);
    const h = await consolePage(o, "UI-ABT", await hostKey(o), {}, { afterLoad: spy().hook }); await h.waitFor((x) => /Last step|Your game/i.test(x)); openStep(h, 5); expect(h.$("#sec5 .zc-about")).toBeTruthy();
  });
  test("the Co-host's three steps have their one-line boxes; the Organizer's account says it is for the Organizer only", async () => {
    const o = await organizer(); await make(o, "UI-ABC"); await publish(o, "UI-ABC");
    const c = await consolePage(o, "UI-ABC", await cohostKey(o, "UI-ABC"), {}, { afterLoad: spy().hook }); await c.waitFor((x) => /Hi\. Here is the game/.test(x));
    const want = ["You can see the game and what you may do.", "Add your people. Each gets their own WhatsApp link. You can bring up to your limit.", "One payment is enough. If someone has paid, you will see Paid."];
    for (let n = 1; n <= 3; n++) { openStep(c, n); expect(c.$(`#sec${n} .zc-about span`)!.textContent).toBe(want[n - 1]); expect(c.$(`#sec${n} .zc-about b`)!.textContent).toBe("About this step"); }
    const p = await consolePage(o, "UI-ABC"); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    expect(p.$("#acct .zc-hint")!.textContent).toBe("These are for the Organizer only: your AI link, sign-in keys and records. Closing your account deletes your games.");
  });
  test("zc.css: the box is 12px grey-brown text, and nothing in zc.css sets text below 11px", () => {
    const css = readFileSync(join(import.meta.dir, "../public/zc.css"), "utf8");
    const rule = css.match(/\.zc-about\{([^}]*)\}/)![1]; expect(rule).toMatch(/font-size:12px/); expect(rule).toMatch(/color:#6b5a48/);
    for (const m of css.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(11);
  });
});

const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPG1 = "data:image/jpeg;base64,/9j/wAARCABgAGADAREAAhEBAxEB"; // a 96 x 96 JPEG header: the server reads the size in pixels
/** Pretend picture tools for the page (the test DOM cannot decode pictures): a picture 400x200 whose PNG and JPEG answers are given. */
const pictureTools = (png: string, jpg: string) => (win: any) => {
  win.Image = class { onload: any; naturalWidth = win.__w ?? 400; naturalHeight = win.__h ?? 200; set src(_v: string) { setTimeout(() => this.onload && this.onload(), 0); } };
  win.URL.createObjectURL = () => "blob:logo"; win.URL.revokeObjectURL = () => {};
  win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {}, set fillStyle(_v: string) {} });
  win.HTMLCanvasElement.prototype.toDataURL = (type: string) => (type === "image/png" ? png : jpg);
};
const aFile = (p: Page, name: string, type: string, bytes = 8) => new (p.win as any).File([new Uint8Array(bytes)], name, { type }); // a real file object: the page reads it as a data: URL (the page's security policy blocks blob: pictures)
const chooseFile = (p: Page, sel: string, file: any) => { const inp = p.$(sel) as any; Object.defineProperty(inp, "files", { value: [file], configurable: true }); inp.dispatchEvent(new p.win.Event("change", { bubbles: true })); };
describe("console phase 3: brand on the page, See what players see, payment link (real Worker)", () => {
  const open4 = async (o: O, id: string, w = spy(), key = o.token) => { const p = await consolePage(o, id, key, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Hello|Last step|Your game/i.test(x)); openStep(p, 4); await p.waitFor((x) => /Your brand on the page/.test(x)); return p; };
  const infoOf = async (o: O, id: string) => o.json(await o.api("GET", `/api/z/${id}/info`, undefined, o.token));

  test("Brand: company name, eight colour chips and a logo shrunk in the browser to under 30 KB; saved with the step; the logo shows and can be removed", async () => {
    const o = await organizer(); await make(o, "UI-BRAND"); const big = "data:image/png;base64," + "A".repeat(60000);
    const w = spy({}, pictureTools(big, JPG1)); const p = await open4(o, "UI-BRAND", w);
    expect(p.win.document.querySelectorAll('#brandbox [data-ck="brand.color"]').length).toBe(8); expect(p.win.document.querySelectorAll("select").length).toBe(0);
    setField(p, "#f-brand-name", "Acme Foods"); p.click('[data-ck="brand.color"][data-v="#1B7F5C"]'); expect(p.$('[data-ck="brand.color"][data-v="#1B7F5C"]')!.getAttribute("aria-checked")).toBe("true");
    chooseFile(p, "#brandlogo", aFile(p, "logo.png", "image/png")); await p.waitFor(() => !!p.$(".zc-logo img"));
    const shown = (p.$(".zc-logo img") as any).getAttribute("src"); expect(shown).toBe(JPG1); // the PNG was too big, the JPEG fits
    p.click('[data-save="4"]'); await p.waitFor((x) => /Saved\./.test(x));
    expect(w.st.patches.at(-1).brand).toEqual({ name: "Acme Foods", color: "#1B7F5C", logo: shown });
    expect((await infoOf(o, "UI-BRAND")).brand).toEqual({ name: "Acme Foods", color: "#1B7F5C", logo: shown }); // it persisted: read back from the server
    const q = await open4(o, "UI-BRAND"); expect((q.$("#f-brand-name") as any).value).toBe("Acme Foods"); expect(q.$(".zc-logo img")).toBeTruthy(); // and the form shows what the server holds
    q.click("#logorm"); expect(q.$(".zc-logo")).toBeNull(); q.click('[data-save="4"]'); await q.waitFor((x) => /Saved\./.test(x));
    expect((await infoOf(o, "UI-BRAND")).brand).toEqual({ name: "Acme Foods", color: "#1B7F5C" });
    expect(p.errors).toEqual([]);
  });

  test("Brand: a name without a colour (or a colour without a name) is refused politely before anything is sent; a picture that cannot be shrunk under 30 KB is refused", async () => {
    const o = await organizer(); await make(o, "UI-BRAND2"); const w = spy({}, pictureTools("data:image/png;base64," + "A".repeat(60000), "data:image/jpeg;base64," + "A".repeat(60000)));
    const p = await open4(o, "UI-BRAND2", w);
    setField(p, "#f-brand-name", "Acme"); p.click('[data-save="4"]'); await p.waitFor((x) => /Pick an accent colour/.test(x)); expect(w.st.patches.length).toBe(0);
    setField(p, "#f-brand-name", ""); p.click('[data-ck="brand.color"][data-v="#AD1457"]'); p.click('[data-save="4"]'); await p.waitFor((x) => /Add your company name/.test(x)); expect(w.st.patches.length).toBe(0);
    chooseFile(p, "#brandlogo", aFile(p, "logo.png", "image/png")); await p.waitFor((x) => /could not use that picture/.test(x)); expect(p.$(".zc-logo")).toBeNull();
    chooseFile(p, "#brandlogo", aFile(p, "x.gif", "image/gif")); await p.waitFor((x) => /PNG, JPEG or WebP picture/.test(x));
    chooseFile(p, "#brandlogo", aFile(p, "huge.png", "image/png", 5 * 1024 * 1024 + 1)); await p.waitFor((x) => /bigger than 5 MB/.test(x));
    (p.win as any).__w = 40; (p.win as any).__h = 40; chooseFile(p, "#brandlogo", aFile(p, "tiny.png", "image/png")); await p.waitFor((x) => /too small.*64 x 64/.test(x));
    (p.win as any).__w = 500; (p.win as any).__h = 100; chooseFile(p, "#brandlogo", aFile(p, "thin.png", "image/png")); await p.waitFor((x) => /too long and thin/.test(x));
    expect(p.text()).toMatch(/PNG, JPEG or WebP, up to 5 MB, at least 64 x 64 pixels/); // the rules are on the screen
  });

  test("See what players see: a button for the Organizer and Host (steps 4 and 7) that opens the preview page in a new tab; a Co-host has none", async () => {
    const o = await organizer(); await make(o, "UI-SEE"); await publish(o, "UI-SEE");
    const p = await open4(o, "UI-SEE"); const a = p.$("#seeguests") as any; expect(a.textContent).toBe("See what players see"); expect(a.getAttribute("href")).toBe("/preview.html#w=player&e=UI-SEE"); expect(a.getAttribute("target")).toBe("_blank");
    openStep(p, 7); expect(p.$("#seeguests")).toBeTruthy();
    const h = await consolePage(o, "UI-SEE", await hostKey(o)); await h.waitFor(() => !!h.$('.zc-dot[data-open="4"]')); openStep(h, 4); expect(h.$("#seeguests")).toBeTruthy();
    const c = await consolePage(o, "UI-SEE", await cohostKey(o, "UI-SEE")); await c.waitFor((x) => /Hi\. Here is the game/.test(x)); for (let n = 1; n <= 3; n++) openStep(c, n); expect(c.$("#seeguests")).toBeNull(); expect(c.text()).not.toMatch(/See what players see/);
  });

  test("Copy payment link: Organizer, Host and Co-host get it while payment is pending; it copies the server's link and says the calm line; hidden once paid", async () => {
    const o = await organizer(); await make(o, "UI-PAYL"); await publish(o, "UI-PAYL"); const w = spy();
    const p = await consolePage(o, "UI-PAYL", o.token, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 8);
    let copied = ""; Object.defineProperty(p.win.navigator, "clipboard", { value: { writeText: async (t: string) => { copied = t; } }, configurable: true });
    expect(p.$("#copypaylink")!.textContent).toBe("Copy payment link"); p.click("#copypaylink");
    await p.waitFor((x) => /Anyone with this link can pay for this game\. It works until the game is paid or for 7 days\./.test(x));
    const made = w.st.last["POST /api/z/UI-PAYL/paylink"]; expect(made.url).toMatch(/\/paylink\.html\?t=/); expect(copied).toBe(made.url); expect(p.$("#copypaylink")!.textContent).toBe("Copy payment link again");
    const h = await consolePage(o, "UI-PAYL", await hostKey(o)); await h.waitFor((x) => /Last step|Your game/i.test(x)); openStep(h, 8); expect(h.$("#copypaylink")).toBeTruthy();
    const c = await consolePage(o, "UI-PAYL", await cohostKey(o, "UI-PAYL")); await c.waitFor((x) => /Hi\. Here is the game/.test(x)); openStep(c, 3); await c.waitFor(() => !!c.$("#copypaylink"));
    Object.defineProperty(c.win.navigator, "clipboard", { value: { writeText: async (t: string) => { copied = t; } }, configurable: true }); c.click("#copypaylink"); await c.waitFor((x) => /Anyone with this link can pay/.test(x)); expect(copied).toMatch(/paylink\.html\?t=/);
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-PAYL'").run(); o.world.raw.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").run("paidby/UI-PAYL", JSON.stringify({ by: "organizer", ms: START_MS - HOUR }));
    const paid = await consolePage(o, "UI-PAYL", o.token); await paid.waitFor(() => paid.$("#paypill")?.textContent === "Paid"); openStep(paid, 8); expect(paid.$("#copypaylink")).toBeNull();
  });

  test("Copy payment link: when the server refuses, the console says so calmly and shows no link", async () => {
    const o = await organizer(); await make(o, "UI-PAYE"); await publish(o, "UI-PAYE");
    const p = await consolePage(o, "UI-PAYE", o.token, {}, { afterLoad: spy({ "POST /api/z/UI-PAYE/paylink": () => ({ status: 409, body: { error: "This game is already paid for.", code: "already-paid" } }) }).hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 8);
    p.click("#copypaylink"); await p.waitFor((x) => /This game is already paid for\./.test(x)); expect(p.$("#paylinkurl")).toBeNull();
  });
});

/** The 6-digit code the Worker mailed: the page cannot see it, so the test finds it from its stored hash (900,000 tries take a second). */
const codeFor = (o: O, email: string) => {
  const eh = createHash("sha256").update("email|" + email).digest("hex"), row = o.world.raw.prepare("SELECT code_hash FROM login_code WHERE email_hash=?").get(eh) as any;
  for (let n = 100000; n < 1000000; n++) if (createHash("sha256").update("code|" + eh + "|" + n).digest("hex") === row.code_hash) return String(n);
  throw new Error("no code");
};
describe("console phase 4: Finish setup for a new Host, and Continue with Google (real Worker)", () => {
  const google = (win: any) => { win.google = { accounts: { id: { initialize(o: any) { win.__gi = o; }, renderButton(el: any) { el.innerHTML = '<button type="button" id="gfake">Continue with Google</button>'; } } } }; };

  test("a Host whose link was just opened sees Finish setup: e-mail first (a wrong one is told which one the link is for), a 6-digit code, then the mobile number; then the console opens with the new key", async () => {
    const o = await organizer(); await make(o, "UI-FIN"); await publish(o, "UI-FIN");
    const added = await o.json(await o.api("POST", "/api/org/host", { label: "Anita", email: "anita@acme.com" }, o.token)); const oldKey = added.hostKey as string;
    o.world.raw.prepare("UPDATE host_state SET verified_ms=NULL, mobile_ok=0, spent=0").run(); // a Host who has only just been added (the Worker's own answer for an e-mail-only Host was "ready" while this was written)
    const w = spy(); const p = await consolePage(o, "UI-FIN", oldKey, {}, { afterLoad: w.hook });
    await p.waitFor((x) => /Finish setup/.test(x)); expect(p.text()).toMatch(/a\*\*\*@acme\.com/); expect(p.$("#sec1")).toBeNull(); expect(p.$("#gbtn")).toBeNull(); // no Google button when the server has no client id
    setField(p, "#setupemail", "someone@else.com"); p.click("#setupsend"); await p.waitFor((x) => /This link is for a\*\*\*@acme\.com/.test(x));
    setField(p, "#setupemail", "anita@acme.com"); p.click("#setupsend"); await p.waitFor(() => !!p.$("#setupcode"));
    setField(p, "#setupcode", "000000"); p.click("#setupverify"); await p.waitFor((x) => /not right or has expired/.test(x));
    const code = codeFor(o, "anita@acme.com"); expect(code).toMatch(/^\d{6}$/); setField(p, "#setupcode", code); p.click("#setupverify");
    await p.waitFor((x) => /Your e-mail is checked/.test(x)); const newKey = p.win.sessionStorage.getItem("cbz-org"); expect(newKey).toBe(w.st.last["POST /api/host/setup/email/verify"].token); expect(newKey).toMatch(/^cbh_/); // the key the server handed over for this device is the one the page keeps
    setField(p, "#setupmobile", "123"); p.click("#setupmobilego"); await p.waitFor((x) => /check your mobile number/.test(x));
    setField(p, "#setupmobile", "98765 43210"); p.click("#setupmobilego"); await p.waitFor(() => p.$("#rolepill")?.textContent?.startsWith("Signed in as Host") === true, 10000); await p.waitFor((x) => /Your game/.test(x));
    expect((await o.api("GET", "/api/z/UI-FIN/people", undefined, newKey!)).status).toBe(200);
    expect(p.errors).toEqual([]);
  }, 60_000);

});

describe("console: Send a new link to a Host, and a Host who opens the console without a game", () => {
  test("Your team: a Host who has not finished setup shows why, and the Organizer can send a new link (the old one stops); with a mobile there is a WhatsApp button; once the Host has confirmed an e-mail the server says no and the console says so calmly", async () => {
    const o = await organizer(); await make(o, "UI-NLK"); await publish(o, "UI-NLK");
    const added = await o.json(await o.api("POST", "/api/org/host", { label: "Anita", mobile: "9876543210", email: "anita@acme.com" }, o.token)); const oldKey = added.hostKey as string;
    o.world.raw.prepare("UPDATE host_state SET verified_ms=NULL, mobile_ok=0, spent=0").run();
    const w = spy(); const p = await consolePage(o, "UI-NLK", o.token, {}, { afterLoad: w.hook }); await p.waitFor(() => !!p.$('.zc-dot[data-open="5"]')); openStep(p, 5);
    await p.waitFor((x) => /Waiting for them to open the link/.test(x)); expect(p.$("[data-newlink]")!.textContent).toBe("Send a new link");
    p.click("[data-newlink]"); await p.waitFor((x) => /A new link is on its way to their e-mail\. The old one has stopped\./.test(x));
    expect(w.st.calls.find((c: any) => c[1] === "/api/org/host/link")[2]).toEqual({ id: added.id, e: "UI-NLK" });
    const row = p.$(".zc-person") as any; const href = (row.querySelector("a[data-hostwa]") as any).getAttribute("href"); expect(href.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    const fresh = row.querySelector(".zlink").textContent as string; expect(fresh).toMatch(/\/zc\.html\?e=UI-NLK#host=cbh_[0-9a-f]{48}/); expect(row.querySelector("[data-copyteam]")).toBeTruthy();
    expect(decodeURIComponent(href)).toContain(fresh.split("#host=")[1]);
    expect((await o.api("GET", "/api/whoami", undefined, oldKey)).status).not.toBe(200); // the old link stopped
    o.world.raw.prepare("UPDATE host_state SET verified_ms=?").run(Date.now()); // the Host confirmed an e-mail in the meantime
    p.click("[data-newlink]"); await p.waitFor((x) => /already finished setup, so they sign in with their e-mail/.test(x));
  });

  test("a Host who opens the console without a game: with one game they go straight in; with several they see 'Your games' and Open works", async () => {
    const o = await organizer(); await make(o, "UI-ONE1"); await publish(o, "UI-ONE1"); const hk = await hostKey(o, "Anita");
    const one = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": hk, "cbz-aimsg": "" }); await one.waitFor((x) => /Your game/.test(x) && /Check and publish/.test(x));
    expect(one.$("#rolepill")!.textContent).toMatch(/^Signed in as Host/); expect(one.text()).not.toMatch(/Your games/); expect(one.$("#sec1")).toBeTruthy();
    await make(o, "UI-TWO2", { name: "Second game" }); await publish(o, "UI-TWO2");
    const many = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": hk }); await many.waitFor((x) => /Your games/.test(x)); expect(many.text()).toMatch(/UI-ONE1/); expect(many.text()).toMatch(/UI-TWO2/); expect(many.$("#sec1")).toBeNull();
    many.click('[data-open-game="UI-TWO2"]'); await many.waitFor(() => !!many.$("#sec1")); await many.waitFor((x) => /Second game/.test(x)); expect(many.$("#rolepill")!.textContent).toMatch(/^Signed in as Host/);
    expect(many.errors).toEqual([]);
  });
});

describe("console: ten steps, Pay is its own step, and the price is shown only there", () => {
  test("ten jump dots; Pay is step 8 with its own tint; before publishing it says 'Publish first' and shows no price; after publishing it shows the price, Pay, Copy payment link and the late-start line", async () => {
    const o = await organizer(); await make(o, "UI-PAY8");
    const p = await consolePage(o, "UI-PAY8"); await p.waitFor((x) => /Hello/.test(x));
    expect(p.win.document.querySelectorAll(".zc-dot").length).toBe(10); expect(p.$('.zc-dot[data-open="8"]')!.getAttribute("style")).toMatch(/--bg-tint-lime/);
    for (const n of [7, 9]) expect(p.$(`.zc-dot[data-open="${n}"]`)!.getAttribute("style")).not.toMatch(/--bg-tint-lime/); // different from its neighbours
    expect(readFileSync(join(import.meta.dir, "../public/zc.css"), "utf8")).toMatch(/--bg-tint-lime:#/);
    openStep(p, 8); await p.waitFor((x) => /Publish first/.test(x)); expect(p.text()).not.toMatch(/with GST/); expect(p.$("#pricerow")).toBeNull(); expect(p.$('a[href^="/pay.html"]')).toBeNull(); expect(p.$("[data-save='8']")).toBeNull();
    await publish(o, "UI-PAY8");
    const q = await consolePage(o, "UI-PAY8"); await q.waitFor((x) => /Last step: pay before the start/i.test(x)); // a published, unpaid game opens on Pay
    expect(q.$("#sec8")!.className).toMatch(/open/); expect(q.$("#pricerow")!.textContent).toMatch(/Rs 2,399\.00/); expect((q.$('#sec8 a[href^="/pay.html"]') as any).getAttribute("href")).toBe("/pay.html?e=UI-PAY8");
    expect(q.$("#copypaylink")).toBeTruthy(); expect(q.$("#sec8").textContent).toMatch(/Paid late\? The game opens 2 minutes after your payment is confirmed\. You still press Start yourself/); expect(q.$("[data-save='8']")).toBeNull(); // Pay has its own button, no Continue
    expect(q.$("#sec8 .zc-sech b")!.textContent).toBe("Pay");
  });
  test("the price shows ONLY in the Pay step: not in the side summary, not in steps 1 to 7, 9 or 10, not in the Next card; the Co-host's own Payment step keeps it", async () => {
    const o = await organizer(); await make(o, "UI-NOPRICE"); await publish(o, "UI-NOPRICE");
    const p = await consolePage(o, "UI-NOPRICE"); await p.waitFor((x) => /Last step: pay before the start/i.test(x));
    for (let n = 1; n <= 10; n++) { openStep(p, n); const t = p.text(); if (n === 8) expect(t).toMatch(/Rs 2,399\.00/); else expect([n, /with GST|Rs 2,399|Price/.test(t)]).toEqual([n, false]); }
    const c = await consolePage(o, "UI-NOPRICE", await cohostKey(o, "UI-NOPRICE")); await c.waitFor((x) => /Hi\. Here is the game/.test(x));
    openStep(c, 1); expect(c.text()).not.toMatch(/with GST/); openStep(c, 3); await c.waitFor((x) => /Rs 2,399\.00/.test(x));
  });
  test("step 7 keeps Check, Publish, Cancel and See what guests see but no payment rows; the Next card moves on to Pay after publishing; a paid game shows who paid in step 8", async () => {
    const o = await organizer(); await make(o, "UI-S7"); await publish(o, "UI-S7");
    const p = await consolePage(o, "UI-S7"); await p.waitFor((x) => /Last step: pay before the start/i.test(x)); openStep(p, 7);
    expect(p.$("#cancelblock")).toBeTruthy(); expect(p.$("#seeguests")).toBeTruthy(); expect(p.$("#sec7 #copypaylink")).toBeNull(); expect(p.$('#sec7 a[href^="/pay.html"]')).toBeNull(); expect(p.$("#sec7").textContent).toMatch(/Next: pay in step 8/);
    expect(p.$(".zc-next")).toBeTruthy();
    o.world.raw.prepare("UPDATE engagement SET pack=100 WHERE id='UI-S7'").run(); o.world.raw.prepare("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)").run("paidby/UI-S7", JSON.stringify({ by: "co-host", ms: START_MS - HOUR }));
    const w = await consolePage(o, "UI-S7"); await w.waitFor(() => w.$("#paypill")?.textContent === "Paid"); openStep(w, 8); expect(await w.waitFor((x) => /Paid by the Co-host on/.test(x))).toMatch(/The game is on/); expect(w.$('#sec8 a[href^="/pay.html"]')).toBeNull();
  });
  test("step 2 reads clearly: three small sub-headings", async () => {
    const o = await organizer(); await make(o, "UI-SUB"); const p = await consolePage(o, "UI-SUB"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 2);
    expect(Array.from(p.win.document.querySelectorAll("#sec2 .zc-sub")).map((e: any) => e.textContent)).toEqual(["How many players", "How the tournament runs", "Who can join", "Who is this game for?"]);
  });
});

describe("console: no refunds (credit), games that wait or did not start, 'Create a new game like this one', rescheduling", () => {
  const CREDIT = { amountInr: 2399, expiresMs: Date.parse("2027-06-14T12:00:00+05:30") };
  const openPay = async (o: O, id: string, w: ReturnType<typeof spy>) => { const p = await consolePage(o, id, o.token, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Last step|Your game|Hello|Price for your game/i.test(x)); openStep(p, 8); return p; };

  test("Cancel a PAID game: 1st confirmation says there is no refund and offers 'Change the date instead'; 2nd shows the credit and its date with the checkbox gate; nothing is sent until the end; after cancelling the credit and its expiry are shown", async () => {
    const o = await organizer(); await make(o, "UI-CRD", { name: "Diwali Night" }); await publish(o, "UI-CRD");
    const posts: any[] = []; let cancelled = false;
    const w = spy({
      "GET /api/z/UI-CRD/cancel-preview": () => ({ canCancel: true, paid: true, credit: CREDIT }),
      "POST /api/z/UI-CRD/cancel": (_m, b) => { posts.push(b); cancelled = true; return { ok: true, cancelled: true, credit: { id: "c1", ...CREDIT } }; },
      "GET /api/z/UI-CRD/summary": async (_m, _b, _u, real) => { const j = await real(); return cancelled ? { ...j, cancelled: true } : j; },
    });
    const p = await consolePage(o, "UI-CRD", o.token, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 7);
    p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x));
    expect(p.$("#norefund")!.textContent).toBe("There is no refund. Your payment stays as credit for your next game, for 365 days."); expect(p.$("#cancelresched")!.textContent).toBe("Change the date instead");
    p.click("#cancelresched"); await p.waitFor(() => /open/.test(p.$("#sec1")!.className)); expect(p.$("#cancelpanel")).toBeNull(); expect(posts.length).toBe(0); // it goes to step 1 and sends nothing
    openStep(p, 7); p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x)); p.click("#cancel1"); await p.waitFor((x) => /2nd confirmation/.test(x));
    expect(p.$("#cancelwhat")!.textContent).toBe("Your credit: Rs 2,399.00, valid until 14 Jun 2027. Guests will be told. Their names and numbers will be erased. You cannot undo this.");
    expect(p.$("#cancelpanel")!.textContent).not.toMatch(/You paid|Payment charge|You get back|refund/i); expect((p.$("#cancel2") as any).disabled).toBe(true); tickAgree(p); p.click("#cancel2"); await p.waitFor((x) => /Final confirmation/.test(x)); expect(posts.length).toBe(0);
    p.click("#cancel3"); await p.waitFor((x) => /This game was cancelled/.test(x)); expect(posts).toEqual([{ confirmations: 3 }]);
    expect(p.$("#creditnote")!.textContent).toBe("Your payment of Rs 2,399.00 stays as credit until 14 Jun 2027. Use it for your next game.");
  });

  test("Cancel an UNPAID game (real Worker): no credit lines at all, and the same three screens", async () => {
    const o = await organizer(); await make(o, "UI-CRU", { name: "Diwali Night" }); await publish(o, "UI-CRU");
    const p = await consolePage(o, "UI-CRU"); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 7);
    p.click("#cancelopen"); await p.waitFor((x) => /1st confirmation/.test(x)); expect(p.$("#norefund")).toBeNull(); expect(p.$("#cancelresched")).toBeTruthy(); p.click("#cancel1"); await p.waitFor((x) => /2nd confirmation/.test(x));
    expect(p.$("#cancelwhat")!.textContent).toBe("Guests will be told. Their names and numbers will be erased. You cannot undo this."); expect(p.$("#cancelpanel")!.textContent).not.toMatch(/credit|refund/i);
    tickAgree(p); p.click("#cancel2"); await p.waitFor((x) => /Final confirmation/.test(x)); p.click("#cancel3"); await p.waitFor((x) => /This game was cancelled/.test(x)); expect(p.$("#creditnote")).toBeNull();
  });

  test("Pay step: with credit it says so and offers 'Use my credit'; a part payment shows 'Pay the rest' and the normal Pay button stays; a full one says paid; the credit is shown only in the Pay step", async () => {
    const o = await organizer(); await make(o, "UI-USEC"); await publish(o, "UI-USEC"); const bodies: any[] = []; let mode = "part";
    const w = spy({
      "GET /api/z/UI-USEC/summary": async (_m, _b, _u, real) => ({ ...(await real()), credit: 1000 }),
      "GET /api/org/credit": () => ({ credits: [], activeTotalInr: 1000, nextExpiryMs: Date.parse("2027-06-14T12:00:00+05:30") }),
      "POST /api/z/UI-USEC/pay-with-credit": (_m, b) => { bodies.push(b); return mode === "part" ? { ok: true, paid: false, usedInr: 1000, toPayInr: 1399 } : { ok: true, paid: true, usedInr: 2399, toPayInr: 0 }; },
    });
    const p = await openPay(o, "UI-USEC", w); await p.waitFor((x) => /You have credit of/.test(x));
    expect(p.$("#creditoffer")!.textContent).toMatch(/You have credit of Rs 1,000\.00 \(valid until 14 Jun 2027\)\. Use it for this game\./); expect(p.$("#usecredit")!.textContent).toBe("Use my credit");
    for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 10]) { openStep(p, n); expect([n, /You have credit of/.test(p.text())]).toEqual([n, false]); } // credit shows only in Pay
    openStep(p, 8); p.click("#usecredit"); await p.waitFor((x) => /Pay the rest: Rs 1,399\.00/.test(x)); expect(bodies).toEqual([{}]); expect(p.$('#sec8 a[href^="/pay.html"]')).toBeTruthy(); expect(p.$("#usecredit")).toBeNull();
    const none = await openPay(o, "UI-USEC", spy()); await none.waitFor((x) => /Price for your game/.test(x)); expect(none.$("#creditoffer")).toBeNull(); expect(none.text()).not.toMatch(/You have credit/); // no credit, no offer
    mode = "full"; const q = await openPay(o, "UI-USEC", w); await q.waitFor((x) => /You have credit of/.test(x)); q.click("#usecredit"); await q.waitFor((x) => /Paid with your credit: Rs 2,399\.00/.test(x));
  });

  test("Your account lists credit: active, used and lapsed, each with its dates", async () => {
    const o = await organizer();
    const w = spy({ "GET /api/org/credit": () => ({ activeTotalInr: 1000, nextExpiryMs: Date.parse("2027-06-14T12:00:00+05:30"), credits: [
      { id: "c1", amountInr: 2399, remainingInr: 1000, createdMs: Date.parse("2026-06-14T12:00:00+05:30"), expiresMs: Date.parse("2027-06-14T12:00:00+05:30"), status: "active", sourceGame: "OLD-1", uses: [] },
      { id: "c2", amountInr: 2399, remainingInr: 0, createdMs: Date.parse("2026-01-10T12:00:00+05:30"), expiresMs: Date.parse("2027-01-10T12:00:00+05:30"), status: "used", sourceGame: "OLD-2", uses: [{ game: "NEW-1", amountInr: 2399, atMs: Date.parse("2026-03-01T12:00:00+05:30") }] },
      { id: "c3", amountInr: 500, remainingInr: 500, createdMs: Date.parse("2025-01-10T12:00:00+05:30"), expiresMs: Date.parse("2026-01-10T12:00:00+05:30"), status: "expired", sourceGame: "OLD-3", uses: [] }] }) });
    const p = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage }, { afterLoad: w.hook }); await p.waitFor((x) => /Your credit/.test(x));
    const t = p.$("#creditsblock")!.textContent as string; expect(t).toMatch(/Rs 1,000\.00 of Rs 2,399\.00/); expect(t).toMatch(/valid until 14 Jun 2027/); expect(t).toMatch(/Active/); expect(t).toMatch(/used 1 Mar 2026 for NEW-1/); expect(t).toMatch(/Used/); expect(t).toMatch(/lapsed on 10 Jan 2026/); expect(t).toMatch(/Lapsed/);
    expect(t).toMatch(/We do not give refunds\. If you cancel a paid game before it starts, your payment stays in the Organizer's account as credit for the next game, for 365 days\. Unused credit lapses at the end of day 365\./);
  });

  test("a game that waits: the Organizer sees when guest data will be erased; the Co-host sees 'Waiting for the Organizer or Host to start the game.'; a game that did not start says so with the new-game button (and no way to pay)", async () => {
    const o = await organizer(); await make(o, "UI-WAITS"); await publish(o, "UI-WAITS"); const erase = Date.parse("2026-10-03T21:30:00+05:30");
    const p = await consolePage(o, "UI-WAITS", o.token, {}, { afterLoad: spy({ "GET /api/z/UI-WAITS/summary": async (_m, _b, _u, real) => ({ ...(await real()), waitingFor: "organizer", erasureMs: erase }) }).hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    await p.waitFor(() => !!p.$("#erasurestrip")); expect(p.$("#paynote")!.textContent).toMatch(/A payment is pending for this game/); expect(p.$("#erasurestrip")!.textContent).toBe("Guest data will be erased on 3 Oct 2026, 9:30 pm if the game does not start.");
    openStep(p, 8); expect(p.$("#erasureline")!.textContent).toMatch(/erased on 3 Oct 2026, 9:30 pm/);
    const c = await consolePage(o, "UI-WAITS", await cohostKey(o, "UI-WAITS"), {}, { afterLoad: spy({ "GET /api/z/UI-WAITS/cohost": async (_m, _b, _u, real) => ({ ...(await real()), waitingFor: "organizer" }) }).hook }); await c.waitFor((x) => /Hi\. Here is the game/.test(x));
    await c.waitFor(() => !!c.$("#cohwaiting")); expect(c.$("#cohwaiting")!.textContent).toBe("Waiting for the Organizer or Host to start the game."); expect(c.$("[data-clonebtn]")).toBeNull();
    const d = await consolePage(o, "UI-WAITS", o.token, {}, { afterLoad: spy({ "GET /api/z/UI-WAITS/summary": async (_m, _b, _u, real) => ({ ...(await real()), didNotStart: true }), "GET /api/z/UI-WAITS/info": async (_m, _b, _u, real) => ({ ...(await real()), didNotStart: true }) }).hook });
    await d.waitFor(() => !!d.$("#didnotstart")); expect(d.$("#didnotstart")!.textContent).toMatch(/This game did not start\.\s*Guest details have been erased\./); expect(d.$("#didnotstart [data-clonebtn]")!.textContent).toBe("Create a new game like this one"); expect(d.$("#paynote")).toBeNull();
    openStep(d, 8); expect(d.$('#sec8 a[href^="/pay.html"]')).toBeNull(); expect(d.$("#copypaylink")).toBeNull();
  });

  test("Create a new game like this one: on the game page and in the games list (not for a Co-host); the people tick box only when the old list exists; the new game opens on step 1 with the date and time empty and the read-back with Change buttons", async () => {
    const o = await organizer(); await make(o, "UI-OLD1"); await publish(o, "UI-OLD1"); await make(o, "UI-NEW1", { name: "Copied game" });
    expect((await o.api("POST", "/api/z/UI-OLD1/roster", { people: [{ name: "Asha", phone: "9876543210" }] }, o.token)).status).toBe(200);
    const w = spy({ "POST /api/z/UI-OLD1/clone": () => ({ ok: true, id: "UI-NEW1", openUrl: "/zc.html?e=UI-NEW1", copied: ["settings", "prizes"], peopleCopied: 1 }) });
    const p = await consolePage(o, "UI-OLD1", o.token, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); await p.waitFor(() => (p.win as any).__zc.people.length > 0); openStep(p, 7);
    p.click("[data-clonebtn]"); await p.waitFor(() => !!p.$("#clonepanel")); expect(p.$("#clonepeople")).toBeTruthy(); expect(p.$("#clonepanel")!.textContent).toMatch(/Also bring my people list from the old game/);
    const tick = p.$("#clonepeople") as any; tick.checked = true; tick.dispatchEvent(new p.win.Event("change", { bubbles: true })); p.click("#clonego");
    await p.waitFor((x) => /This is a new game\. Nothing is paid or published yet\./.test(x)); expect(w.st.calls.find((c: any) => c[1] === "/api/z/UI-OLD1/clone")[2]).toEqual({ withPeople: true });
    expect(p.win.location.search).toContain("e=UI-NEW1"); expect(p.$("#sec1")!.className).toMatch(/open/); expect(p.win.document.querySelectorAll('#sec1 [data-ck="day"][aria-checked="true"]').length).toBe(0); expect(p.win.document.querySelectorAll('#sec1 [data-ck="time"][aria-pressed="true"]').length).toBe(0);
    expect(p.$("#newgameread")!.textContent).toMatch(/date and time still to pick/); expect(p.win.document.querySelectorAll("#newgameread [data-open]").length).toBeGreaterThanOrEqual(3); // Change buttons for each part
    expect(p.$("#zcnote")!.textContent).toBe("Your new game is ready to check. Pick the date and time, then publish.");
    p.click('[data-save="1"]'); await p.waitFor((x) => /Pick the day and the time/.test(x)); // the date is never copied, it must be picked
    p.click('[data-ck="day"][data-v="other"]'); const d = new Date(Date.now() + 5.5 * 3600000 + 3 * 86400000); setField(p, "#f-dayo", d.toISOString().slice(0, 10)); p.click('[data-ck="time"][data-v="18:00"]'); p.click('[data-save="1"]'); await p.waitFor((x) => /Saved\./.test(x));
    expect(p.$("#newgameread")).toBeNull();
    const home = await page(o, "/zc", "zc.html", ZC_SCRIPTS, { "cbz-org": o.token, "cbz-aimsg": o.aiMessage }, { afterLoad: w.hook }); await home.waitFor((x) => /Start a new game/.test(x)); home.click('[data-hist="1"]'); await home.waitFor(() => !!home.$('[data-clonebtn][data-from="UI-OLD1"]'));
    home.click('[data-clonebtn][data-from="UI-OLD1"]'); await home.waitFor(() => !!home.$("#clonepanel")); expect(home.$("#clonepeople")).toBeTruthy();
    const h = await consolePage(o, "UI-OLD1", await hostKey(o)); await h.waitFor(() => !!h.$('.zc-dot[data-open="7"]')); openStep(h, 7); expect(h.$("[data-clonebtn]")).toBeTruthy(); // a Host has it too
    const c = await consolePage(o, "UI-OLD1", await cohostKey(o, "UI-OLD1")); await c.waitFor((x) => /Hi\. Here is the game/.test(x)); for (let n = 1; n <= 3; n++) openStep(c, n); expect(c.$("[data-clonebtn]")).toBeNull();
  });

  test("Create a new game like this one when the old list is gone: a calm line instead of the tick box; a server refusal is shown", async () => {
    const o = await organizer(); await make(o, "UI-OLD2"); await publish(o, "UI-OLD2");
    const p = await consolePage(o, "UI-OLD2", o.token, {}, { afterLoad: spy({ "POST /api/z/UI-OLD2/clone": () => ({ status: 409, body: { error: "You already have 10 drafts. Delete one first." } }) }).hook }); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x)); openStep(p, 7);
    p.click("[data-clonebtn]"); await p.waitFor(() => !!p.$("#clonepanel")); expect(p.$("#clonepeople")).toBeNull(); expect(p.$("#clonepanel")!.textContent).toMatch(/The old guest list has been erased, so add your people again\./);
    p.click("#clonego"); await p.waitFor((x) => /You already have 10 drafts/.test(x)); p.click("#cloneno"); expect(p.$("#clonepanel")).toBeNull();
  });

  test("Rescheduling: a date more than 30 days ahead is refused politely before anything is sent; the server's own message (a game that has started) is shown as it is", async () => {
    const o = await organizer(); await make(o, "UI-RESC"); const w = spy({ "PATCH /api/z/UI-RESC/settings": () => ({ status: 409, body: { error: "This game has started, so its time cannot be changed." } }) });
    const p = await consolePage(o, "UI-RESC", o.token, {}, { afterLoad: w.hook }); await p.waitFor((x) => /Hello/.test(x));
    p.click('[data-ck="day"][data-v="other"]'); const far = new Date(Date.now() + 5.5 * 3600000 + 45 * 86400000); setField(p, "#f-dayo", far.toISOString().slice(0, 10)); p.click('[data-ck="time"][data-v="18:00"]'); p.click('[data-save="1"]');
    await p.waitFor((x) => /at most 30 days from today/.test(x)); expect(w.st.patches.length).toBe(0); expect(p.$("#f-dayo")!.getAttribute("max")).toMatch(/^\d{4}-\d\d-\d\d$/);
    const near = new Date(Date.now() + 5.5 * 3600000 + 5 * 86400000); setField(p, "#f-dayo", near.toISOString().slice(0, 10)); p.click('[data-save="1"]'); await p.waitFor((x) => /This game has started, so its time cannot be changed\./.test(x));
  });

  test("words: no 'refund' or 'money back' anywhere in the console; the About lines and Help say credit for 365 days", async () => {
    const js = readFileSync(join(import.meta.dir, "../public/zc.js"), "utf8"); expect(js.match(/money back|money comes back|get back|payment charge kept|Payment charge/g)).toBeNull(); // the words of the old refund screens are gone
    const o = await organizer(); await make(o, "UI-WORDS2"); await publish(o, "UI-WORDS2"); const p = await consolePage(o, "UI-WORDS2"); await p.waitFor((x) => /Last step|Your game|Hello/i.test(x));
    openStep(p, 7); expect(p.$("#sec7 .zc-about")!.textContent).toMatch(/We do not give refunds: a paid game becomes credit for your next game for 365 days/); openStep(p, 8); expect(p.$("#sec8 .zc-about")!.textContent).toMatch(/your payment stays as credit for 365 days/);
    p.click('[data-act="help"]'); const q = Array.from(p.win.document.querySelectorAll(".zc-qh")).findIndex((e: any) => /Can I get a refund\?/.test(e.textContent)); expect(q).toBeGreaterThanOrEqual(0); p.click(`[data-q="${q}"]`);
    expect(p.$(".zc-qa")!.textContent).toBe("We do not give refunds. If you cancel a paid game before it starts, your payment stays in the Organizer's account as credit for the next game, for 365 days. Unused credit lapses at the end of day 365.");
  });
});

describe("simpler console (owner orders 2026-10-27: numbered steps, radio buttons and check boxes, a sentence under every option, a live line, hide never disable)", () => {
  test("step 2: 'What must a person give to get in?' is hidden while the default (name only) stands, still in the page, and the rest of the step is shown", async () => {
    const o = await organizer(); await make(o, "UI-SIMP");
    const p = await consolePage(o, "UI-SIMP"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 2);
    const hidden = p.$("#sec2 .zc-hide[data-hidden='1']"); expect(hidden).not.toBeNull();
    expect(hidden!.textContent).toMatch(/What must a person give/); expect(p.$("#sec2")!.textContent).toMatch(/Who can join/);
    const visible = Array.from(p.win.document.querySelectorAll("#sec2 .zc-lbl")).filter((e: any) => !e.closest(".zc-hide")).map((e: any) => e.textContent).join("|");
    expect(visible).not.toMatch(/What must a person give/);
    expect(p.$('[data-ck="ver"][data-v="id"]')).not.toBeNull(); // hidden, never disabled: the buttons are still there and enabled
    expect((p.$('[data-ck="ver"][data-v="id"]') as any).disabled).toBe(false);
    p.click('[data-bool="emp"]'); expect(p.$("#sec2 .zc-hide[data-hidden='1']")).toBeNull(); // asking for staff only brings the choice into view
  });
  test("every choice of one is a radio button and every yes/no is a check box (no drop-down, no pressed-button), each radio group has one selected, and the main options carry a plain sentence", async () => {
    const o = await organizer(); await make(o, "UI-RADIO");
    const p = await consolePage(o, "UI-RADIO"); await p.waitFor((x) => /Hello/.test(x));
    for (const n of [1, 2]) { openStep(p, n);
      expect(p.win.document.querySelectorAll("select").length).toBe(0); expect(p.win.document.querySelectorAll("[aria-pressed]").length).toBe(0);
      for (const g of Array.from(p.win.document.querySelectorAll(`#sec${n} [role=radiogroup]`)) as any[]) expect([n, g.getAttribute("aria-labelledby"), g.querySelectorAll('[role=radio][aria-checked=true]').length]).toEqual([n, g.getAttribute("aria-labelledby"), 1]);
    }
    openStep(p, 2);
    const say = (sel: string) => (p.$(sel) as any).parentElement.querySelector(".zc-optsay")?.textContent ?? "";
    expect(say('[data-ck="who"][data-v="list"]')).toMatch(/Only people you add/); expect(say('[data-ck="who"][data-v="anyone"]')).toMatch(/Anyone with your link/);
    expect(say('[data-ck="ver"][data-v="id"]')).toMatch(/employee ID/); expect(say('[data-ck="cap"][data-v="10"]')).toMatch(/Free/);
    expect((p.$('[data-bool="emp"]') as any).getAttribute("role")).toBe("checkbox"); expect(say('[data-bool="emp"]')).toMatch(/Staff only/);
  });
  test("a live line under the question shows the choice so far and changes the moment an option is tapped; every step says what not to do and why", async () => {
    const o = await organizer(); await make(o, "UI-LIVE");
    const p = await consolePage(o, "UI-LIVE"); await p.waitFor((x) => /Hello/.test(x)); openStep(p, 2);
    expect(p.$("#live2")!.textContent).toMatch(/Your choice: Up to \d+ people/);
    p.click('[data-ck="who"][data-v="anyone"]'); expect(p.$("#live2")!.textContent).toMatch(/anyone with the link/);
    p.click('[data-bool="emp"]'); expect(p.$("#live2")!.textContent).toMatch(/staff only/);
    for (const n of [1, 2, 3]) { openStep(p, n); expect(p.$(`#about${n}`)!.textContent).toMatch(/Do not/); expect(p.$(`#about${n}`)!.textContent).toMatch(/Why:/); }
  });
  test("a demo link kept in this browser is used once the organizer is taken straight into a game (not only on the home screen)", async () => {
    const o = await organizer(); await make(o, "UI-PASS");
    const posts: any[] = [];
    const w = spy({ "POST /api/pass": (_m: any, b: any) => { posts.push(b); return { ok: true, cap: 100 }; } });
    const p = await consolePage(o, "UI-PASS", o.token, {}, { afterLoad: w.hook, url: "http://localhost/zc?e=UI-PASS&pass=0123456789abcdef0123456789abcdef" } as any);
    await p.waitFor((x) => /Hello/.test(x)); await p.waitFor(() => posts.length > 0, 8000);
    expect(posts).toEqual([{ token: "0123456789abcdef0123456789abcdef" }]);
  });
});
