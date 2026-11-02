// Writes the public Trust page and llms.txt from the 10 facts (apps/edge/src/ai-facts.ts). Run after changing a fact:  bun run tools/make-trust.ts
// The page gets the same Corporate Games head, header and footer as every other page (tools/make-site-chrome.mjs); a test regenerates both files and fails if they differ.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { llmsTxt, trustHtml } from "../apps/edge/src/trust-page";
import { build, PAGES } from "./make-site-chrome.mjs";

const out = join(import.meta.dir, "..", "apps", "web", "public");
writeFileSync(join(out, "trust.html"), build("trust.html", PAGES["trust.html"], trustHtml()));
writeFileSync(join(out, "llms.txt"), llmsTxt());
console.log("wrote trust.html and llms.txt");
