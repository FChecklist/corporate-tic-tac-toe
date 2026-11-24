// Planted break bc62-matrix-pay: matrix goes red when TEST_MODE is ignored. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc62-matrix-pay.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc62-matrix-pay"));
