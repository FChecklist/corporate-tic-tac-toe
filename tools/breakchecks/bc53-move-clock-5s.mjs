// Planted break bc53-move-clock-5s: a 5-second move clock is accepted. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc53-move-clock-5s.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc53-move-clock-5s"));
