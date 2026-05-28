#!/usr/bin/env bash
# OpenSSF Scorecard hard-fail gate
# ================================
# Reads SCORECARD_THRESHOLD and REQUIREMENTS_FILE from env.
# For every package in $REQUIREMENTS_FILE, looks up its GitHub
# repository via the PyPI JSON API, queries the OSSF Scorecard API,
# and fails the build (exit 1) if any score is below the threshold
# UNLESS the package appears in the SCORECARD_ACCEPTED associative
# array below. Each entry there MUST document the reason and the
# last-reviewed date.
#
# Why this exists: `actions/dependency-review-action` only warns on
# Scorecard regressions (it has no fail-on-scorecard input). For
# production code we want hard failures so a new low-scoring
# dependency blocks merge.

set -euo pipefail

THRESHOLD="${SCORECARD_THRESHOLD:-3.0}"
REQ_FILE="${REQUIREMENTS_FILE:-requirements-docs.txt}"

# Documented exceptions. Format: package name (lowercase) → rationale.
# Adding an entry implies the reviewer accepted the score AND
# documented why no maintained alternative exists. Refresh the
# reviewed date when re-auditing.
declare -A SCORECARD_ACCEPTED=(
  ['ghp-import']='Mandatory transitive of mkdocs (mkdocs>=1.6 hard-requires ghp-import>=1.0). Used by `mkdocs gh-deploy` and indirectly by GitHub-Pages publishing. Last upstream release 2.1.0 in 2022-05-02; low Scorecard reflects maintenance cadence, not a security advisory. No maintained alternative exists (verified PyPI 2026-05-28). License: Apache-2.0.'
)

FAIL=0
CHECKED=0
SKIPPED=0
ACCEPTED=0

# Strip comments/blanks/extras; produce one package name per line.
mapfile -t PKGS < <(grep -vE '^\s*(#|$)' "$REQ_FILE" | sed -E 's/[[:space:]]*([<>=!~].*)?$//' | tr -d '\r')

for raw_pkg in "${PKGS[@]}"; do
  pkg="${raw_pkg,,}"  # lowercase for the ACCEPTED key + Scorecard URL casing
  [ -z "$pkg" ] && continue
  CHECKED=$((CHECKED + 1))

  # 1. Resolve PyPI metadata → GitHub repo URL.
  pypi_json=$(curl -fsS "https://pypi.org/pypi/${raw_pkg}/json" 2>/dev/null || echo '{}')
  repo_url=$(printf '%s' "$pypi_json" | jq -r '
    [
      (.info.project_urls // {}) | to_entries[]? | .value,
      .info.home_page // ""
    ]
    | map(select(test("^https?://github\\.com/[^/]+/[^/]+"; "i")))
    | first // empty
  ')

  if [ -z "$repo_url" ]; then
    echo "::warning::No GitHub repo found in PyPI metadata for '${raw_pkg}' — skipping Scorecard check"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # 2. Extract owner/repo, strip trailing .git/ and any path segments.
  owner_repo=$(printf '%s' "$repo_url" | sed -E 's|^https?://github\.com/||; s|/.*$||; s|/$||')
  owner_repo_full=$(printf '%s' "$repo_url" | sed -E 's|^https?://github\.com/||; s|\.git/?$||; s|#.*$||' | awk -F/ '{print $1"/"$2}')

  if [ -z "$owner_repo_full" ] || ! [[ "$owner_repo_full" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    echo "::warning::Could not parse owner/repo from '${repo_url}' for '${raw_pkg}' — skipping"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # 3. Query Scorecard API. 404 = not yet scanned.
  score_json=$(curl -fsS "https://api.securityscorecards.dev/projects/github.com/${owner_repo_full}" 2>/dev/null || echo '{}')
  score=$(printf '%s' "$score_json" | jq -r '.score // empty')

  if [ -z "$score" ]; then
    echo "::notice::No Scorecard entry for '${raw_pkg}' (github.com/${owner_repo_full}) — uncovered repo"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # 4. Compare score to threshold.
  if awk -v s="$score" -v t="$THRESHOLD" 'BEGIN { exit !(s < t) }'; then
    if [ -n "${SCORECARD_ACCEPTED[$pkg]+_}" ]; then
      echo "::notice::ACCEPTED '${raw_pkg}' score=${score} (threshold=${THRESHOLD}). Reason: ${SCORECARD_ACCEPTED[$pkg]}"
      ACCEPTED=$((ACCEPTED + 1))
    else
      echo "::error::Package '${raw_pkg}' has OpenSSF Scorecard ${score} < ${THRESHOLD} (github.com/${owner_repo_full}). Add an explicit entry to SCORECARD_ACCEPTED in scorecard-hardfail.sh with a documented rationale, or find a higher-scoring alternative."
      FAIL=1
    fi
  else
    echo "  ok: ${raw_pkg} score=${score} (>= ${THRESHOLD})"
  fi
done

echo ""
echo "Summary: checked=${CHECKED} ok=$((CHECKED - SKIPPED - ACCEPTED - FAIL)) accepted=${ACCEPTED} skipped=${SKIPPED} failed=${FAIL}"

if [ "$FAIL" -gt 0 ]; then
  echo "::error::Scorecard hard-fail gate FAILED. See entries above."
  exit 1
fi
