// Planted break bc17-join-ignores-era: people.normEmp drops the game's creation time (old games get the new rule). Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc17-join-ignores-era.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc17-join-ignores-era"));
