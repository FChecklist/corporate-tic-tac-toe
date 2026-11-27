// Planted break bc08-id-symbols-accepted: only symbols is accepted as an empty ID instead of refused. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc08-id-symbols-accepted.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc08-id-symbols-accepted"));
