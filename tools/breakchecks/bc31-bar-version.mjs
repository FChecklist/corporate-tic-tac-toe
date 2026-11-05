// Planted break bc31-bar-version: brochure.html loads games bar v2. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc31-bar-version.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc31-bar-version"));
