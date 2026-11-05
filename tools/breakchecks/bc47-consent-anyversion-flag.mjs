// Planted break bc47-consent-anyversion-flag: hasConsent ignores the any-version flag. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc47-consent-anyversion-flag.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc47-consent-anyversion-flag"));
