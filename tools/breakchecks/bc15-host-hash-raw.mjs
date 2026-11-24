// Planted break bc15-host-hash-raw: Host e-mail hash no longer cleans the address. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc15-host-hash-raw.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc15-host-hash-raw"));
