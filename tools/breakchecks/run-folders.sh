#!/usr/bin/env bash
# Runs every test folder one at a time with `bun test --isolate`, raw logs in results/<tag>/<folder>.log (test author tool).
# usage: tools/breakchecks/run-folders.sh <tag>
set -u
cd "$(dirname "$0")/../.."
TAG="${1:-run}"; OUT="results/$TAG"; mkdir -p "$OUT"
for d in packages/ttt packages/beacon packages/billing tools/control-worker apps/edge apps/web; do
  n="$(echo "$d" | tr '/' '_')"
  echo "== $d" | tee -a "$OUT/_summary.txt"
  bun test --isolate "$d" > "$OUT/$n.log" 2>&1; echo "exit=$?" >> "$OUT/$n.log"
  grep -E "^ *[0-9]+ (pass|fail|skip)|^Ran " "$OUT/$n.log" | tee -a "$OUT/_summary.txt"
done
