// Planted break bc25-thankyou-indexable: thank-you.html loses noindex. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc25-thankyou-indexable.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc25-thankyou-indexable"));
