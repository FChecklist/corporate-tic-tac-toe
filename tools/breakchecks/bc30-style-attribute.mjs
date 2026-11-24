// Planted break bc30-style-attribute: a style attribute on refer.html. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc30-style-attribute.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc30-style-attribute"));
