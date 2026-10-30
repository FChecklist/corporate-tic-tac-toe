// Planted break bc57-rank-ties: ranking allows ties (pairs share a rank). Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc57-rank-ties.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc57-rank-ties"));
