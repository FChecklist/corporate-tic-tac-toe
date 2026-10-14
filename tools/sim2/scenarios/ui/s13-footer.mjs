// Group 13: the uniform footer (games-ops/footer/ufooter.py, class "uf") on the public pages, in real Chrome, on the BUILT pages (pages/public, served the way Cloudflare Pages serves them).
//   S13-01  at 360 px: exactly one footer on the page, in the footer's own bright colours (the page's own styles do not repaint it), the seller line, the Rs 1 payment test link, every link of the footer
//           that points into this site answers 200 (the build ships the target), no sideways scroll, no old dark footer left.
import { H } from "./kit.mjs";

const PAGES = ["/", "/terms.html", "/privacy.html", "/legal.html", "/pricing.html", "/about.html", "/contact.html", "/dpa.html", "/subprocessors.html", "/refund-policy.html", "/organizer-guide.html", "/partner-terms.html", "/legal-position.html"];

export default [
  {
    id: "S13-01", name: "The uniform footer on the built public pages at 360 px: one footer, its own bright colours, seller line, payment-test link, every link into this site answers 200, no sideways scroll",
    async run(t) {
      const x = await t.open({ device: "mobile", w: 360, h: 800 });
      const hrefs = new Set();
      for (const path of PAGES) {
        await x.page.goto(H.SIM + path, { waitUntil: "domcontentloaded" });
        await x.page.waitForSelector("footer.uf", { timeout: 8000 }).catch(() => {});
        if (path === "/privacy.html") await t.shot(x.page, "privacy-top"); // the stand-alone notice as a phone shows it first
        const info = await x.page.evaluate(() => {
          const f = document.querySelectorAll("footer.uf"), all = document.querySelectorAll("footer");
          const lum = (c) => { const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(c); if (!m) return null; if (m[4] !== undefined && Number(m[4]) === 0) return null; const [r, g, b] = [m[1], m[2], m[3]].map((v) => { const s = Number(v) / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          const el = f[0]; if (!el) return { count: f.length, footers: all.length };
          const cs = getComputedStyle(el), r = el.getBoundingClientRect();
          const darkBg = [el, ...el.querySelectorAll("*")].filter((e) => { const l = lum(getComputedStyle(e).backgroundColor); return l !== null && l < 0.12; }).map((e) => e.tagName + "." + e.className);
          return {
            count: f.length, footers: all.length, bg: cs.backgroundColor, display: cs.display, borderTop: cs.borderTopColor,
            text: el.innerText.replace(/\s+/g, " "), left: r.left, right: r.right, iw: innerWidth, sw: document.documentElement.scrollWidth, darkBg,
            links: [...el.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
            oldFoot: document.querySelectorAll(".foot").length,
            smallLinks: [...el.querySelectorAll("a")].filter((a) => a.getBoundingClientRect().height < 24).length,
          };
        });
        t.check(`${path}: exactly one footer, and it is the uniform one`, info.count === 1 && info.footers === 1 && info.oldFoot === 0, JSON.stringify({ c: info.count, f: info.footers, old: info.oldFoot }));
        if (info.count !== 1) continue;
        t.check(`${path}: the footer keeps its own bright cream colour with no dark panel inside it`, info.bg === "rgb(255, 246, 229)" && info.darkBg.length === 0, `${info.bg} dark: ${info.darkBg.slice(0, 3)}`);
        t.check(`${path}: seller line, payment-test link and the games line are there`, /IT Services by Rajat Agarwal/.test(info.text) && info.links.includes("/paytest.html") && /More from us/i.test(info.text) && /Tic Tac Toe/.test(info.text) && /Snakes and Ladders/i.test(info.text), info.text.slice(0, 160));
        t.check(`${path}: the footer fits 360 px with no sideways scroll`, info.left >= 0 && info.right <= info.iw + 0.5 && info.sw <= info.iw, `${info.left}..${info.right} of ${info.iw}, page ${info.sw}`);
        t.check(`${path}: footer links are tall enough to tap`, info.smallLinks === 0, String(info.smallLinks));
        info.links.filter((h) => h.startsWith("/")).forEach((h) => hrefs.add(h.split("#")[0]));
        if (path === "/" || path === "/privacy.html") { await x.page.locator("footer.uf").scrollIntoViewIfNeeded(); await t.shot(x.page, "footer" + path.replace(/[^\w]+/g, "_")); }
      }
      const bad = [];
      for (const h of hrefs) { const r = await fetch(H.SIM + h).catch(() => null); if (!r || !r.ok) bad.push(`${h} -> ${r ? r.status : "no answer"}`); }
      t.check(`all ${hrefs.size} footer links into this site (${[...hrefs].join(" ")}) are shipped by the build`, hrefs.size >= 10 && bad.length === 0, bad.join(" | "));
      const anchors = await (await fetch(H.SIM + "/legal.html")).text();
      t.check("the footer's links to the sections of the Rules and Privacy page point at ids that exist there", /id="privacy"/.test(anchors) && /id="disclaimer"/.test(anchors));
    },
  },
];
