// Writes the public Trust page and llms.txt from the 10 facts (apps/edge/src/ai-facts.ts). Run after changing a fact:  bun run tools/make-trust.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { llmsTxt, trustHtml } from "../apps/edge/src/trust-page";

const out = join(import.meta.dir, "..", "apps", "web", "public");
writeFileSync(join(out, "trust.html"), trustHtml());
writeFileSync(join(out, "llms.txt"), llmsTxt());
console.log("wrote trust.html and llms.txt");
