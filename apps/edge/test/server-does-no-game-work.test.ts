// THE PRODUCT RULE, as a test: in every use case the players' own phones and laptops do the computing; OUR SERVER ONLY STORES AND RELAYS DATA
// (sign-in, payment, saving, relaying moves, tallying agreed results, 24-hour deletion, e-mail).
//
// This file lists, by name, every module the Worker (apps/edge/src) is allowed to take from the packages folder. It FAILS when any other module appears,
// so a rule, a bracket, a clock or a ranking cannot slip back onto the server by an import. It also scans the code of the Worker for the names of the game functions.
// To prove the guard works it was run once with a forbidden import added (it failed), and the import was then removed.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = join(ROOT, "apps/edge/src");

/** module (from the repository root, no extension) -> the names the Worker may take from it. "*" = anything from this module, because the module holds no game rule. */
export const ALLOWED_IMPORTS: Record<string, string[] | "*"> = {
  // settings validation and money
  "packages/shared/src/pricing": "*",
  "packages/billing/src": "*",
  "packages/beacon/src/config": "*", // settings and their validation
  "packages/beacon/src/control": "*", // the published settings record
  // timeline and schedule helpers (when does a round start, which round is it now)
  "packages/beacon/src": ["roundAt", "roundTimeMs"], // the package index
  "packages/beacon/src/game": ["callRoundR", "luckyRound"], // the call schedule of the other game, a timeline lookup
  "packages/beacon/src/unique-ticket": ["seatOfPid"], // seat number of a participant id
  // hashing and the seal check: commit == hash(secret). Nothing else from the game package.
  "packages/ttt/src/seal": ["newSecret", "commitOf", "seedOf", "verifyReveal"],
};
/** Modules the allowed ones may themselves pull in (checked inside the package): the hash, and nothing else. */
const ALLOWED_TRANSITIVE: Record<string, string[]> = { "packages/ttt/src/seal": ["packages/ttt/src/hash"] };

/** The names of the game's functions. None of them may appear in the Worker's code (comments are not code and are ignored). */
const GAME_NAMES = ["applyMove", "advanceBoard", "advanceMatchP", "advanceTournament", "openMatchP", "finalizeMatchP", "makeBye", "startTournament", "rankings", "boardInMatch", "boardOf", "moverOf", "markOf", "tieLine", "outcomeOf", "feedersOf", "parentOf", "shuffled", "pairRound", "fateOf", "clockOut", "settleMove", "newBoard", "replayMatch", "planOf", "TttPhone"];

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

interface Imp { file: string; spec: string; names: string[] | "*" }
/** Every static import, "export ... from", dynamic import() and require() in a file. */
export function importsOf(file: string, text: string): Imp[] {
  const code = stripComments(text); const out: Imp[] = [];
  for (const m of code.matchAll(/\b(?:import|export)\s+(type\s+)?([^"';]*?)\s*from\s*["']([^"']+)["']/g)) {
    const clause = m[2]!.trim(); const named = /\{([\s\S]*)\}/.exec(clause);
    const names = named ? named[1]!.split(",").map((x) => x.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim()).filter(Boolean) : ["*"]; // default or namespace import: counts as "*"
    out.push({ file, spec: m[3]!, names: names.includes("*") ? "*" : names });
  }
  for (const m of code.matchAll(/\bimport\s*["']([^"']+)["']/g)) out.push({ file, spec: m[1]!, names: [] });
  for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g)) out.push({ file, spec: m[1]!, names: "*" });
  return out;
}
const resolveSpec = (file: string, spec: string): string | null => {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(file), spec);
  for (const c of [base, base + ".ts", join(base, "index.ts")]) if (existsSync(c) && statSync(c).isFile()) return relative(ROOT, c).replace(/\\/g, "/").replace(/\.ts$/, "").replace(/\/index$/, ""); // a package folder stands for its index
  return relative(ROOT, base).replace(/\\/g, "/");
};
const inSrc = (rel: string) => rel.startsWith("apps/edge/src/");

