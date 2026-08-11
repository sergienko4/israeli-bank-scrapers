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
# Usage:
#   bash .github/scripts/ci/memory-measure.sh <workdir>
#
# Prints the peak in whole MB to stdout, or `unavailable` when the workload
# could not be measured. Never exits non-zero for a failed workload: this is
# a metric, and the suites themselves are gated by other jobs.
set -uo pipefail

WORKDIR="${1:?usage: memory-measure.sh <workdir>}"
WORKLOAD="${MEMORY_WORKLOAD:-test:memory}"
SAMPLES="${MEMORY_SAMPLES:-2}"
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
  rm -f "$report"

  if [ "$status" -ne 0 ]; then
    log "sample $i: workload exited $status - discarding"
    continue
  fi
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
