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
# NEVER fatal: always exits 0 so it can never turn a green bank red. This
# exit-0 contract is the ONLY non-fatality mechanism — the callers may not
# use `continue-on-error`, which PrYamlGateHardening bans on every E2E-Real
# step (a mask there once hid a real Isracard failure, release PR #172).
#
# The bank host is extracted from the single source of truth
# (PipelineBankConfig.ts), so adding a new bank needs zero edits here.

# NOTE: `-e` is deliberately omitted (every other script in this directory
# uses `set -euo pipefail`). Under `-e` the first failing command — an
# offline origin, a DNS miss — would abort before the final `exit 0` and
# fail the bank's job. A diagnostic must never do that. Non-zero exits are
# absorbed per-command below (`|| echo …` / `|| true`) instead.
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

# Content fingerprint. body_bytes alone cannot distinguish "real homepage",
# "branded decoy" and "JS challenge shell" — they can all be 200. These
# markers identify which one the edge actually served to THIS egress IP.
# Healthy Discount reference (fetched from a clean IL IP):
#   m_html=1 m_title_tag=1 m_script=11 m_login_link=9 m_404=1 m_captcha=0
# Note m_404=1 on the HEALTHY page (the string appears in inline JS), so
# m_404 alone never proves a decoy — read it with head400's template-alias.
#
# `grep -c` prints "0" AND exits 1 on no-match, so a naive `|| echo 0`
# fallback emits the count twice. Capture first, then default.
count_marker() {
  local c
  c="$(grep -ic "$1" /tmp/edge-diag.html 2>/dev/null || true)"
  echo "${c:-0}"
}

echo "m_html=$(count_marker '<html')"
echo "m_title_tag=$(count_marker '<title')"
echo "m_script=$(count_marker '<script')"
echo "m_login_link=$(count_marker 'telebank\|login\|כניסה')"
echo "m_404=$(count_marker '404')"
echo "m_captcha=$(count_marker 'captcha\|challenge\|perimeterx\|datadome\|incapsula\|akamai')"

# First bytes of the body, stripped of newlines and shell-hostile chars so a
# one-line preview survives the CI log. Public homepage HTML only — this
# endpoint is unauthenticated and carries no credentials or PII.
head_preview="$(head -c 400 /tmp/edge-diag.html 2>/dev/null | tr -d '\r\n' | tr -c '[:print:]' ' ' || true)"
echo "head400=${head_preview:-<empty>}"
echo "=== END EDGE DIAGNOSTIC ==="
exit 0
