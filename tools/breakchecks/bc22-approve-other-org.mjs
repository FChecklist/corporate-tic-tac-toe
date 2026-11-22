// Planted break bc22-approve-other-org: another Organizer's key may decide on this game's waiting room. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc22-approve-other-org.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc22-approve-other-org"));
