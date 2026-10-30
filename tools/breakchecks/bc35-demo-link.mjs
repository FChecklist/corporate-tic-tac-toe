// Planted break bc35-demo-link: Free demo game points to /zc instead of /zc?demo=1 on index. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc35-demo-link.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc35-demo-link"));
