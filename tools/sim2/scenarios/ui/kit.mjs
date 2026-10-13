import { deflateSync } from "node:zlib";
// Shared kit of the UI scenario suite (tools/sim2/scenarios/ui): the scenario context `t`, console/guest/pay UI helpers and the fake Google script.
// Everything runs against the suite's OWN sim server (:8804) and WhatsApp simulator (:8891): run.mjs sets SIM_PORT / WA_PORT before this file is imported.
// Nothing here touches the live site: the harness blocks every non-localhost request in each browser context.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as H from "../../lib/index.mjs";

export { H };
export const SHOTS = join(H.ROOT, "test-results/sim-ui");
mkdirSync(SHOTS, { recursive: true });
export const WIDTHS = [360, 768, 1280, 1920];
const sleep = H.sleep;

let CUR = null; // the context of the scenario that is running now (the runner runs one scenario at a time); lets the helpers below record their checks in it
let ipSeq = 0, mailSeq = 0;
/** a fresh simulated network address for each caller (per-address limits behave per phone) */
export const nextIp = () => { ipSeq++; return `10.${40 + (ipSeq >> 16 & 15)}.${ipSeq >> 8 & 255}.${ipSeq & 255 || 1}`; };
export const nextMail = (tag = "u") => `sim+${tag}${Date.now().toString(36)}${(mailSeq++).toString(36)}@example.com`;
let phoneSeq = 0;
/** a fresh valid Indian mobile number (starts with 9, unique per call) */
export const nextPhone = () => "9" + String(300000000 + (Date.now() % 1000000) * 100 + (phoneSeq++ % 100)).slice(-9);

/** the scenario context handed to each scenario's run(t) */
export function makeT(sc, shared) {
  const t = {
    id: sc.id, name: sc.name, H, shared, checks: [], notes: [], pages: [], team: (shared.allTeam ??= new Set()), /* every Organizer and Host address of this run: a mail from an earlier scenario's game still goes to ITS Organizer */ shots: [],
    check(name, ok, detail = "") { t.checks.push({ name, ok: !!ok, detail: String(detail ?? "").slice(0, 400) }); return !!ok; },
    note(msg) { t.notes.push(String(msg).slice(0, 300)); },
    ip: nextIp, mail: nextMail, phone: nextPhone,
    /** every mail sent since this scenario started */
    async mails() { return (await H.mailbox.list()).slice(t.mailBase ?? 0); },
    /** opens a tracked browser context (closed by the runner); same options as the harness `open` */
    async open(o = {}) {
      await shared.track.refresh();
      const x = await shared.open({ ip: nextIp(), ...o });
      x.label = o.label ?? `${o.device ?? "mobile"}${t.pages.length + 1}`; t.pages.push(x);
      return x;
    },
    /** a new Organizer (API sign-up) with a unique plus-address; returns the H.Organizer plus `.email`, `.ip` */
    async org(tag = "org") {
      const email = nextMail(tag), ip = nextIp();
      const o = await H.Organizer.signUp(email, { ip }); o.ip = ip; t.team.add(email.toLowerCase()); return o;
    },
    /** a published game (optionally paid). cfg goes to POST /api/z; settings patch is applied before publishing */
    async game(org, { lead = 3 * H.HOUR, cfg = {}, settings, publish = true, pay = false } = {}) {
      const g = await org.createGame({ leadMs: lead, cfg });
      if (settings) { const r = await org.settings(g.id, settings); if (!r.ok) throw new Error("settings " + JSON.stringify(r.body)); }
      if (publish) { const r = await org.publish(g.id); if (!r.ok) throw new Error("publish " + JSON.stringify(r.body)); }
      if (pay) { const r = await org.pay(g.id); if (!r.ok) throw new Error("pay " + JSON.stringify(r.body)); }
      return g;
    },
    async shot(page, name) { const f = join(SHOTS, `${t.id}-${name}`.replace(/[^\w.-]+/g, "_") + ".png"); await page.screenshot({ path: f }).catch(() => {}); t.shots.push(f); return f; },
    /** gets a text of the page body, one line */
    async text(page, sel = "body") { return (await page.innerText(sel).catch(() => "")).replace(/\s+/g, " ").trim(); },
    /** polls fn until truthy */
    async until(fn, { timeout = 8000, step = 150, what = "condition" } = {}) { const t0 = Date.now(); let last; while (Date.now() - t0 < timeout) { try { last = await fn(); if (last) return last; } catch { /* retry */ } await sleep(step); } throw new Error(`timeout waiting for ${what}`); },
  };
  CUR = t;
  return t;
}

