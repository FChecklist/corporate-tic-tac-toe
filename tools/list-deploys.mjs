// Refreshes docs/DEPLOYS.md from Cloudflare Pages (read only): the last deploys of this site, by time, commit and result.
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node tools/list-deploys.mjs        (writes docs/DEPLOYS.md)
// The token and the account id come from the environment and are never written anywhere. The project name is read from pages/wrangler.toml.
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const project = /^name\s*=\s*"([^"]+)"/m.exec(readFileSync(new URL("pages/wrangler.toml", ROOT), "utf8"))?.[1];
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!project || !token || !account) { console.error("needs pages/wrangler.toml (name), CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"); process.exit(2); }
const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}/deployments?per_page=15`, { headers: { authorization: `Bearer ${token}` } });
if (!r.ok) { console.error("Cloudflare answered", r.status); process.exit(3); }
const rows = ((await r.json()).result ?? []).map((d) => ({
  at: String(d.created_on).replace("T", " ").slice(0, 16), env: d.environment, commit: String(d.deployment_trigger?.metadata?.commit_hash ?? "").slice(0, 7) || "-", branch: d.deployment_trigger?.metadata?.branch ?? "-",
  result: d.latest_stage?.status === "success" ? "ok" : String(d.latest_stage?.status ?? "?"), url: d.url,
}));
const md = `# Deploys

What is live, and how to know.

* Open \`/version.json\` on the site. It holds \`commit\` (the git commit the pages were built from), \`dirty\` (true if files differed from that commit), \`builtAt\` (UTC) and \`game\`. It holds nothing else.
* A deploy is made with \`bun run pages:deploy\`: it builds \`pages/public\` (which writes \`version.json\`), then uploads it to the Cloudflare Pages project \`${project}\`. The Worker's database changes are the numbered files in \`apps/edge/migrations\`.
* TEST or LIVE mode (whether real payments are taken) is separate from a deploy: \`GET /api/mode\`.

## Last deploys of \`${project}\`

Read from Cloudflare Pages on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Refresh this table with \`node tools/list-deploys.mjs\` (needs \`CLOUDFLARE_API_TOKEN\` and \`CLOUDFLARE_ACCOUNT_ID\` in the environment).

| Time (UTC) | Environment | Branch | Commit | Result | Deployment |
|---|---|---|---|---|---|
${rows.map((x) => `| ${x.at} | ${x.env} | ${x.branch} | ${x.commit} | ${x.result} | ${x.url} |`).join("\n")}
`;
writeFileSync(new URL("docs/DEPLOYS.md", ROOT), md);
console.log("docs/DEPLOYS.md written:", rows.length, "deploys");
