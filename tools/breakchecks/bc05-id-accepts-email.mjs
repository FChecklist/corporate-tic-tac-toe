// Planted break bc05-id-accepts-email: an e-mail typed in the ID box is no longer refused. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc05-id-accepts-email.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc05-id-accepts-email"));
