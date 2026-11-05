// TEST AUTHOR 30 Oct 2026. Planted-break check: proves a test can really fail.
//   1. copies the working tree to a SCRATCH folder (never the branch), runs the test: must be GREEN
//   2. plants ONE break in the scratch copy (a text replacement in a product file), runs the same test: must be RED
//   3. puts the original text back in the scratch copy, runs again: must be GREEN
// The branch itself is never edited: the file's hash in the real tree is printed before and after and must be equal.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../..");
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 16);
const counts = (out) => {
  const m = (re) => { const x = out.match(re); return x ? Number(x[1]) : null; };
  const pass = m(/^\s*(\d+) pass/m), fail = m(/^\s*(\d+) fail/m);
  if (pass !== null || fail !== null) return { pass: pass ?? 0, fail: fail ?? 0 };
  const mx = out.match(/MATRIX .*pass=(\d+) fail=(\d+)/); if (mx) return { pass: Number(mx[1]), fail: Number(mx[2]) };
  return { pass: 0, fail: 0 };
};
const firstReds = (out, n = 3) => out.split("\n").filter((l) => /^\(fail\)|^FAIL \[/.test(l)).slice(0, n).map((l) => "      " + l.slice(0, 190)).join("\n");

/** spec: { id, title, file, find, replace, all?, cmd: [..] , note? } */
export async function run(spec) {
  const scratch = join(process.env.BC_SCRATCH ?? join(tmpdir(), "breakchecks"), spec.id);
  const logDir = join(REPO, "results/breakchecks"); mkdirSync(logDir, { recursive: true });
  const log = join(logDir, spec.id + ".log"); writeFileSync(log, "");
  const say = (s) => { console.log(s); appendFileSync(log, s + "\n"); };
  rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch, { recursive: true });
  const real = join(REPO, spec.file), copy = join(scratch, spec.file);
  const before = sha(real);
  say(`BREAKCHECK ${spec.id}: ${spec.title}`);
  say(`  scratch copy: ${scratch} (the branch file ${spec.file} sha ${before} is never edited)`);
  const cp = spawnSync("bash", ["-c", `tar -C "${REPO}" --exclude=./node_modules --exclude=./results --exclude=./pages/public -cf - . | tar -C "${scratch}" -xf -`]);
  if (cp.status !== 0) { say("  COPY FAILED " + cp.stderr); process.exit(2); }
  symlinkSync(join(REPO, "node_modules"), join(scratch, "node_modules"));
  const exec = (label) => { const r = spawnSync(spec.cmd[0], spec.cmd.slice(1), { cwd: scratch, encoding: "utf8", timeout: 600_000, maxBuffer: 1 << 28 }); const out = (r.stdout ?? "") + (r.stderr ?? ""); appendFileSync(log, `---- ${label} (exit ${r.status})\n${out}\n`); return { code: r.status, out, ...counts(out) }; };
  const text = readFileSync(copy, "utf8"); const n = text.split(spec.find).length - 1;
  if (n < 1 || (n > 1 && !spec.all)) { say(`  PLANT FAILED: the text to break was found ${n} times (need exactly 1). find: ${JSON.stringify(spec.find).slice(0, 120)}`); process.exit(2); }
  const a = exec("A: unbroken scratch copy");
  say(`  A. unbroken:  exit ${a.code}  ${a.pass} pass  ${a.fail} fail`);
  writeFileSync(copy, spec.all ? text.split(spec.find).join(spec.replace) : text.replace(spec.find, () => spec.replace));
  say(`  B. planted:   ${JSON.stringify(spec.find).slice(0, 100)}  ->  ${JSON.stringify(spec.replace).slice(0, 100)}`);
  const b = exec("B: planted break");
  say(`     result:    exit ${b.code}  ${b.pass} pass  ${b.fail} fail`); const reds = firstReds(b.out); if (reds) say(reds);
  writeFileSync(copy, text);
  const c = exec("C: restored");
  say(`  C. restored:  exit ${c.code}  ${c.pass} pass  ${c.fail} fail`);
  const after = sha(real);
  const ok = a.code === 0 && a.fail === 0 && b.code !== 0 && b.fail > 0 && c.code === 0 && c.fail === 0 && before === after;
  say(`  branch file sha before ${before} after ${after} (${before === after ? "unchanged" : "CHANGED!"})`);
  say(`RESULT ${spec.id}: ${ok ? "OK (green, then RED, then green)" : "NOT OK"}`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
}
