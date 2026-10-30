// Planted break bc06-id-old-rule-lost: games created before the deploy instant no longer keep the old rule. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc06-id-old-rule-lost.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc06-id-old-rule-lost"));
