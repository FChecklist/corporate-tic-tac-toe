// Planted break bc48-checkin-opens: check-in opens 10 minutes before the start. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc48-checkin-opens.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc48-checkin-opens"));
