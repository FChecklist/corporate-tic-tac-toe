// Planted break bc45-report-link-late: report link outlives the data. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc45-report-link-late.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc45-report-link-late"));
