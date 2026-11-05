// Planted break bc07-id-empty-refused: nothing typed is refused instead of being empty. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc07-id-empty-refused.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc07-id-empty-refused"));
