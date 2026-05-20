#!/usr/bin/env bash
# Canary — closes spec.txt §1 RC-4 (PinnedDependenciesID for npm
# commands in workflow run blocks).
#
# Scans the supplied workflow YAML for `npm install -g npm@<version>`
# invocations that omit `--audit-signatures`. Exits 0 when every npm
# install carries the signature flag (or there is no npm install at
# all), non-zero when any npm install runs without it. The harness
# runs this against both the accepted fixture (must pass) and the
# rejected fixture (must fail).
#
# Applicable guidelines (per spec.txt §1 RC-4):
#   - coding-principle-guidlines.md §11 — Dependency Security.
#   - dependency-updates-guidlines.md — version pinning policy.
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

# Every `npm install -g npm@...` line must include `--audit-signatures`.
NPM_LINES="$(grep -E 'npm install +-g +npm@' "$FILE" || true)"
if [[ -z "$NPM_LINES" ]]; then
  # No npm install line — nothing to pin.
  exit 0
fi

while IFS= read -r line; do
  if [[ ! "$line" =~ --audit-signatures ]]; then
    exit 1
  fi
done <<< "$NPM_LINES"

exit 0
