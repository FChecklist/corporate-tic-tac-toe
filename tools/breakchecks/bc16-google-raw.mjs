// Planted break bc16-google-raw: Google sign-in no longer cleans the e-mail (only lower-cases). Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc16-google-raw.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc16-google-raw"));
