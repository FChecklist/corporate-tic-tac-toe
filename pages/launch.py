#!/usr/bin/env python3
"""One-shot launch of Corporate Tic Tac Toe on Cloudflare Pages + D1 (free plan, no domain): https://corporate-tic-tac-toe.pages.dev
Needs two environment variables:
  CLOUDFLARE_ACCOUNT_ID   (already set on this laptop)
  CLOUDFLARE_API_TOKEN    must be allowed to edit Cloudflare Pages (the existing token is)
  CLOUDFLARE_D1_TOKEN     optional: a token with  Account > D1 > Edit  (needed once, to create the database and load the schema)
Run from the repo root:  python pages/launch.py
Safe to run again: it reuses what exists. Secrets are generated here, kept in config/platform-key.txt (git-ignored) and never printed."""
import json, os, re, secrets, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
ACC = os.environ["CLOUDFLARE_ACCOUNT_ID"]; TOK = os.environ["CLOUDFLARE_API_TOKEN"]; D1TOK = os.environ.get("CLOUDFLARE_D1_TOKEN", TOK)
os.environ["PATH"] = os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "npm", "node_modules", "bun", "node_modules", "@oven", "bun-windows-x64-baseline", "bin") + os.pathsep + os.environ["PATH"]  # bun/bunx live here on this laptop
PROJECT = "corporate-tic-tac-toe"; DBNAME = "corporate-tic-tac-toe"
def api(method, path, body=None, token=TOK):
    req = urllib.request.Request("https://api.cloudflare.com/client/v4" + path, method=method, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}
def need(ok, msg):
    if not ok: print("STOP:", msg); sys.exit(1)

# 1. the database
s, j = api("GET", f"/accounts/{ACC}/d1/database?name={DBNAME}", token=D1TOK)
need(s == 200, "this token cannot use D1 yet. Create an API token with  Account > D1 > Edit  at https://dash.cloudflare.com/profile/api-tokens and run again with CLOUDFLARE_D1_TOKEN set to it.")
dbs = [d for d in (j.get("result") or []) if d.get("name") == DBNAME]
if dbs: dbid = dbs[0]["uuid"]; print("database exists:", dbid)
else:
    s, j = api("POST", f"/accounts/{ACC}/d1/database", {"name": DBNAME}, token=D1TOK)
    need(s == 200 and j.get("success"), f"could not create the database: {j.get('errors')}")
    dbid = j["result"]["uuid"]; print("database created:", dbid)

# 2. the schema (the migration file is checked against the code by a test)
sql = open(os.path.join(ROOT, "apps/edge/migrations/0001_init.sql"), encoding="utf-8").read()
stmts = [x.strip() for x in re.sub(r"--[^\n]*", "", sql).split(";") if x.strip()]
for st in stmts:
    s, j = api("POST", f"/accounts/{ACC}/d1/database/{dbid}/query", {"sql": st}, token=D1TOK)
    need(s == 200 and j.get("success"), f"schema statement failed: {st[:60]} -> {j.get('errors')}")
print("schema loaded:", len(stmts), "statements")

# 3. the Pages project
s, j = api("GET", f"/accounts/{ACC}/pages/projects/{PROJECT}")
if s != 200:
    s, j = api("POST", f"/accounts/{ACC}/pages/projects", {"name": PROJECT, "production_branch": "main"})
    need(s == 200 and j.get("success"), f"could not create the Pages project: {j.get('errors')}")
    print("pages project created")
sub = (j.get("result") or {}).get("subdomain", PROJECT + ".pages.dev")

# 4. secrets: generated once, kept locally, never printed
keyfile = os.path.join(ROOT, "config", "platform-key.txt"); os.makedirs(os.path.dirname(keyfile), exist_ok=True)
if os.path.exists(keyfile): kv = dict(l.split("=", 1) for l in open(keyfile).read().split() if "=" in l)
else:
    kv = {"ORGANIZER_SECRET": "cbp_" + secrets.token_hex(24), "PHONE_SALT": secrets.token_hex(24)}
    open(keyfile, "w").write("".join(f"{k}={v}\n" for k, v in kv.items())); print("platform key written to config/platform-key.txt (git-ignored)")
toml = open(os.path.join(HERE, "wrangler.toml"), encoding="utf-8").read()
company = re.search(r"^COMPANY_JSON = '(.*)'\s*$", toml, re.M).group(1)
plain = {"DAILY_WRITE_BUDGET": "80000", "PUBLIC_ORIGIN": "https://" + sub, "MAIL_FROM": "Corporate Tic Tac Toe <hello@corporatetambola.com>", "COMPANY_JSON": company}
cfg = {"compatibility_date": "2026-09-01", "compatibility_flags": ["nodejs_compat"], "d1_databases": {"DB": {"id": dbid}},
       "env_vars": {**{k: {"type": "plain_text", "value": v} for k, v in plain.items()}, **{k: {"type": "secret_text", "value": v} for k, v in kv.items()}}}
s, j = api("PATCH", f"/accounts/{ACC}/pages/projects/{PROJECT}", {"deployment_configs": {"production": cfg, "preview": cfg}})
need(s == 200 and j.get("success"), f"could not set the project's settings: {j.get('errors')}")
print("project settings and secrets set (payments stay OFF until Razorpay keys are added)")

# 5. deploy
new_toml = re.sub(r'database_id = "[^"]*"', f'database_id = "{dbid}"', toml)
open(os.path.join(HERE, "wrangler.toml"), "w", encoding="utf-8", newline="").write(new_toml)
subprocess.run("bun run pages/build.mjs", cwd=ROOT, shell=True, check=True)
r = subprocess.run("bun x wrangler@3 pages deploy public --project-name %s --branch main --commit-dirty=true" % PROJECT, cwd=HERE, shell=True)
need(r.returncode == 0, "deploy failed")

# 6. smoke test of the live site
time.sleep(15)
base = "https://" + sub
def get(path):
    try:
        with urllib.request.urlopen(urllib.request.Request(base + path, headers={"User-Agent": "launch"}), timeout=30) as r: return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e: return e.code, ""
for path, want in [("/", "Bingo"), ("/z.html", "Loading"), ("/zc.html", "Organizer"), ("/partner.html", "Refer"), ("/api/z/ai-manifest", "organizer API"), ("/api/payments/status", '"mode"')]:
    st, body = get(path); print(("ok  " if st == 200 and want.lower() in body.lower() else "FAIL"), path, st)
print("LIVE:", base, "| organizer page:", base + "/zc.html | platform key is in config/platform-key.txt")
