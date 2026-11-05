// Planted break bc59-matrix-id: matrix goes red when the ID cleaner keeps dashes. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc59-matrix-id.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc59-matrix-id"));
