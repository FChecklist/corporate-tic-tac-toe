// Writes one script per planted break: tools/breakchecks/<id>.mjs (each runs: bun tools/breakchecks/<id>.mjs). Re-run after editing specs.mjs.
import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { SPECS } from "./specs.mjs";
for (const f of readdirSync(import.meta.dir)) if (/^bc\d\d-.*\.mjs$/.test(f)) unlinkSync(join(import.meta.dir, f));
for (const s of SPECS) writeFileSync(join(import.meta.dir, s.id + ".mjs"), `// Planted break ${s.id}: ${s.title}. Runs on a scratch COPY of the repo: green, then red, then green again. bun tools/breakchecks/${s.id}.mjs\nimport { run } from "./_lib.mjs";\nimport { SPECS } from "./specs.mjs";\nawait run(SPECS.find((s) => s.id === ${JSON.stringify(s.id)}));\n`);
console.log(SPECS.length + " scripts written");
