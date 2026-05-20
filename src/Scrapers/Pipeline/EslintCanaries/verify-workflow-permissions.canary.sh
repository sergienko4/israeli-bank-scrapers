#!/usr/bin/env bash
# Canary — closes spec.txt §1 RC-2 (TokenPermissionsID).
#
# Scans the supplied YAML file for a top-level `permissions:` block.
# Exits 0 when present, non-zero when absent. The harness
# (verify.sh) runs this against both the accepted fixture (must pass)
# and the rejected fixture (must fail).
#
# Applicable guidelines (per spec.txt §1 RC-2):
#   - coding-principle-guidlines.md §2 — PoLP (Principle of Least
#     Privilege)
#   - coding-principle-guidlines.md §3 — Defense in Depth
#   - before-commit-guidlines.md §2 — Never weaken validation or
#     thresholds.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <workflow.yml>" >&2
  exit 2
fi

FILE="$1"
if [[ ! -f "$FILE" ]]; then
  echo "fixture not found: $FILE" >&2
  exit 2
fi

# A top-level permissions block is a line that starts with the literal
# `permissions:` followed by either nothing, a value, or `{}`. Indented
# lines are job-scoped; the regex anchors at the line start.
if grep -Eq '^permissions:' "$FILE"; then
  exit 0
fi
exit 1
