// Planted break bc54-team-of-4: a team of 4 is accepted. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc54-team-of-4.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc54-team-of-4"));
