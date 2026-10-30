// Planted break bc67-matrix-wire-device: matrix (wire) goes red when a second phone may take the same place. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/bc67-matrix-wire-device.mjs
import { run } from "./_lib.mjs";
import { SPECS } from "./specs.mjs";
await run(SPECS.find((s) => s.id === "bc67-matrix-wire-device"));
