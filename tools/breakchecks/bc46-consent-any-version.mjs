// Planted break bc46-consent-any-version: an old consent version is accepted on join. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc46-consent-any-version.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc46-consent-any-version"));
