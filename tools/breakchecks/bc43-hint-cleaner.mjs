// Planted break bc43-hint-cleaner: the page cleans differently from the server (keeps dashes). Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc43-hint-cleaner.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc43-hint-cleaner"));
