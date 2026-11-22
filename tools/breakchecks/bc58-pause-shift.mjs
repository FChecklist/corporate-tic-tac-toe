// Planted break bc58-pause-shift: pause does not move the clocks. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc58-pause-shift.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc58-pause-shift"));
