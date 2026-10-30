// Planted break bc52-pause-anyone: a player can pause the tournament. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc52-pause-anyone.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc52-pause-anyone"));
