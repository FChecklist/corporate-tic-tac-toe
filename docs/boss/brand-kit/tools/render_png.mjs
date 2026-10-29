// Developer tool: makes the PNG logo files (512, 192, 180 apple-touch, 32, maskable 192/512) from the SVG badges, and the social cards (1200x630).
// Uses the "sharp" image library (no browser, light on memory). Set SHARP to the sharp folder if it is not found:  SHARP=C:/ct/ct/node_modules/sharp
// Run:  node tools/render_png.mjs      then:  python -I tools/make_logos.py ico
import { readFileSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(import.meta.url)(process.env.SHARP || "C:/ct/ct/node_modules/sharp");
const OUT = join(ROOT, "logos", "png");
mkdirSync(OUT, { recursive: true });
const NAMES = ["tambola", "bingo", "tictactoe", "snakes", "luck", "draw", "corporate-games-mark"];
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const png = (svg, w, h, file) => sharp(Buffer.from(svg), { density: 288 }).resize(w, h, { fit: "fill" }).png({ compressionLevel: 9 }).toFile(file);
for (const n of NAMES) {
  const svg = readFileSync(join(ROOT, "logos", n + ".svg"), "utf8").trim();
  const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<title>.*?<\/title>/, "").replace(/<\/svg>$/, "");
  const bg = inner.match(/<rect[^>]*fill="(#[0-9A-Fa-f]{6})"/)[1];
  for (const px of [512, 192, 32]) await png(svg, px, px, join(OUT, `${n}-${px}.png`));
  const square = `<svg ${NS} viewBox="0 0 64 64" width="512" height="512"><rect width="64" height="64" fill="${bg}"/>${inner.replace(/(<rect width="64" height="64") rx="\d+"/, "$1")}</svg>`;
  await png(square, 180, 180, join(OUT, `${n}-180.png`));
  const mask = `<svg ${NS} viewBox="0 0 64 64" width="512" height="512"><rect width="64" height="64" fill="${bg}"/><g transform="translate(6.4 6.4) scale(.8)">${inner}</g></svg>`;
  for (const px of [512, 192]) await png(mask, px, px, join(OUT, `${n}-maskable-${px}.png`));
}
for (const f of readdirSync(join(ROOT, "logos", "social")).filter((f) => f.endsWith(".svg"))) {
  await png(readFileSync(join(ROOT, "logos", "social", f), "utf8"), 1200, 630, join(ROOT, "logos", "social", f.replace(".svg", ".png")));
}
console.log("PNG files written");
