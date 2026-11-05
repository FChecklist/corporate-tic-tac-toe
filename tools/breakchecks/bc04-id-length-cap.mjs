// Planted break bc04-id-length-cap: 30-character limit raised to 99. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc04-id-length-cap.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc04-id-length-cap"));
