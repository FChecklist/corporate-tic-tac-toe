// Planted break bc36-canonical: canonical of refer.html points to the wrong page. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc36-canonical.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc36-canonical"));
