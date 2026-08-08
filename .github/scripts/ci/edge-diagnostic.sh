#!/usr/bin/env bash
# Per-bank edge diagnostic (THROWAWAY — remove once the egress-IP question
# is settled). Prints the runner's public egress IP and what the bank's
# edge returns to THAT IP over a plain HTTP GET (status, body size, title).
#
# Purpose: compare the same bank across Smoke vs E2E-Real jobs (and across
# banks) at the IP level, to prove whether a live-edge failure (e.g. the
# Discount "404" decoy) is egress-IP reputation / anti-bot gating at the
# origin rather than a scraper defect. Each GitHub-hosted job runs on its
# own ephemeral VM with its own egress IP, so this records that IP + the
# origin's response side-by-side.
#
# Usage:
#   bash .github/scripts/ci/edge-diagnostic.sh "$BANK"   # BANK = CompanyTypes key
#
# NEVER fatal: always exits 0 so it can never turn a green bank red. The
# bank host is extracted from the single source of truth
# (PipelineBankConfig.ts) with the same grep/sed shape dns-warmup.sh uses,
# so adding a new bank needs zero edits here.

set -uo pipefail

BANK_FILTER="${1:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CONFIG_FILE="${REPO_ROOT}/src/Scrapers/Pipeline/Registry/Config/PipelineBankConfig.ts"

echo "=== EDGE DIAGNOSTIC: ${BANK_FILTER:-<none>} ==="
echo "egress_ip=$(curl -sS --max-time 15 https://api.ipify.org || echo unknown)"

if [ -z "$BANK_FILTER" ] || [ ! -f "$CONFIG_FILE" ]; then
  echo "host=UNKNOWN (no bank arg or config missing)"
  echo "=== END EDGE DIAGNOSTIC ==="
  exit 0
fi

# Extract the bank's base host (no scheme/path). Take the FIRST https URL in
# the config entry window — robust across all entry shapes in
# PipelineBankConfig.ts: inline `defineBank('https://...')`, wrapper factories
# (`calConfig('https://...')`, `fibiConfig('https://...')`), and object
# `urls: { base: 'https://...' }`. First-URL-wins yields the primary base host.
HOST="$(grep -A 4 "\[CompanyTypes\.${BANK_FILTER}\]" "$CONFIG_FILE" \
        | grep -oE "https?://[^/'[:space:]]+" \
        | head -1 \
        | sed -E 's|^https?://||' || true)"

if [ -z "$HOST" ]; then
  echo "host=UNRESOLVED (no config entry for CompanyTypes.${BANK_FILTER})"
  echo "=== END EDGE DIAGNOSTIC ==="
  exit 0
fi

echo "host=${HOST}"
code="$(curl -sS --max-time 30 -o /tmp/edge-diag.html -w '%{http_code}' -L "https://${HOST}/" || echo 000)"
echo "http_status=${code}"
echo "body_bytes=$(wc -c < /tmp/edge-diag.html 2>/dev/null || echo 0)"
title="$(grep -oiE '<title>[^<]*' /tmp/edge-diag.html 2>/dev/null | head -1 | sed -E 's|<title>||I' || true)"
echo "title=${title:-<none>}"
echo "=== END EDGE DIAGNOSTIC ==="
exit 0