/** The violations, as readable lines. Empty means the Worker does no game work. */
export function violationsIn(files: { file: string; text: string }[]): string[] {
  const bad: string[] = [];
  for (const { file, text } of files) {
    for (const imp of importsOf(file, text)) {
      if (!imp.spec.startsWith(".")) { if (/(^|\/)ttt(\/|$)|@tictactoe|packages\//.test(imp.spec)) bad.push(`${relative(ROOT, file)}: imports "${imp.spec}", a package by its name`); continue; }
      const rel = resolveSpec(file, imp.spec)!;
      if (inSrc(rel)) continue; // another file of the Worker itself
      if (!rel.startsWith("packages/")) { bad.push(`${relative(ROOT, file)}: imports ${rel} from outside the Worker and the packages`); continue; }
      const ok = ALLOWED_IMPORTS[rel];
      if (!ok) { bad.push(`${relative(ROOT, file)}: imports ${rel}, which is not on the allowed list`); continue; }
      if (ok !== "*") { const extra = imp.names === "*" ? ["(everything)"] : imp.names.filter((n) => !ok.includes(n)); if (extra.length) bad.push(`${relative(ROOT, file)}: takes ${extra.join(", ")} from ${rel}; only ${ok.join(", ")} is allowed`); }
    }
    const code = stripComments(text);
    for (const n of GAME_NAMES) if (new RegExp(`\\b${n}\\b`).test(code)) bad.push(`${relative(ROOT, file)}: uses the game function name ${n}`);
  }
  return bad;
}
const workerFiles = () => walk(SRC).map((file) => ({ file, text: readFileSync(file, "utf8") }));

describe("the server does no game work (the phones compute, the server stores and relays)", () => {
  test("every import the Worker takes from the packages folder is on the allowed list", () => {
    expect(violationsIn(workerFiles())).toEqual([]);
  });
  test("the only thing the Worker takes from the game package is the seal (a hash comparison): no rules, no bracket, no clock, no ranking", () => {
    const fromTtt = workerFiles().flatMap((f) => importsOf(f.file, f.text).filter((i) => i.spec.startsWith(".") && resolveSpec(f.file, i.spec)!.startsWith("packages/ttt")).map((i) => ({ rel: resolveSpec(f.file, i.spec), names: i.names })));
    expect(fromTtt.length).toBeGreaterThan(0);
    for (const i of fromTtt) { expect(i.rel).toBe("packages/ttt/src/seal"); expect(i.names).not.toBe("*"); expect([...(i.names as string[])].sort()).toEqual(["commitOf", "newSecret", "seedOf"]); }
  });
  test("the allowed game-package module pulls in nothing but the hash", () => {
    for (const [rel, allowed] of Object.entries(ALLOWED_TRANSITIVE)) {
      const file = join(ROOT, rel + ".ts"); const seen = new Set<string>([rel]); const queue = [file];
      while (queue.length) {
        const f = queue.pop()!;
        for (const imp of importsOf(f, readFileSync(f, "utf8"))) { const r = resolveSpec(f, imp.spec); if (!r || seen.has(r)) continue; seen.add(r); if (r.startsWith("packages/")) queue.push(join(ROOT, r + ".ts")); }
      }
      expect([...seen].filter((x) => x !== rel).sort()).toEqual([...allowed].sort());
    }
  });
  test("the guard itself catches a forbidden import (a rule module, a wildcard, a package by name, an unknown module) and a game function name", () => {
    const f = join(SRC, "tournament.ts");
    const bad = (text: string) => violationsIn([{ file: f, text }]);
    expect(bad(`import { applyMove } from "../../../packages/ttt/src/match";`).length).toBeGreaterThan(0);
    expect(bad(`import { startTournament, rankings } from "../../../packages/ttt/src/index";`).length).toBeGreaterThan(0);
    expect(bad(`import * as ttt from "../../../packages/ttt/src/seal";`).length).toBeGreaterThan(0);
    expect(bad(`import { moverOf } from "../../../packages/ttt/src/seal";`).length).toBeGreaterThan(0);
    expect(bad(`const m = await import("../../../packages/ttt/src/bracket");`).length).toBeGreaterThan(0);
    expect(bad(`import { x } from "@tictactoe/ttt";`).length).toBeGreaterThan(0);
    expect(bad(`export { y } from "../../../packages/ttt/src/phone";`).length).toBeGreaterThan(0);
    expect(bad(`const board = outcomeOf(cells);`).length).toBeGreaterThan(0);
    expect(bad(`import { commitOf, newSecret, seedOf } from "../../../packages/ttt/src/seal";\n// applyMove is only mentioned in a comment\nconst a = 1;`)).toEqual([]);
  });
});
