// The Corporate Games brand kit is ONE shared set of files: this site's copy must equal the canonical files in C:\ct\test-sites\corporate-brand-kit
// byte for byte (SHA-256 below; python -I vendor.py prints them, and so does python -I build.py). If this fails, run vendor.py again; never edit the copy here.
// (pinned) with the value printed for that file (and keep the list to the files this site really copies).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const sha = (f: string, text = true) => {
  let b = readFileSync(new URL("../public/" + f, import.meta.url));
  if (text) b = Buffer.from(b.toString("utf8").split(String.fromCharCode(13)).join("")); // line endings do not count (git may check files out with CRLF)
  return createHash("sha256").update(b).digest("hex");
};
describe("the shared Corporate Games brand kit", () => {
  test("css and js are identical to the canonical copy", () => {
    expect(sha("tokens.css")).toBe("32566fe7a4bdd8d2880459d353dadff1f7d97f23ab7228d94313ef7e80017638");
    expect(sha("fonts.css")).toBe("94ca9271029ca0e0cdb269698e334dd8dedc001f5ca2c4a5d228a6dc11306a9c");
    expect(sha("components.css")).toBe("22196acdfbda615dfa2b0bf5bc61568155f9acfa94b979af36f1c3c11b46b786");
    expect(sha("console.css")).toBe("690b28be74be67487fd478350ff99e3b2d21bbabc2163e004ff94dfbfcbf5c0b"); // only if this site has organizer pages
    expect(sha("brandkit.js")).toBe("00dabcc77138e157a432705f18cc9145bf50164421bc08d173f7424d517f802b");
    expect(sha("theme-init.js")).toBe("8ff0eb6def5cf8a95b54a2b81738a022b7a7a2b2dc76325fed78c455e45c6d7f");
  });
  test("the two fonts are identical", () => {
    expect(sha("fonts/Inter-normal-400.woff2", false)).toBe("3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62");
    expect(sha("fonts/Fraunces-normal-500-700.woff2", false)).toBe("7234ed860a9cc83045413c4faee63c960a8f2d1917adcf728119307d56e0d783");
  });
  test("the header menu has exactly the six labels", () => {
    const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
    const nav = /<nav class="ck-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(html)![1].replace(/<span class="ck-dots"[\s\S]*?<\/span>/, "");
    const labels = [...nav.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/&amp;/g, "&").trim());
    expect(labels).toEqual(["How it works", "Free demo game", "Guide", "Brochure", "Refer & earn", "Log in"]);
  });
  test("the Corporate Games bar files are identical to the canonical copy (v3)", () => {
    expect(sha("gamesbar.js")).toBe("d2e437bf46b71699f4dd55769d028cad32aca2f62e1afbc563ee7cf2a0594934");
    expect(sha("gamesbar.css")).toBe("6b0311de98525de646e637a28102163dfecf9fde35b8befe0344a5e16fff8b5b");
  });
  const PUBLIC = ["index", "how-it-works", "guide", "brochure", "refer", "thank-you", "game-completed"];
  test("every new public page has the six-item menu, the logo, the bar, canonical and share tags, and never the banned word", () => {
    for (const p of PUBLIC) {
      const h = readFileSync(new URL("../public/" + p + ".html", import.meta.url), "utf8");
      const nav = /<nav class="ck-nav"[^>]*>([\s\S]*?)<\/nav>/.exec(h)![1].replace(/<span class="ck-dots"[\s\S]*?<\/span>/, "");
      expect([p, [...nav.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/&amp;/g, "&").trim())]).toEqual([p, ["How it works", "Free demo game", "Guide", "Brochure", "Refer & earn", "Log in"]]);
      expect([p, h.includes('href="/zc?demo=1"'), h.includes('<use href="#i-ttt"/>'), h.includes('src="/gamesbar.js?v=3"')]).toEqual([p, true, true, true]);
      expect([p, /<link rel="canonical" href="https:\/\/tictactoe\.corporatetambola\.com\//.test(h), /property="og:image" content="https:\/\/tictactoe\.corporatetambola\.com\/og-card\.png"/.test(h)]).toEqual([p, true, true]);
      expect([p, /priv(?:ate)/i.test(h)]).toEqual([p, false]);
    }
  });
  test("logo and icon files exist, and the sitemap lists the new indexable pages", () => {
    for (const f of ["favicon.svg", "favicon.ico", "favicon-32.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png", "og-card.png"]) expect([f, readFileSync(new URL("../public/" + f, import.meta.url)).length > 200]).toEqual([f, true]);
    const sm = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
    for (const p of ["how-it-works", "guide", "refer"]) expect(sm).toContain("/" + p + ".html</loc>");
  });
});
