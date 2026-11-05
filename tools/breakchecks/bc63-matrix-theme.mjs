// Planted break bc63-matrix-theme: matrix goes red when theme-init accepts any theme. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc63-matrix-theme.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc63-matrix-theme"));
