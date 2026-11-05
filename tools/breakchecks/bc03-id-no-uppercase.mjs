// Planted break bc03-id-no-uppercase: ID cleaner stops upper-casing (1b-678 becomes 678). Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc03-id-no-uppercase.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc03-id-no-uppercase"));
