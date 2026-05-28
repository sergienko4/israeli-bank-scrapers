#!/usr/bin/env bash
# Detect which file groups this PR / push changed.
# ================================================
# Inputs (from env, set by pr.yml validate job):
#   BASE_SHA — the merge-base on the PR target branch, or the SHA
#              before the push on a push-to-main event.
#
# Outputs (written to $GITHUB_OUTPUT, consumed by step-level `if:`
#          guards in pr.yml and by `needs.validate.outputs.*` on
#          downstream jobs):
#   src         — any file under `src/` was modified
#   md          — any `*.md` was modified
#   docs        — `docs/**`, `mkdocs.yml`, or `requirements-docs.txt`
#                 was modified (drives the mkdocs strict-build step)
#   pipeline_ts — `src/Scrapers/Pipeline/**/*.ts` was modified
#                 (drives the docs-coverage canary)
#
# Why one detector instead of `paths:` filters per workflow:
# Workflow-level `paths:` filters skip the WHOLE workflow on path
# mismatch, which loses the required-status-check context. Folding
# the detection into a step lets the workflow always fire (satisfying
# branch protection) while still skipping the expensive lint/tsc/build/
# test chain when nothing under src/ was touched. See pr.yml header
# comment for the migration notes.
#
# On `push: main` the `BASE_SHA` value is `github.event.before`. On
# the very first push to a brand-new branch that value is the all-zero
# sentinel; treat that as "no base" and assume every group changed
# (full validate) — better to over-run than to silently skip.

set -euo pipefail

ZERO_SHA="0000000000000000000000000000000000000000"

if [ -z "${BASE_SHA:-}" ] || [ "${BASE_SHA}" = "${ZERO_SHA}" ]; then
  echo "[detect-changes] No usable BASE_SHA — assuming all groups touched (full validate)."
  {
    echo "src=true"
    echo "md=true"
    echo "docs=true"
    echo "pipeline_ts=true"
  } >> "$GITHUB_OUTPUT"
  exit 0
fi

# Fetch the base ref if it isn't reachable from the merge commit.
# `actions/checkout` with `fetch-depth: 0` should have pulled the
# full history, but PR merge commits sometimes need an explicit
# fetch to resolve the base.
if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  echo "[detect-changes] BASE_SHA ${BASE_SHA} not local; fetching." >&2
  git fetch --no-tags --depth 1 origin "${BASE_SHA}" 2>/dev/null || true
fi

# `...HEAD` (three dots) compares HEAD against the merge-base with
# BASE_SHA, which is what we want for PRs: files the PR added/changed,
# not files main moved meanwhile.
changed_files=$(git diff --name-only "${BASE_SHA}...HEAD" 2>/dev/null || \
                git diff --name-only "${BASE_SHA}" HEAD 2>/dev/null || \
                echo "")

if [ -z "${changed_files}" ]; then
  echo "[detect-changes] No changed files between BASE_SHA and HEAD — leaving all flags false."
  {
    echo "src=false"
    echo "md=false"
    echo "docs=false"
    echo "pipeline_ts=false"
  } >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "[detect-changes] ${BASE_SHA:0:12}...HEAD changed files:"
# Quote the expansion (shellcheck SC2086): paths with spaces or
# glob chars would otherwise be word-split / globbed by printf.
while IFS= read -r file; do
  [ -z "${file}" ] && continue
  printf '  - %s\n' "${file}"
done <<< "${changed_files}"
echo

has() {
  printf '%s\n' "${changed_files}" | grep -qE "$1"
}

src=false
md=false
docs=false
pipeline_ts=false

if has '^src/'; then src=true; fi
if has '\.md$'; then md=true; fi
if has '^docs/|^mkdocs\.yml$|^requirements-docs\.txt$'; then docs=true; fi
if has '^src/Scrapers/Pipeline/.*\.ts$'; then pipeline_ts=true; fi

{
  echo "src=${src}"
  echo "md=${md}"
  echo "docs=${docs}"
  echo "pipeline_ts=${pipeline_ts}"
} >> "$GITHUB_OUTPUT"

echo "[detect-changes] decisions:"
echo "  src=${src}"
echo "  md=${md}"
echo "  docs=${docs}"
echo "  pipeline_ts=${pipeline_ts}"
