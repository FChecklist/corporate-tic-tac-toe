// Planted break bc50-gamelog-zero: game log count overwritten with zero by a later pass. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc50-gamelog-zero.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc50-gamelog-zero"));
