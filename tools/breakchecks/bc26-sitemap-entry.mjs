// Planted break bc26-sitemap-entry: sitemap no longer lists how-it-works.html. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc26-sitemap-entry.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc26-sitemap-entry"));
