// Planted break bc13-mail-tag-kept: normMail keeps the +tag part. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc13-mail-tag-kept.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc13-mail-tag-kept"));
