// Screenshots + keyboard + aria check of the bar on the demo page. Serve the folder first (python -m http.server 8890 in corporate-games-bar).
// node src/shots.mjs   -> C:\ct\test-sites\data\ui\games-bar\
import { createRequire } from "node:module"; import { mkdirSync } from "node:fs";
const { chromium } = createRequire("C:/ct/tambola/package.json")("playwright");
const OUT = "C:/ct/test-sites/data/ui/games-bar"; mkdirSync(OUT, { recursive: true });
const URL = process.env.URL || "http://localhost:8890/demo/index.html";
const b = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" }); const res = [];
for (const [w, h] of [[360, 800], [390, 844], [768, 1024], [900, 700], [1024, 768], [1280, 800], [1920, 1080]]) {
  for (const scheme of ["light", "dark"]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: scheme }); const errs = [];
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); }); p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(URL); await p.waitForSelector(".cgb"); await p.waitForTimeout(300);
    const m = await p.evaluate(() => { const i = document.querySelector(".cgb-in"); const bar = document.querySelector(".cgb");
      const vis = (s) => [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden").length;
      return { scrollX: i.scrollWidth > i.clientWidth + 1, pageX: document.documentElement.scrollWidth > innerWidth, h: Math.round(bar.getBoundingClientRect().height), games: vis(".cgb-game"), cur: vis(".cgb-cur"), btn: vis(".cgb-all"),
        current: [...document.querySelectorAll('.cgb [aria-current]')].map((a) => a.textContent), label: document.querySelector(".cgb nav").getAttribute("aria-label"), home: document.querySelector(".cgb-home").href }; });
    await p.screenshot({ path: `${OUT}/${w}-${scheme}.png`, clip: { x: 0, y: 0, width: w, height: Math.min(h, 420) } });
    if (w < 900 && scheme === "light") { // keyboard: Tab to the button, Enter opens the sheet, focus moves in, Escape closes and returns focus
      await p.focus(".cgb-all"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
      const o = await p.evaluate(() => ({ exp: document.querySelector(".cgb-all").getAttribute("aria-expanded"), shown: !document.getElementById("cgb-sheet").hidden, focus: document.activeElement.className, tiles: document.querySelectorAll(".cgb-tile").length }));
      await p.screenshot({ path: `${OUT}/${w}-sheet.png` });
      await p.keyboard.press("Escape"); await p.waitForTimeout(100);
      const c = await p.evaluate(() => ({ exp: document.querySelector(".cgb-all").getAttribute("aria-expanded"), focus: document.activeElement.className }));
      m.sheet = { open: o, closed: c };
    }
    if (w >= 900 && scheme === "light") { await p.keyboard.press("Tab"); const f1 = await p.evaluate(() => document.activeElement.className); m.firstTab = f1; }
    m.errs = errs; res.push([w, scheme, m]); await p.close();
  }
}
await b.close(); for (const r of res) console.log(JSON.stringify(r));
