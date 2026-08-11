#!/usr/bin/env bash
# Compares the peak memory of this PR against its merge base and decides
# whether the change is a regression.
#
# Why compare against the base instead of a fixed ceiling: peak RSS depends
# on the runner's CPU count, kernel and Node build, so an absolute MB budget
# drifts and eventually fails for reasons that have nothing to do with the
# PR. Both sides are measured on the same runner in the same job, so the
# machine cancels out and only the change itself is left.
#
# Every input arrives through the environment so the verdict can be
# exercised locally without running a test suite:
#
#   BASE_MB=400 HEAD_MB=520 THRESHOLD_PCT=10 \
#   GITHUB_STEP_SUMMARY=/dev/stdout bash .github/scripts/ci/memory-compare.sh
#
# Exit codes:
#   0  within budget, or not measurable (reported, never blocking)
#   1  peak memory grew by more than THRESHOLD_PCT
set -euo pipefail

: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY must be set}"

BASE_MB="${BASE_MB:-unavailable}"
HEAD_MB="${HEAD_MB:-unavailable}"
THRESHOLD_PCT="${THRESHOLD_PCT:-10}"
WORKLOAD="${MEMORY_WORKLOAD:-test:memory}"

is_measured() { [ -n "$1" ] && [ "$1" != "unavailable" ] && [ "$1" != "0" ]; }

fmt() { if is_measured "$1"; then echo "${1} MB"; else echo "n/a"; fi; }

# A measurement that never happened must not be reported as a 0 MB win, and
# must not fail the PR either: the tests themselves are gated by other jobs,
# so a missing number here means this metric could not run, nothing more.
if ! is_measured "$BASE_MB" || ! is_measured "$HEAD_MB"; then
  {
    echo "## 🧠 Memory: not measured"
    echo ""
    echo "| Side | Peak RSS |"
    echo "| --- | --- |"
    echo "| Merge base | $(fmt "$BASE_MB") |"
    echo "| This PR | $(fmt "$HEAD_MB") |"
    echo ""
    echo "One side could not be measured, so no comparison was made. This does"
    echo "not block the PR — see the job log for why the workload did not run."
  } >> "$GITHUB_STEP_SUMMARY"
  echo "::notice::Memory metric skipped - base=${BASE_MB} head=${HEAD_MB}"
  exit 0
fi

delta=$((HEAD_MB - BASE_MB))
# bash has no float arithmetic, and a percentage rounded to a whole number
# hides small drifts near the threshold, so awk does the division.
pct=$(awk -v d="$delta" -v b="$BASE_MB" 'BEGIN { printf "%.1f", (d * 100) / b }')
# The verdict deliberately uses the unrounded values: comparing the formatted
# percentage lets a real regression of 10.04% print as "10.0" and slip under a
# 10% limit.
over=$(awk -v d="$delta" -v b="$BASE_MB" -v t="$THRESHOLD_PCT" \
  'BEGIN { print ((d * 100) > (b * t)) ? "yes" : "no" }')

if [ "$over" = "yes" ]; then
  heading="## ❌ Memory: regression"
  verdict="Peak memory grew **${pct}%** (limit ${THRESHOLD_PCT}%)."
elif [ "$delta" -lt 0 ]; then
  heading="## ✅ Memory: improved"
  verdict="Peak memory fell by **${pct#-}%**."
else
  heading="## ✅ Memory: within budget"
  verdict="Peak memory changed by **${pct}%** (limit ${THRESHOLD_PCT}%)."
fi

{
  echo "$heading"
  echo ""
  echo "$verdict"
  echo ""
  echo "| Side | Peak RSS |"
  echo "| --- | --- |"
  echo "| Merge base | ${BASE_MB} MB |"
  echo "| This PR | ${HEAD_MB} MB |"
  echo "| Delta | ${delta} MB (${pct}%) |"
  echo ""
  echo "Largest resident set size reached by any single process in the"
  echo "\`npm run ${WORKLOAD}\` tree, including Jest workers, rather than the sum"
  echo "of concurrent ones. Both sides run on this same runner, so the"
  echo "comparison reflects the change rather than the machine."
} >> "$GITHUB_STEP_SUMMARY"

if [ "$over" = "yes" ]; then
  echo "::error::Peak memory grew ${pct}% (${BASE_MB} MB -> ${HEAD_MB} MB), limit ${THRESHOLD_PCT}%."
  exit 1
fi

echo "Memory delta ${pct}% (${BASE_MB} MB -> ${HEAD_MB} MB), limit ${THRESHOLD_PCT}%."
