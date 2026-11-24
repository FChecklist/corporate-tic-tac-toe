// Planted break bc12-mail-keeps-spaces: e-mail cleaner keeps inner spaces. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc12-mail-keeps-spaces.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc12-mail-keeps-spaces"));
