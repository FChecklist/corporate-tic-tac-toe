// What is live, in one small file: pages/public/version.json = { commit, dirty, builtAt, game }, written by pages/build.mjs and served at /version.json.
// `commit` is the git commit the build was made from (short), `dirty` says whether files differed from it, `builtAt` is UTC, `releasedAtIST` is the same moment in Indian time (UTC + 5:30, written with its +05:30 offset). No secret, no person, no setting is ever put here.
/** A UTC moment written in Indian Standard Time: 2026-11-23T07:09:37.000Z -> 2026-11-23T12:39:37+05:30. */
export const istOf = (d) => new Date(d.getTime() + 19_800_000).toISOString().slice(0, 19) + "+05:30";
import { execFileSync } from "node:child_process";

export function versionStamp({ root, game, run, now = () => new Date() }) {
  const git = run ?? ((args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  let commit = "unknown", dirty = false;
  try { commit = git(["rev-parse", "--short=12", "HEAD"]); dirty = git(["status", "--porcelain", "--untracked-files=no"]).length > 0; } catch { /* built outside git: the stamp says so */ }
  const at = now();
  return { commit, dirty, builtAt: at.toISOString(), releasedAtIST: istOf(at), game };
}
