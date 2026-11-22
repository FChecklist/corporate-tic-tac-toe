// Planted break bc28-festive-line: festive offer line says 40%. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc28-festive-line.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc28-festive-line"));
