// Planted break bc60-matrix-mail: matrix goes red when normMail keeps the +tag. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc60-matrix-mail.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc60-matrix-mail"));
