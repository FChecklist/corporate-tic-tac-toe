// Planted break bc33-other-game-word: the word Bingo in the body of index.html. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc33-other-game-word.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc33-other-game-word"));
