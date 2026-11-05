// Planted break bc65-matrix-price: matrix goes red when a pack price changes. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc65-matrix-price.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc65-matrix-price"));