// ---------------------------------------------------------------- Terms boxes (server-enforced since 2026-10-13)
const CONSENT = JSON.parse(readFileSync(join(H.ROOT, "apps/edge/src/consent-text.json"), "utf8"));
/** every box wording the server can show (kinds K1..K9, boxes A/B), to compare what a person reads on the page with the one source file */
export const CONSENT_WORDS = new Set(Object.values(CONSENT).filter((v) => v && typeof v === "object").flatMap((k) => Object.values(k)));
/**
 * Ticks the Terms boxes on the screen like a person would. `scope` = CSS selector of the area that holds them (default: the whole page; give one when two sets are on the page),
 * `btn` = selector of the button that must stay disabled until every box is ticked.
 * Checks (recorded in t): the boxes are not ticked in advance, the button is disabled before and enabled after, the words are the server's own wording.
 * Returns { labels, count }.
 */
export async function tickTerms(t, page, { btn, scope = "body", what = "Terms boxes", only, enabledAfter = true } = {}) {
  const sel = `${scope} input[data-box]`;
  await page.waitForSelector(sel, { state: "visible", timeout: 10000 });
  const boxes = page.locator(sel); const n = await boxes.count();
  const labels = [], pre = [];
  for (let i = 0; i < n; i++) {
    const b = boxes.nth(i); if (only && !only.includes(await b.getAttribute("data-box"))) continue;
    const id = await b.getAttribute("id"); labels.push((await page.locator(`label[for="${id}"]`).innerText().catch(() => "")).replace(/\s+/g, " ").trim()); pre.push(await b.isChecked());
  }
  t.check(`${what}: no box is ticked in advance`, pre.length > 0 && pre.every((x) => !x), JSON.stringify(pre));
  t.check(`${what}: the words are the server's own wording`, labels.length > 0 && labels.every((l) => CONSENT_WORDS.has(l)), labels.join(" | ").slice(0, 200));
  if (btn) t.check(`${what}: the button is disabled until every box is ticked`, await page.locator(btn).first().isDisabled(), btn);
  for (let i = 0; i < n; i++) {
    const b = boxes.nth(i); if (only && !only.includes(await b.getAttribute("data-box"))) continue;
    if (await b.isChecked()) continue;
    // tap the words at their left edge (the way a person taps the line; the links sit further right), fall back to the box itself
    await page.locator(`label[for="${await b.getAttribute("id")}"]`).click({ position: { x: 4, y: 4 }, timeout: 3000 }).catch(() => {});
    if (!(await b.isChecked())) await b.check({ force: true, timeout: 3000 }).catch(() => {});
  }
  const all = []; for (let i = 0; i < n; i++) all.push(await boxes.nth(i).isChecked());
  t.check(`${what}: every box can be ticked`, all.every(Boolean), JSON.stringify(all));
  if (btn && enabledAfter) { await page.waitForTimeout(80); t.check(`${what}: the button is enabled once every box is ticked`, !(await page.locator(btn).first().isDisabled()), btn); }
  return { labels, count: n };
}

