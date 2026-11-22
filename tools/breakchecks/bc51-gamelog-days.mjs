// Planted break bc51-gamelog-days: game log kept 30 days instead of 365. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc51-gamelog-days.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc51-gamelog-days"));
