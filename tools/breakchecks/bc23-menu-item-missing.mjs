// Planted break bc23-menu-item-missing: how-it-works.html loses the 'Refer & earn' menu item. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc23-menu-item-missing.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc23-menu-item-missing"));
