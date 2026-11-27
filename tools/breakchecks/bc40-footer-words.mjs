// Planted break bc40-footer-words: footer words change. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc40-footer-words.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc40-footer-words"));
