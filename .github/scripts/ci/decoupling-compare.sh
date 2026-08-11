#!/usr/bin/env bash
# Compares two decoupling snapshots and decides whether the PR loosened the
# architecture or weakened its safety net.
#
# Why compare against the merge base instead of the committed baseline: the
# baseline snapshot is a rolling reference that is only refreshed by hand, so
# it drifts behind main. Diffing against a stale baseline measures everything
# merged since it was taken, not what this PR did. The merge base is exact and
# never needs maintenance.
#
# Two kinds of check, deliberately different in nature:
#
#   Ratchets    guardrails may get stronger, never weaker. A new import cycle,
#               a new `any`, a deleted canary or a deleted ESLint rule fails
#               the gate outright. There is no tolerance band, because "a
#               little bit weaker" is how a guardrail dies.
#
#   Tolerance   average runtime fan-out may drift within THRESHOLD_PCT. Files
#               and edges legitimately grow when a feature lands; what must
#               not happen is new code being markedly more coupled than the
#               code already there.
#
# Every input arrives through the environment so the verdict can be exercised
# locally without measuring anything:
#
#   BASE_SNAPSHOT=base.json HEAD_SNAPSHOT=head.json \
#   GITHUB_STEP_SUMMARY=/dev/stdout bash .github/scripts/ci/decoupling-compare.sh
#
# Exit codes:
#   0  no regression, or the base side was not measurable (reported, never blocking)
#   1  a ratchet went backwards, or fan-out grew by more than THRESHOLD_PCT
#   2  a snapshot exists but could not be parsed (a broken tool, not a skip)
set -euo pipefail

: "${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY must be set}"

BASE_SNAPSHOT="${BASE_SNAPSHOT:-}"
HEAD_SNAPSHOT="${HEAD_SNAPSHOT:-}"
THRESHOLD_PCT="${THRESHOLD_PCT:-10}"

# A snapshot that was never written means the measurement could not run — the
# base tree may be unavailable on a PR that is not cleanly mergeable. That is
# reported but must not block, exactly as the memory gate does.
if [ ! -r "$BASE_SNAPSHOT" ] || [ ! -r "$HEAD_SNAPSHOT" ]; then
  {
    echo "## 🧩 Decoupling: not measured"
    echo ""
    echo "One side could not be measured, so no comparison was made. This does"
    echo "not block the PR — see the job log for why the snapshot is missing."
  } >> "$GITHUB_STEP_SUMMARY"
  echo "::notice::Decoupling metric skipped - base=${BASE_SNAPSHOT:-unset} head=${HEAD_SNAPSHOT:-unset}"
  exit 0
fi

# Distinct from the skip above: the file is present but unreadable as JSON,
# which means the measuring tool produced garbage. Silently skipping there
# would disable the gate the moment it broke.
#
# This reports failure through the return status rather than calling `exit`:
# every caller runs inside `$( )`, and an `exit` there would only leave the
# subshell, letting the script continue with an empty value and pass.
read_metric() {
  local value
  if ! value=$(jq -er "$2" "$1" 2>/dev/null); then
    echo "::error::Could not read ${2} from ${1} - the snapshot is not valid JSON." >&2
    return 1
  fi
  printf '%s\n' "$value"
}

# name | jq path | direction | label
#   up   = an increase is a regression
#   down = a decrease is a regression
RATCHETS=(
  "cycles|.cycles.count|up|Runtime import cycles"
  "any|.guardrails.anyUsages|up|\`any\` usages"
  "canaries|.guardrails.canaries|down|ESLint canaries"
  "rules|.guardrails.eslintRules|down|ESLint rules"
)

failures=()
rows=()

delta_of() {
  local d=$(($2 - $1))
  if [ "$d" -eq 0 ]; then
    echo "—"
  elif [ "$d" -gt 0 ]; then
    echo "+$d"
  else
    echo "$d"
  fi
}

