// What is live, in one small file: pages/public/version.json = { commit, dirty, builtAt, game }, written by pages/build.mjs and served at /version.json.
// `commit` is the git commit the build was made from (short), `dirty` says whether files differed from it, `builtAt` is UTC. No secret, no person, no setting is ever put here.
import { execFileSync } from "node:child_process";

export function versionStamp({ root, game, run, now = () => new Date() }) {
  const git = run ?? ((args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  let commit = "unknown", dirty = false;
  try { commit = git(["rev-parse", "--short=12", "HEAD"]); dirty = git(["status", "--porcelain", "--untracked-files=no"]).length > 0; } catch { /* built outside git: the stamp says so */ }
  return { commit, dirty, builtAt: now().toISOString(), game };
}
