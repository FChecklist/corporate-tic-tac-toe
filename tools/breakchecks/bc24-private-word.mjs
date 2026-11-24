// Planted break bc24-private-word: the word 'private' appears on guide.html. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc24-private-word.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc24-private-word"));
