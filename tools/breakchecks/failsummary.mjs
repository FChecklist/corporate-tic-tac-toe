// TEST AUTHOR 30 Oct 2026. Reads a raw `bun test` log and prints, for every failing test, its name and the first 8 error lines (from the line that starts with "error:" up to the "(fail)" line).
// usage: bun tools/breakchecks/failsummary.mjs results/<tag>/<folder>.log [--md]
import { readFileSync } from "node:fs";
const lines = readFileSync(process.argv[2], "utf8").split("\n"); const md = process.argv.includes("--md");
let file = "", errStart = -1; const out = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]; const m = l.match(/^(\S+\.(?:ts|tsx|mjs|js)):$/); if (m) file = m[1];
  if (/^(error:|\w*Error:)/.test(l) && errStart < 0) errStart = i;
  if (/^\(fail\) /.test(l)) {
    const err = errStart >= 0 ? lines.slice(errStart, i).filter((x) => x.trim() && !/^\s*at /.test(x)).slice(0, 8) : ["(no error text captured)"];
    out.push({ file, name: l.replace(/^\(fail\) /, "").replace(/ \[[\d.]+ms\]$/, ""), err }); errStart = -1;
  }
}
if (md) for (const f of out) console.log(`- **${f.name}**  \n  file: \`${f.file || "?"}\`\n\n  \`\`\`\n${f.err.map((x) => "  " + x.slice(0, 200)).join("\n")}\n  \`\`\`\n`);
else for (const f of out) console.log(`FAIL ${f.file} :: ${f.name}\n` + f.err.map((x) => "     " + x.slice(0, 200)).join("\n"));
console.error(out.length + " failing tests");
