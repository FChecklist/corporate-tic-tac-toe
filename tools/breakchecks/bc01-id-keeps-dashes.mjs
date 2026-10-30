// Planted break bc01-id-keeps-dashes: ID cleaner keeps dashes (1B-678 would stay 1B-678). Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc01-id-keeps-dashes.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc01-id-keeps-dashes"));
