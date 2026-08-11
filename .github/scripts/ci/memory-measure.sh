#!/usr/bin/env bash
# Measures the peak resident set size of an npm workload, including every
# Jest worker it spawns.
#
# Why GNU time and not `process.memoryUsage()`: Jest runs the suite in
# worker subprocesses, so a number sampled inside the parent Node process
# would miss where the memory actually goes. `/usr/bin/time -v` reports the
# maximum RSS across the process and all of its waited-for children, which
# is the figure a maintainer cares about when CI runs out of memory.
#
# The workload is run more than once and the SMALLEST peak is kept. Peak RSS
# is noisy upward (GC timing, page-cache pressure, a slow worker start), and
# never noisy downward, so the minimum is the most stable estimator of the
# workload's true footprint.
#
# Observed on ubuntu-24.04: the first sample lands ~30% above the rest on
# both sides of the comparison, a cold-start effect. Taking the minimum
# discards it, which is why more than two samples are worth the seconds -
# with two, only one warm reading survives.
#
# Usage:
#   bash .github/scripts/ci/memory-measure.sh <workdir>
#
# Prints the peak in whole MB to stdout, or `unavailable` when the workload
# could not be measured. Never exits non-zero for a failed workload: this is
# a metric, and the suites themselves are gated by other jobs.
#
# `errexit` is deliberately absent. Every failure path here degrades to
# "unavailable" on purpose, and aborting mid-script would turn an unmeasurable
# sample into a failed job — the opposite of the contract above.
set -uo pipefail

WORKDIR="${1:?usage: memory-measure.sh <workdir>}"
WORKLOAD="${MEMORY_WORKLOAD:-test:memory}"
SAMPLES="${MEMORY_SAMPLES:-3}"
TIME_BIN="${TIME_BIN:-/usr/bin/time}"

log() { echo "[memory-measure] $*" >&2; }

if [ ! -d "$WORKDIR" ]; then
  log "no such directory: $WORKDIR"
  echo "unavailable"
  exit 0
fi

if [ ! -x "$TIME_BIN" ]; then
  log "GNU time not found at $TIME_BIN - cannot measure"
  echo "unavailable"
  exit 0
fi

# A base revision predating this metric will not define the workload script,
# and that must degrade to "unmeasured" rather than looking like 0 MB.
has_script() {
  node -e 'const p=require("node:fs").readFileSync(process.argv[1],"utf8");
           const s=JSON.parse(p).scripts||{};
           process.exit(s[process.argv[2]]?0:1);' \
    "$WORKDIR/package.json" "$WORKLOAD" 2>/dev/null
}

if [ ! -f "$WORKDIR/package.json" ] || ! has_script; then
  log "npm script '$WORKLOAD' is not defined in $WORKDIR"
  echo "unavailable"
  exit 0
fi

best=""
for i in $(seq 1 "$SAMPLES"); do
  report="$(mktemp)"
  # GNU time writes its report to stderr, which is captured here along with
  # whatever the workload logs there. Parsing targets the one labelled line
  # rather than assuming the file holds only the report.
  (cd "$WORKDIR" && "$TIME_BIN" -v npm run "$WORKLOAD" >/dev/null) 2> "$report"
  status=$?

  # "Maximum resident set size (kbytes): 1234567"
  kb="$(awk -F': ' '/Maximum resident set size/ { print $2; exit }' "$report")"

  if [ "$status" -ne 0 ]; then
    log "sample $i: workload exited $status - discarding"
    # Without this the failure reason dies with the report file, leaving a
    # maintainer with a discarded sample and no way to tell why.
    log "--- last 20 lines of workload output ---"
    tail -n 20 "$report" >&2
    rm -f "$report"
    continue
  fi
  rm -f "$report"

  if ! [[ "$kb" =~ ^[0-9]+$ ]]; then
    log "sample $i: could not parse peak RSS - discarding"
    continue
  fi

  mb=$((kb / 1024))
  log "sample $i: ${mb} MB"
  if [ -z "$best" ] || [ "$mb" -lt "$best" ]; then best="$mb"; fi
done

if [ -z "$best" ]; then
  log "no usable sample from $SAMPLES attempt(s)"
  echo "unavailable"
  exit 0
fi

log "peak (min of $SAMPLES): ${best} MB"
echo "$best"
