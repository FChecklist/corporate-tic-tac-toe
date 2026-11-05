// Planted break bc09-id-hint-words: hint words changed ('We will read this as'). Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc09-id-hint-words.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc09-id-hint-words"));
