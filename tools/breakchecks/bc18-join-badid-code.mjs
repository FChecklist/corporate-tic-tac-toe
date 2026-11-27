// Planted break bc18-join-badid-code: join refusal code bad-id renamed. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc18-join-badid-code.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc18-join-badid-code"));
