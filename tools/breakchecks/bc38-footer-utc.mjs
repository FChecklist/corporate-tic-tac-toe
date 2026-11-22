// Planted break bc38-footer-utc: footer shows UTC instead of IST. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc38-footer-utc.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc38-footer-utc"));
