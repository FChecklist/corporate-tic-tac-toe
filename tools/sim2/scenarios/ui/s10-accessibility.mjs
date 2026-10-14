// Group 10: accessibility of the five main pages (R10, K13, P6), in real Chrome.
//   S10-01 / S10-02  axe-core (the open-source accessibility engine; a dev dependency of the simulation only, never shipped to a user) on the home page, pricing, the host / console sign-in,
//                    the player page and the big screen, at phone and at laptop width: colour contrast and the basic WCAG 2 A / AA rules (labels, names, alt text, language, titles ...). Zero violations.
//   S10-03           the keyboard: Tab reaches every button, link and field of those pages, in the order they appear on the page, and the place you are at is visibly marked.
//   S10-04           the Privacy page carries an Accessibility statement with a way to report a problem.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { H } from "./kit.mjs";

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/** Findings we know about and have not fixed yet: [page label, axe rule id, why]. Listed in the report; anything else fails the scenario. Keep this list EMPTY if you can. */
export const KNOWN_OPEN = [];

export const pagesOf = (gameId) => [["home", "/"], ["pricing", "/pricing.html"], ["host sign-in", "/signin.html"], ["player page", `/z?e=${gameId}`], ["big screen", `/big.html?e=${gameId}`]];

async function axeRun(page) {
  await page.evaluate(AXE); // evaluated through the browser's debugging channel, so the page's own script rules do not apply to it
  return page.evaluate(async (tags) => {
    const res = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations", "incomplete"] });
    return {
      violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target.join(" ").slice(0, 120), why: String(n.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 200) })), count: v.nodes.length })),
      incomplete: res.incomplete.map((v) => v.id + ":" + v.nodes.length),
    };
  }, TAGS);
}

async function axePass(t, x, vw) {
  const org = await t.org("a11y");
  const g = await t.game(org, { pay: true });
  let total = 0;
  for (const [label, url] of pagesOf(g.id)) {
    await x.page.goto(H.SIM + url, { waitUntil: "domcontentloaded" }).catch(() => {});
    await x.page.waitForTimeout(1200);
    const r = await axeRun(x.page);
    const open = r.violations.filter((v) => !KNOWN_OPEN.some(([p, rule]) => p === label && rule === v.id));
    total += open.length;
    await t.shot(x.page, `axe-${label.replace(/\W+/g, "_")}-${vw}`);
    t.check(`${label} at ${vw} px: no accessibility violations (WCAG 2 A/AA, contrast and basic rules)`, open.length === 0, open.map((v) => `${v.id} x${v.count} [${v.nodes.map((n) => n.target).slice(0, 3).join(" | ")}] ${v.nodes[0]?.why ?? ""}`).join(" ;; ").slice(0, 380));
    if (r.incomplete.length) t.note(`${label} ${vw}px: axe could not decide: ${r.incomplete.join(", ")}`);
    for (const k of KNOWN_OPEN.filter(([p]) => p === label)) t.note(`known open: ${label}: ${k[1]}: ${k[2]}`);
  }
  return total;
}

/** Tab through the page: which controls get focus, in which order, and is the focus visible? */
async function keyboardAudit(page) {
  const n = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[hidden],[inert]") && !el.closest("dialog:not([open])"); };
    const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex],[contenteditable="true"]';
    window.__axEls = [...document.querySelectorAll(sel)].filter((el) => !el.disabled && el.getAttribute("tabindex") !== "-1" && el.getAttribute("aria-hidden") !== "true" && vis(el) && !el.closest("details:not([open]) > :not(summary)"));
    window.__axEls.forEach((el) => (el.scrollIntoView ? 0 : 0));
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
    window.scrollTo(0, 0);
    return window.__axEls.length;
  });
  const seen = new Map(), order = [], noRing = [];
  for (let i = 0; i < n + 6; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const el = document.activeElement, i = window.__axEls.indexOf(el);
      if (!el || el === document.body) return { i: -2 };
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
      return { i, ring, name: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "") };
    });
    if (f.i >= 0) {
      if (seen.has(f.i)) break; // wrapped round to the start: the whole page has been visited
      seen.set(f.i, f); order.push(f.i);
      if (!f.ring) noRing.push(f.name);
    } else if (f.i === -1) { order.push(-1); } // focus went to something we did not list (a custom control): counted below as out of order only when it breaks the sequence
  }
  const listed = order.filter((i) => i >= 0);
  const unreachable = await page.evaluate((reached) => window.__axEls.map((el, i) => [i, el]).filter(([i]) => !reached.includes(i)).map(([, el]) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.textContent ? ` "${el.textContent.trim().slice(0, 24)}"` : "")), listed);
  const outOfOrder = listed.filter((v, k) => k > 0 && v < listed[k - 1]);
  return { n, reached: listed.length, unreachable, outOfOrder: outOfOrder.length, noRing };
}

export default [
  { id: "S10-01", name: "Accessibility (axe-core, WCAG 2 A/AA incl. colour contrast) on the home page, pricing, host sign-in, player page and big screen at phone width",
    async run(t) { const x = await t.open({ device: "mobile" }); await axePass(t, x, 390); } },
  { id: "S10-02", name: "Accessibility (axe-core, WCAG 2 A/AA incl. colour contrast) on the same five pages at laptop width",
    async run(t) { const x = await t.open({ device: "laptop" }); await axePass(t, x, 1280); } },
  { id: "S10-03", name: "Keyboard: Tab reaches every control of the five main pages in page order, and the place you are at is marked",
    async run(t) {
      const org = await t.org("kb");
      const g = await t.game(org, { pay: true });
      const x = await t.open({ device: "laptop" });
      for (const [label, url] of pagesOf(g.id)) {
        await x.page.goto(H.SIM + url, { waitUntil: "domcontentloaded" }).catch(() => {}); await x.page.waitForTimeout(1200);
        const a = await keyboardAudit(x.page);
        t.note(`${label}: ${a.reached} of ${a.n} controls reached by Tab`);
        t.check(`${label}: Tab reaches every button, link and field (${a.reached} of ${a.n})`, a.unreachable.length === 0, a.unreachable.slice(0, 6).join(" ; "));
        t.check(`${label}: the focus moves down the page in order`, a.outOfOrder === 0, `${a.outOfOrder} jumps back`);
        t.check(`${label}: the control you are on is visibly marked`, a.noRing.length === 0, a.noRing.slice(0, 6).join(" ; "));
      }
    } },
  { id: "S10-04", name: "The Privacy page has an Accessibility statement with a way to report a problem",
    async run(t) {
      const x = await t.open({ device: "laptop" });
      await x.page.goto(H.SIM + "/legal.html#accessibility", { waitUntil: "domcontentloaded" }); await x.page.waitForTimeout(500);
      const txt = await t.text(x.page, "#accessibility");
      t.check("an Accessibility section exists", txt.length > 100, txt.slice(0, 80));
      t.check("it says the pages work with the keyboard, mentions contrast and labels", /keyboard/i.test(txt) && /contrast/i.test(txt) && /label/i.test(txt), txt.slice(0, 200));
      t.check("it says where to report a problem", /@/.test(txt) || (await x.page.locator('#accessibility a[href^="mailto:"]').count()) > 0, "");
    } },
];
