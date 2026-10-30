// Planted break bc19-join-id-used: same ID on a second phone is allowed (423 becomes 409). Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc19-join-id-used.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc19-join-id-used"));
