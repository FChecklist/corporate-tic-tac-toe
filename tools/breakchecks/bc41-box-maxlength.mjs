// Planted break bc41-box-maxlength: ID box allows only 30 typed characters. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc41-box-maxlength.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc41-box-maxlength"));
