// Planted break bc44-erase-30h: personal data kept 30 h after the end instead of 20 h. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc44-erase-30h.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc44-erase-30h"));
