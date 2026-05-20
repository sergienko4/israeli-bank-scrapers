#!/usr/bin/env bash
# Canary — closes spec.txt §1 RC-3 (PinnedDependenciesID for container
# images).
#
# Scans the supplied Dockerfile for `FROM <image>@sha256:<digest>`.
# Exits 0 when every FROM line carries a digest, non-zero when any
# FROM lacks the digest. The harness runs this against both the
# accepted fixture (must pass) and the rejected fixture (must fail).
#
# Applicable guidelines (per spec.txt §1 RC-3):
#   - coding-principle-guidlines.md §11 — Dependency Security:
#     "Continuously scan dependencies for vulnerabilities."
#   - dependency-updates-guidlines.md — Dependabot integration policy.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <Dockerfile>" >&2
  exit 2
fi

FILE="$1"
if [[ ! -f "$FILE" ]]; then
  echo "fixture not found: $FILE" >&2
  exit 2
fi

# Every non-comment FROM line must carry `@sha256:<64-hex>`. Match
# case-insensitively because Dockerfile keywords are not case-sensitive
# per the spec (`from`, `From`, `FROM` are all valid); the canary must
# catch unpinned bases regardless of how the directive is written.
FROM_LINES="$(grep -iE '^FROM ' "$FILE" || true)"
if [[ -z "$FROM_LINES" ]]; then
  # No FROM line at all — accept (nothing to pin).
  exit 0
fi

while IFS= read -r line; do
  if [[ ! "$line" =~ @sha256:[0-9a-f]{64} ]]; then
    exit 1
  fi
done <<< "$FROM_LINES"

exit 0
