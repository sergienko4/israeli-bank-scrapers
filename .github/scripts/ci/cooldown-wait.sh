#!/usr/bin/env bash
# cooldown-wait.sh — enforce a minimum wall-clock gap between same-bank
# E2E Real runs to let bank WAFs' per-account behavioural risk scores
# decay (typical decay window: 15–60 min). Used after actions/cache
# restores the previous-run timestamp into $TIMESTAMP_FILE.
#
# Why: Hapoalim WAF escalated to hCaptcha image-puzzle after 5+
# consecutive GitHub-Actions Azure-IP sessions in 3h (2026-06-03
# investigation, run 26873120635 vs 26865300560). The escalation
# blocks login even when Camoufox solves the visible checkbox. A
# 10-minute gap between sessions was sufficient in manual testing
# to keep the risk score below the escalation threshold.
#
# Usage:
#   bash .github/scripts/ci/cooldown-wait.sh <Bank> [min-gap-seconds]
#
# Behaviour:
#   - Reads the last-run UNIX timestamp from /tmp/cooldown-<Bank>.txt.
#   - If the gap since LAST is < MIN_GAP, sleeps for the remainder.
#   - Writes the current timestamp to the file AFTER waiting so the
#     measured interval is "last bank session start → this bank
#     session start" (per rubber-duck #5).
#   - Cold-start (no file) behaves as "0 seconds ago" = immediate run.
#
# Exit codes:
#   0  always (cooldown is a quality-of-service measure, not a hard
#      gate — never fail CI because of timing).

set -euo pipefail

BANK="${1:?usage: cooldown-wait.sh <Bank> [min-gap-seconds]}"
MIN_GAP="${2:-600}"
TIMESTAMP_FILE="/tmp/cooldown-${BANK}.txt"

NOW=$(date +%s)
LAST=$(cat "$TIMESTAMP_FILE" 2>/dev/null || echo 0)

# Guard against malformed cache content (non-numeric / negative).
case "$LAST" in
  ''|*[!0-9]*) LAST=0 ;;
esac

GAP=$((NOW - LAST))
if [ "$LAST" -gt 0 ] && [ "$GAP" -lt "$MIN_GAP" ]; then
  WAIT=$((MIN_GAP - GAP))
  echo "::notice title=Cooldown::${BANK} ran ${GAP}s ago — sleeping ${WAIT}s to let WAF risk score decay (min gap ${MIN_GAP}s)"
  sleep "$WAIT"
else
  echo "::notice title=Cooldown::${BANK} cooldown OK (gap=${GAP}s, min=${MIN_GAP}s, last=${LAST})"
fi

# Persist the current bank-contact start time AFTER the wait so the
# next run measures session-start → session-start.
date +%s > "$TIMESTAMP_FILE"
