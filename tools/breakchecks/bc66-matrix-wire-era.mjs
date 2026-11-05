// Planted break bc66-matrix-wire-era: matrix (wire) goes red when old games get the new ID rule. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc66-matrix-wire-era.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc66-matrix-wire-era"));
