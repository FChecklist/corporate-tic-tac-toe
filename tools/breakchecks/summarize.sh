#!/usr/bin/env bash
# Builds results/breakchecks/_summary.txt from the per-break logs (one RESULT line each) plus the green / RED / green counts.
cd "$(dirname "$0")/../.." || exit 1
out=results/breakchecks/_summary.txt; : > "$out"
for f in tools/breakchecks/bc*.mjs; do
  id="$(basename "$f" .mjs)"; log="results/breakchecks/$id.log"
  if [ -f "$log" ]; then
    a=$(grep -E '^  A\.' "$log" | sed -E 's/.*exit ([0-9]+) +([0-9]+) pass +([0-9]+) fail/exit\1 \2p\/\3f/'); b=$(grep -E '^     result:' "$log" | sed -E 's/.*exit ([0-9]+) +([0-9]+) pass +([0-9]+) fail/exit\1 \2p\/\3f/'); c=$(grep -E '^  C\.' "$log" | sed -E 's/.*exit ([0-9]+) +([0-9]+) pass +([0-9]+) fail/exit\1 \2p\/\3f/')
    echo "$(grep -E '^RESULT' "$log" | tail -1) | green: $a | RED: $b | restored: $c" >> "$out"
  else echo "RESULT $id: NOT RUN" >> "$out"; fi
done
echo "OK: $(grep -c ': OK' "$out")  NOT OK: $(grep -c 'NOT OK\|NOT RUN' "$out")  TOTAL: $(ls tools/breakchecks/bc*.mjs | wc -l)" | tee -a "$out"
