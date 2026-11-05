// Planted break bc02-id-no-nfkc: ID cleaner stops folding full-width characters. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc02-id-no-nfkc.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc02-id-no-nfkc"));
