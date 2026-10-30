// Planted break bc56-max-games: only two games per board. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc56-max-games.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc56-max-games"));
