// Planted break bc34-robots-allow: robots.txt stops allowing /guide. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc34-robots-allow.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc34-robots-allow"));
