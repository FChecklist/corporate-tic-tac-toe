// Planted break bc69-matrix-bracket: matrix (bracket) goes red when draws are not limited to 3 games. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc69-matrix-bracket.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc69-matrix-bracket"));
