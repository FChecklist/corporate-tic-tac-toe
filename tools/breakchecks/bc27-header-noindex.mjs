// Planted break bc27-header-noindex: build no longer sends noindex for game-completed. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc27-header-noindex.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc27-header-noindex"));
