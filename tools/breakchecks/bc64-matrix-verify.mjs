// Planted break bc64-matrix-verify: matrix goes red when verifyOf ignores 'either'. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc64-matrix-verify.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc64-matrix-verify"));
