// Planted break bc14-mail-id-cleaner: the ID cleaner is applied to an e-mail (normMail). Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc14-mail-id-cleaner.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc14-mail-id-cleaner"));
