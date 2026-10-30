// Planted break bc42-hint-words: hint words changed on the page. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc42-hint-words.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc42-hint-words"));
