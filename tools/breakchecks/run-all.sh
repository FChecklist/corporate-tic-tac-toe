#!/usr/bin/env bash
# Runs every planted-break script one after the other. Output: results/breakchecks/<id>.log and results/breakchecks/_summary.txt
cd "$(dirname "$0")/../.." || exit 1
export BC_SCRATCH="${BC_SCRATCH:-/tmp/breakchecks}"
mkdir -p results/breakchecks; : > results/breakchecks/_summary.txt
for f in tools/breakchecks/bc*.mjs; do
  id="$(basename "$f" .mjs)"
  bun "$f" > /dev/null 2>&1; code=$?
  line="$(grep -E '^RESULT' "results/breakchecks/$id.log" | tail -1)"
  echo "${line:-RESULT $id: NOT OK (no result line, exit $code)}" | tee -a results/breakchecks/_summary.txt
done
echo "OK: $(grep -c ': OK' results/breakchecks/_summary.txt)  NOT OK: $(grep -c 'NOT OK' results/breakchecks/_summary.txt)" | tee -a results/breakchecks/_summary.txt
