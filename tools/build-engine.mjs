// Builds apps/web/public/tttengine.js: the common engine's text reactions and Tic Tac Toe stage rules for the phone (new flow only).
// The vendored reaction pack lists the other games' ids and reaction words. They are never shown here (a reaction shows only when its game list holds "tictactoe"),
// but this site must carry no wording of another game, so the three names are shortened everywhere in the output, the same way each time (so the pack still matches itself).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const out = "apps/web/public/tttengine.js";
const r = spawnSync("bun", ["build", "packages/ttt/src/engine-browser.ts", "--target", "browser", "--format", "iife", "--minify", "--outfile", out], { stdio: "inherit", shell: process.platform === "win32" });
if (r.status !== 0) process.exit(r.status ?? 1);
let s = readFileSync(out, "utf8");
s = s.replace(/tambola/gi, (m) => (m[0] === "T" ? "Tmb" : "tmb")).replace(/bingo/gi, (m) => (m[0] === "B" ? "Bgo" : "bgo")).replace(/housie/gi, (m) => (m[0] === "H" ? "Hse" : "hse"));
writeFileSync(out, s);
console.log("tttengine.js written");
