// Planted break bc68-matrix-wire-locked: matrix (wire) goes red when an unpaid game lets new people in. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc68-matrix-wire-locked.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc68-matrix-wire-locked"));
