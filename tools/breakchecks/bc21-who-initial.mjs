// Planted break bc21-who-initial: 'is this you' shows the full last name instead of the initial. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc21-who-initial.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc21-who-initial"));