/** Ticks the boxes when this screen shows any (some screens of this game ask nothing); returns whether it found boxes. */
export async function tickIfAny(t, page, opts) {
  const found = await page.waitForSelector(`${opts.scope || "body"} input[data-box]`, { state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
  if (found) await tickTerms(t, page, opts);
  return found;
}
/** The sign-in code step has its own Terms box (K2) in this game: tick it once, before "Sign in". */
export async function tickCode(page) {
  if (await page.locator(".tb input[data-box]:not(:checked)").count()) await tickIfAny(CUR, page, { scope: ".tb", btn: "#cdGo", what: "Sign-in code" });
}
/** The home-page sign-in sheet as a person: e-mail, the Terms box (K2), "Email me a code". Waits for the code box. */
export async function askCodeUi(page, email) {
  await page.goto(H.SIM + "/#login"); await page.fill("#lMail", email);
  await tickIfAny(CUR, page, { scope: ".tb", btn: "#lgGo", what: "Sign-in" }); await page.click("#lgGo"); await page.waitForSelector("#lCode");
}
/** A Host or Co-host who opened the console for the first time on this device meets ONE box (K5) before anything else: ticks it and carries on. No-op when the console opens straight away. */
export async function passK5Gate(page, { timeout = 15000 } = {}) {
  await page.waitForSelector(".zc-sech, #k5gate, #mk, #finishsetup", { timeout: Math.min(timeout, 9000) }).catch(() => {});
  if (await page.$("#k5gate")) {
    await tickTerms(CUR, page, { scope: "#k5gate", btn: "#k5go", what: "Role box (K5)" });
    await page.click("#k5go"); await page.waitForSelector(".zc-sech, #mk, .zc-block:not(#k5gate)", { timeout }); await page.waitForTimeout(600);
  }
}
/** The API way of the same K5 acceptance for a Co-host key (what the one-time box does when ticked). */
export const acceptRole = (key) => H.call("POST", "/api/org/role/accept", {}, { "x-organizer": key });
/** Host first-open, e-mail step: the box (K5) first, then "Send me a code". */
export async function setupSendUi(page, email) {
  await page.fill("#setupemail", email);
  await tickTerms(CUR, page, { scope: "#finishsetup", btn: "#setupsend", what: "Host setup (K5)" }); await page.click("#setupsend"); await page.waitForSelector("#setupcode");
}
/** Ticks, without recording checks, every box still open on the screen (a screen that may or may not still ask). */
export async function tickRest(page) {
  for (const b of await page.locator(".tb input[data-box]:not(:checked)").all()) await b.check({ force: true }).catch(() => {});
}
/** In this game the Host meets the role box (K5) as its own step ("Accept"): ticks it and presses the button when it is on the screen. */
export async function acceptHostRole() { return false; } // here the Host's box (K5) sits on the e-mail step itself (setupSendUi ticks it)

// ---------------------------------------------------------------- console helpers
export async function openConsole(t, org, eid, { device = "laptop", token, w, h, label } = {}) {
  const x = await t.open({ device, token: token ?? org.token, w, h, label });
  await x.page.goto(H.SIM + "/zc" + (eid ? "?e=" + eid : ""));
  await x.page.waitForSelector(eid ? ".zc-sech" : "#mk", { timeout: 15000 });
  return x;
}
/** the people block of step 6 (My people): opens the step and waits until the list has loaded */
export async function openPeople(page) {
  await openStep(page, 6); await page.waitForSelector("#sec6 #gcount", { timeout: 10000 }); await page.waitForTimeout(300);
  await tickGuestList(page);
}
/** Step 6, "My people": ticks the guest-list box (K6: "I am allowed to use these names and numbers ... The people have been told"); until it is ticked the Add / Paste / Upload buttons stay disabled. */
export async function tickGuestList(page) {
  await tickTerms(CUR, page, { scope: ".tb", btn: "#gadd, #rosterGo, #gcontacts, #gfile", what: "Guest list" });
}
/** presses SEND on the WhatsApp simulator page (waits for the page script, retries: the harness' pressSend can click before the handler is attached) */
export async function waSend(wp) {
  await wp.waitForLoadState("load"); await wp.waitForSelector("#send"); await wp.waitForTimeout(250);
  for (let i = 0; i < 3; i++) { await wp.click("#send"); try { await wp.waitForFunction(() => document.body.dataset.sent === "1", null, { timeout: 2500 }); return; } catch { /* click again */ } }
  throw new Error("SEND on the WhatsApp simulator did not go through");
}
/** clicks an element that opens WhatsApp in a new tab and presses SEND there (own version: the harness one looks for port 8890 in same-tab navigations) */
export async function clickWa(page, locator, { send = true } = {}) {
  const pp = page.context().waitForEvent("page", { timeout: 8000 }).catch(() => null);
  await locator.click(); const wp = await pp; if (!wp) throw new Error("clicking did not open a WhatsApp tab");
  await wp.waitForLoadState("domcontentloaded"); if (send) await waSend(wp); return wp;
}
/** the Co-host link as the console itself builds it (the API's own link has no game id and lands on a dead-end page, see SIM_GAPS_ui) */
export const cohostUrl = (eid, c) => `${H.SIM}/zc?e=${eid}#cohost=${c.cohostKey}`;
export async function openStep(page, n) {
  const sec = page.locator(`#sec${n}`);
  if (!(await sec.getAttribute("class").catch(() => ""))?.includes("open")) { await page.click(`.zc-sech[data-open="${n}"]`); }
  await page.waitForSelector(`#sec${n}.open`, { timeout: 6000 });
  return sec;
}
export const chip = (page, ck, v) => page.click(`[data-ck="${ck}"][data-v="${v}"]`);
export const chipOn = async (page, ck, v) => (await page.getAttribute(`[data-ck="${ck}"][data-v="${v}"]`, "class"))?.includes("on");
export async function saveStep(page, n) { await page.click(`#sec${n} [data-save="${n}"]`); await page.waitForTimeout(700); }
export async function uiPublish(page, email, phone = "9811122233") {
  await openStep(page, 7);
  await page.click("#publishopen"); await page.waitForSelector("#pubEmail");
  await page.fill("#pubEmail", email); await page.fill("#pubPhone", phone);
  await tickTerms(CUR, page, { scope: ".tb", btn: "#pubgo", what: "Publish" }); // K1: both boxes
  await page.click("#pubgo");
  await page.waitForSelector("#cancelopen", { timeout: 15000 });
}
/** the pay page as a person: fills name + e-mail, presses the (test) payment button and waits for the finished state */
export async function payOnPage(page, { name = "Sim Payer", email, org = "Sim Org Ltd", phone = "9811122233" } = {}) {
  await page.waitForSelector("#paygo", { timeout: 15000 });
  await page.fill("#nm", name); await page.fill("#em", email); if (await page.$("#org")) await page.fill("#org", org); if (await page.$("#ph")) await page.fill("#ph", phone);
  await tickTerms(CUR, page, { scope: ".tb", btn: "#paygo", what: "Pay" }); // K3
  await page.click("#paygo");
}
export async function payStatus(org, eid) { return (await org.summary(eid)).body.payment?.status ?? "?"; }

// ---------------------------------------------------------------- guest helpers
/** The join form as a person meets it: the Terms boxes (K4) first, the name field opens only after they are ticked, the Join button after a name is typed. The page must already be at /z?e=<game>. */
export async function joinForm(page, phone, name) {
  await page.waitForSelector(".tb input[data-box]", { timeout: 15000 });
  await tickTerms(CUR, page, { scope: ".tb", btn: "#go", what: "Join", enabledAfter: false }); // K4: both boxes; the name field opens after them and Join after a name is typed
  CUR.check("Join: the name field opens once the boxes are ticked", !(await page.locator("#nm").isDisabled()), "");
  if (await page.$("#nm")) await page.fill("#nm", name);
  CUR.check("Join: the button is enabled once the boxes are ticked and a name is typed", !(await page.locator("#go").isDisabled()), "");
  await page.click("#go");
}
/** The page a guest meets from a personal link: the boxes (K4), a nickname (taken from the list if the page offers one, else `name`), then Join. */
export async function joinFromLink(page, name = "Link Guest") {
  await page.waitForSelector("#go", { timeout: 12000 }).catch(() => {});
  if (await page.$(".tb input[data-box]")) await tickTerms(CUR, page, { scope: ".tb", btn: "#go", what: "Join (personal link)", enabledAfter: false });
  if ((await page.$("#nm")) && !(await page.inputValue("#nm"))) await page.fill("#nm", name);
  const b = await page.$("#go"); if (b) { await b.click(); await page.waitForTimeout(3000); }
}
export async function guestJoinUi(page, eid, phone, name) {
  await page.goto(`${H.SIM}/z?e=${eid}`); await joinForm(page, phone, name);
}
export const guestText = async (page) => (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ");

// ---------------------------------------------------------------- the tournament (host.html, z.html boards)
/** The Organizer's (or a Host's) tournament page for a game, opened with the role key; confirm() questions are answered "OK" like a person would. */
export async function openHostPage(t, token, eid, { device = "laptop", label } = {}) {
  const x = await t.open({ device, token, label: label ?? "host-page" });
  x.page.on("dialog", (d) => d.accept().catch(() => {}));
  await x.page.goto(`${H.SIM}/host.html?e=${eid}`); await x.page.waitForSelector(".zhead", { timeout: 15000 });
  return x;
}
/** On the tournament page: picks the format / team size / move clock by tapping the chips and presses Start; waits until the page says Running. */
export async function startTournament(h, { format = "solo", teamSize, moveSecs = 10 } = {}) {
  const page = h.page;
  await page.click(`.hchip[data-k="format"][data-v="${format}"]`);
  if (format === "team" && teamSize) await page.click(`.hchip[data-k="teamSize"][data-v="${teamSize}"]`);
  await page.click(`.hchip[data-k="moveSecs"][data-v="${moveSecs}"]`);
  await page.click("#start");
  await page.waitForFunction(() => /Running|Finished/i.test(document.body.innerText) || document.querySelector(".zbanner"), null, { timeout: 15000 })
    .catch(async () => { throw new Error("the tournament page did not move on after Start: " + (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 300)); });
}
/** The state of one player's page: waiting | playing | champion | out | over | watching | other */
export async function pState(p) {
  const tx = (await p.page.innerText("body").catch(() => "")).replace(/\s+/g, " ");
  if (/You are the champion/i.test(tx)) return "champion";
  if (await p.page.$(".tboard")) return "playing";
  if (/The tournament is over/i.test(tx)) return "over";
  if (/You are out|You went out/i.test(tx)) return "out";
  if (/Waiting for the host to start|You are in/i.test(tx)) return "waiting";
  if (/only want to watch|can watch|Watching/i.test(tx)) return "watching";
  return "other";
}
/** taps one free square when it is this player's turn (the page enables only the free squares then). mode "first" = the lowest free square, "mid" = centre first, "rand" = any. Returns the square or -1. */
export async function tapOnce(p, mode = "mid") {
  const free = await p.page.$$eval(".tsq:not([disabled])", (els) => els.map((e) => Number(e.dataset.i))).catch(() => []);
  if (!free.length) return -1;
  const sq = mode === "first" ? free[0] : mode === "mid" ? (free.includes(4) ? 4 : free[0]) : free[Math.floor(Math.random() * free.length)];
  await p.page.click(`.tsq[data-i="${sq}"]`, { timeout: 2000 }).catch(() => {});
  return sq;
}
/** Plays every given phone (taps whenever it is their turn) until the server says the tournament is done and each phone has reached a closing screen, or `timeout` ms pass. Returns { done, seconds, taps }. */
export async function playOut(t, phones, eid, { timeout = 200000, modes = [] } = {}) {
  const t0 = Date.now(); let taps = 0, done = false;
  while (Date.now() - t0 < timeout) {
    for (const [i, p] of phones.entries()) { if ((await tapOnce(p, modes[i] ?? (i % 2 ? "rand" : "mid"))) >= 0) taps++; }
    done = (await H.sql("SELECT state FROM ttt_t WHERE eid=?", [eid]))[0]?.state === "done";
    if (done) { const st = await Promise.all(phones.map(pState)); if (st.every((s) => ["champion", "out", "over", "watching"].includes(s))) break; }
    await sleep(350);
  }
  return { done, seconds: Math.round((Date.now() - t0) / 100) / 10, taps };
}

/** a guest joined by token or by number through the API; returns the response */
export const joinApi = (eid, phone, name, extra = {}, ip) => H.call("POST", `/api/z/${eid}/join`, { phone, name, device: H.deviceOf(phone), ...extra }, {}, { ip: ip ?? nextIp() });

// ---------------------------------------------------------------- fake Google (the real script is blocked in every context)
/** Replaces Google's script in this context by a tiny stand-in: its button is #fakegoogle and signs in as `email` with a token the sim server signed with the fake key set. */
export async function fakeGoogle(ctx, email) {
  const g = await (await fetch(`${H.SIM}/__sim/google-token?email=${encodeURIComponent(email)}`)).json();
  const js = `window.google={accounts:{id:{initialize:function(o){window.__gcb=o.callback;},renderButton:function(el){var b=document.createElement('button');b.type='button';b.id='fakegoogle';b.textContent='Continue with Google (sim)';b.onclick=function(){window.__gcb({credential:${JSON.stringify(g.credential)}});};el.appendChild(b);}}}};`;
  await ctx.route(/^https:\/\/accounts\.google\.com\/gsi\/client/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: js }));
}

// ---------------------------------------------------------------- tap targets
/** Visible buttons, fields, chips and tick boxes (their label) smaller than `min` px in width or height: ["button#go=120x32", ...]. Plain links inside a sentence are not counted. */
export async function smallTargets(page, min = 40) {
  return page.evaluate((min) => {
    const out = [];
    const vis = (el) => { const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0 && !el.closest("[hidden]"); };
    const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "");
    for (const el of document.querySelectorAll("button, input:not([type=hidden]):not([type=checkbox]):not([type=file]), textarea, [role=button], a.zbtn, a.zc-chip, a.zc-btn, a.btn, a.cta")) {
      if (!vis(el)) continue; const r = el.getBoundingClientRect();
      const need = el.closest(".tdots") ? 24 : min; // the three colour dots are small on purpose: 24 px is the smallest target WCAG 2.2 level AA accepts
      if (Math.min(r.width, r.height) < need) out.push(name(el) + "=" + Math.round(r.width) + "x" + Math.round(r.height));
    }
    for (const el of document.querySelectorAll("input[type=checkbox]")) {
      const l = (el.id && document.querySelector('label[for="' + el.id + '"]')) || el.closest("label"); const r = (l || el).getBoundingClientRect();
      if (vis(el) && Math.min(r.width, r.height) < min) out.push("checkbox=" + Math.round(r.width) + "x" + Math.round(r.height));
    }
    return [...new Set(out)].slice(0, 10);
  }, min);
}

