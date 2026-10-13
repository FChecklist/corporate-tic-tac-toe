import { deflateSync } from "node:zlib";
// Shared kit of the UI scenario suite (tools/sim2/scenarios/ui): the scenario context `t`, console/guest/pay UI helpers and the fake Google script.
// Everything runs against the suite's OWN sim server (:8804) and WhatsApp simulator (:8891): run.mjs sets SIM_PORT / WA_PORT before this file is imported.
// Nothing here touches the live site: the harness blocks every non-localhost request in each browser context.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as H from "../../lib/index.mjs";

export { H };
export const SHOTS = join(H.ROOT, "test-results/sim-ui");
mkdirSync(SHOTS, { recursive: true });
export const WIDTHS = [360, 768, 1280, 1920];
const sleep = H.sleep;

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
  return t;
}

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
  await page.fill("#pubEmail", email); await page.fill("#pubPhone", phone); await page.click("#pubgo");
  await page.waitForSelector("#cancelopen", { timeout: 15000 });
}
/** the pay page as a person: fills name + e-mail, presses the (test) payment button and waits for the finished state */
export async function payOnPage(page, { name = "Sim Payer", email, org = "Sim Org Ltd", phone = "9811122233" } = {}) {
  await page.waitForSelector("#paygo", { timeout: 15000 });
  await page.fill("#nm", name); await page.fill("#em", email); if (await page.$("#org")) await page.fill("#org", org); if (await page.$("#ph")) await page.fill("#ph", phone);
  await page.click("#paygo");
}
export async function payStatus(org, eid) { return (await org.summary(eid)).body.payment?.status ?? "?"; }

// ---------------------------------------------------------------- guest helpers
export async function guestJoinUi(page, eid, phone, name) {
  await page.goto(`${H.SIM}/z?e=${eid}`); await page.waitForSelector("#ph"); await page.fill("#ph", phone); await page.fill("#nm", name); await page.click("#go");
}
export const guestText = async (page) => (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ");

/** a guest joined by token or by number through the API; returns the response */
export const joinApi = (eid, phone, name, extra = {}, ip) => H.call("POST", `/api/z/${eid}/join`, { phone, name, device: H.deviceOf(phone), ...extra }, {}, { ip: ip ?? nextIp() });

// ---------------------------------------------------------------- fake Google (the real script is blocked in every context)
/** Replaces Google's script in this context by a tiny stand-in: its button is #fakegoogle and signs in as `email` with a token the sim server signed with the fake key set. */
export async function fakeGoogle(ctx, email) {
  const g = await (await fetch(`${H.SIM}/__sim/google-token?email=${encodeURIComponent(email)}`)).json();
  const js = `window.google={accounts:{id:{initialize:function(o){window.__gcb=o.callback;},renderButton:function(el){var b=document.createElement('button');b.type='button';b.id='fakegoogle';b.textContent='Continue with Google (sim)';b.onclick=function(){window.__gcb({credential:${JSON.stringify(g.credential)}});};el.appendChild(b);}}}};`;
  await ctx.route(/^https:\/\/accounts\.google\.com\/gsi\/client/, (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: js }));
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
