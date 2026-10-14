// Writes the "what your device keeps" list on the Privacy page (apps/web/public/legal.html) from apps/web/storage-registry.json, between the two storage markers.
// Run: node tools/make-storage-notice.mjs   (apps/web/test/storage-notice.test.ts fails when the page and the registry disagree)
import { readFileSync, writeFileSync } from "node:fs";
const reg = JSON.parse(readFileSync(new URL("../apps/web/storage-registry.json", import.meta.url), "utf8"));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&rsquo;");
const lines = [...reg.items.filter((i) => !i.cleanup).map((i) => i.say), ...reg.cookies.map((c) => c.say)];
const list = lines.map((l) => `        <li>${esc(l)}</li>`).join("\n");
const file = new URL("../apps/web/public/legal.html", import.meta.url);
let html = readFileSync(file, "utf8");
const block = `<!-- storage:start -->\n${list}\n        <!-- storage:end -->`;
if (html.includes("<!-- storage:start -->")) html = html.replace(/<!-- storage:start -->[\s\S]*?<!-- storage:end -->/, block);
else throw new Error("legal.html has no storage markers yet");
writeFileSync(file, html);
console.log("storage notice written:", lines.length, "lines");
