// Planted break bc49-checkin-perm: check-in code can be 10000 (outside 0..9999). Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc49-checkin-perm.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc49-checkin-perm"));
