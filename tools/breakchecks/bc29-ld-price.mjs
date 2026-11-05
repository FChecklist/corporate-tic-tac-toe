// Planted break bc29-ld-price: structured data low price changed. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc29-ld-price.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc29-ld-price"));
