// Planted break bc32-logo-symbol: game-completed.html uses another logo symbol. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc32-logo-symbol.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc32-logo-symbol"));