regressed() {
  case "$3" in
    up) [ "$2" -gt "$1" ] ;;
    down) [ "$2" -lt "$1" ] ;;
    *) return 1 ;;
  esac
}

for entry in "${RATCHETS[@]}"; do
  IFS='|' read -r _name path direction label <<< "$entry"
  base=$(read_metric "$BASE_SNAPSHOT" "$path") || exit 2
  head=$(read_metric "$HEAD_SNAPSHOT" "$path") || exit 2
  if regressed "$base" "$head" "$direction"; then
    rows+=("| ${label} | ${base} | ${head} | $(delta_of "$base" "$head") | ❌ |")
    failures+=("${label}: ${base} → ${head}")
  else
    rows+=("| ${label} | ${base} | ${head} | $(delta_of "$base" "$head") | ✅ |")
  fi
done

base_fanout=$(read_metric "$BASE_SNAPSHOT" ".runtimeSummary.avgFanOut") || exit 2
head_fanout=$(read_metric "$HEAD_SNAPSHOT" ".runtimeSummary.avgFanOut") || exit 2
# bash cannot compare floats, and average fan-out is a ratio, so awk decides.
# A zero base would make the percentage undefined; treat it as no signal.
pct=$(awk -v b="$base_fanout" -v h="$head_fanout" \
  'BEGIN { if (b <= 0) { print "na"; exit } printf "%.1f", ((h - b) * 100) / b }')
# The verdict reads the raw ratio, never `pct`. `pct` is rounded to one decimal
# for display, so a genuine 10.04% rise prints as "10.0" and would slip under a
# 10% limit. Comparing by multiplication also avoids a second division.
over=$(awk -v b="$base_fanout" -v h="$head_fanout" -v t="$THRESHOLD_PCT" \
  'BEGIN {
     if (b <= 0) { print "no"; exit }
     print (((h - b) * 100) > (b * t)) ? "yes" : "no"
   }')

if [ "$over" = "yes" ]; then
  rows+=("| Avg runtime fan-out | ${base_fanout} | ${head_fanout} | ${pct}% | ❌ |")
  failures+=("average runtime fan-out grew ${pct}% (limit ${THRESHOLD_PCT}%)")
else
  rows+=("| Avg runtime fan-out | ${base_fanout} | ${head_fanout} | ${pct}% | ✅ |")
fi

# Context, not verdicts: these move whenever code is added and are here to
# explain the numbers above rather than to judge them.
for context in "Files|.summary.files" "Runtime edges|.runtimeSummary.edges"; do
  IFS='|' read -r label path <<< "$context"
  base=$(read_metric "$BASE_SNAPSHOT" "$path") || exit 2
  head=$(read_metric "$HEAD_SNAPSHOT" "$path") || exit 2
  rows+=("| ${label} | ${base} | ${head} | $(delta_of "$base" "$head") | · |")
done

if [ ${#failures[@]} -gt 0 ]; then
  heading="## ❌ Decoupling: regression"
  verdict="This PR loosened the architecture or weakened a guardrail."
else
  heading="## ✅ Decoupling: no regression"
  verdict="No guardrail weakened and coupling stayed within tolerance."
fi

{
  echo "$heading"
  echo ""
  echo "$verdict"
  echo ""
  echo "| Metric | Merge base | This PR | Δ | |"
  echo "| --- | ---: | ---: | ---: | :-: |"
  printf '%s\n' "${rows[@]}"
  echo ""
  echo "Guardrail rows are ratchets — they may improve but never regress."
  echo "Fan-out tolerates ${THRESHOLD_PCT}% drift. Rows marked \`·\` are context only."
} >> "$GITHUB_STEP_SUMMARY"

if [ ${#failures[@]} -gt 0 ]; then
  for failure in "${failures[@]}"; do
    echo "::error::Decoupling regression - ${failure}"
  done
  exit 1
fi

echo "Decoupling: no regression (fan-out ${pct}%, limit ${THRESHOLD_PCT}%)."
