// Planted break bc55-missed-limit: three clock-outs needed to lose a board. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc55-missed-limit.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc55-missed-limit"));
