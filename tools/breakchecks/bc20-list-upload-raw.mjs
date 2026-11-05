// Planted break bc20-list-upload-raw: list upload stores the ID as typed (not cleaned). Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc20-list-upload-raw.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc20-list-upload-raw"));