// ---------------------------------------------------------------- layout sweep
/** visits `url` at each width, measures overflow / small text, screenshots; returns [{w, overflowX, scrollWidth, smallText, wide, errors}] */
export async function sweep(t, x, url, label, { widths = WIDTHS, minPx = 12, wait = 900, after } = {}) {
  const out = [];
  for (const w of widths) {
    await x.page.setViewportSize({ width: w, height: w < 700 ? 800 : 900 });
    x.mon.clear();
    await x.page.goto(H.SIM + url, { waitUntil: "domcontentloaded" }); await x.page.waitForTimeout(wait);
    if (after) await after(x.page, w);
    const m = await H.measure(x.page, { minPx });
    await t.shot(x.page, `${label}-${w}`);
    out.push({ w, overflowX: m.overflowX, scrollWidth: m.scrollWidth, smallText: m.smallText, wide: m.wideElements, errors: x.mon.count(), err: [...x.mon.pageErrors, ...x.mon.console.filter((c) => !/Failed to load resource/.test(c))].slice(0, 2) });
  }
  return out;
}

/** a tiny valid PNG (1x1 transparent) written to a temp file for logo uploads */
import { writeFileSync } from "node:fs";
/** A real PNG picture of w x h pixels (a green square with a white ring), written without any library. 256 x 256 by default: a normal logo upload. */
export function tinyPng(name = "logo.png", w = 256, h = 256) {
  const f = join(SHOTS, name);
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const d = Math.hypot(x - w / 2, y - h / 2), ring = d > Math.min(w, h) * 0.3 && d < Math.min(w, h) * 0.4, o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = ring ? 255 : 27; raw[o + 1] = ring ? 255 : 127; raw[o + 2] = ring ? 255 : 92; } }
  writeFileSync(f, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  return f;
}
