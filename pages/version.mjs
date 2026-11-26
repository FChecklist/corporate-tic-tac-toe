// What is live, in one small file: pages/public/version.json = { commit, dirty, builtAt, game }, written by pages/build.mjs and served at /version.json.
// `version` is the release number kept in the repo (apps/edge/src/releases.json, newest first; or the root version.json): "unknown" if neither can be read.
// `commit` is the git commit the build was made from (short), `dirty` says whether files differed from it, `builtAt` is UTC. No secret, no person, no setting is ever put here.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The release number the repo records: newest entry of apps/edge/src/releases.json, else the root version.json.
export function releaseVersion(root) {
  const tries = [[join(root, "apps/edge/src/releases.json"), (j) => j[0].version], [join(root, "version.json"), (j) => j.version]];
  for (const [f, pick] of tries) { try { if (existsSync(f)) { const s = pick(JSON.parse(readFileSync(f, "utf8"))); if (typeof s === "string" && /^[0-9]+[.][0-9]+[.][0-9]+/.test(s)) return s; } } catch { /* try the next source */ } }
  return "unknown";
}

export function versionStamp({ root, game, run, version, now = () => new Date() }) {
  const git = run ?? ((args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  let commit = "unknown", dirty = false;
  try { commit = git(["rev-parse", "--short=12", "HEAD"]); dirty = git(["status", "--porcelain", "--untracked-files=no"]).length > 0; } catch { /* built outside git: the stamp says so */ }
  return { version: version ?? releaseVersion(root), commit, dirty, builtAt: now().toISOString(), game };
}
