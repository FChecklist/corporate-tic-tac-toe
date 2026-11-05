// Planted break bc61-matrix-link: matrix goes red when the Host link base moves. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc61-matrix-link.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc61-matrix-link"));
