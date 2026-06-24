#!/usr/bin/env bash
# DNS warmup for Israeli bank scraper CI.
#
# Forces /etc/resolv.conf to Cloudflare/Google/Quad9 (all of which have
# Tel-Aviv POPs and resolve IL bank authoritative DNS reliably from any
# Azure runner region). Then extracts bank entry hostnames from the
# project's single source of truth — PipelineBankConfig.ts — and warms
# each via `dig +short`. Fails loud (exit 1) if any host doesn't resolve.
#
# Usage:
#   bash .github/scripts/ci/dns-warmup.sh            # warm ALL banks (preflight)
#   bash .github/scripts/ci/dns-warmup.sh Hapoalim   # warm ONLY Hapoalim (matrix)
#
# When a bank name argument is provided (matches the `CompanyTypes`
# enum key exactly — Hapoalim / VisaCal / Amex / etc.), only that
# bank's hostname is extracted from the config and warmed. Used by
# the per-bank matrix jobs so they don't waste cycles resolving the
# other 12 banks they aren't testing. Without an argument, the
# preflight job warms every entry in PipelineBankConfig.ts.
#
# Runs BEFORE `npm install` in CI so the npm package fetch itself
# benefits from the reliable resolver. No Node or TS toolchain
# dependency — bank-host extraction is pure grep+sed against the
# checked-in config file. Adding a new bank requires zero CI edits;
# the script picks it up automatically on the next push.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CONFIG_FILE="${REPO_ROOT}/src/Scrapers/Pipeline/Registry/Config/PipelineBankConfig.ts"

# ── Override resolver ────────────────────────────────────────────
sudo bash -c 'cat > /etc/resolv.conf <<EOF
nameserver 1.1.1.1
nameserver 8.8.8.8
nameserver 9.9.9.9
options timeout:2 attempts:3
EOF'

if ! command -v dig >/dev/null 2>&1; then
  sudo apt-get update -qq && sudo apt-get install -y -qq dnsutils
fi

echo "===Active resolver==="
cat /etc/resolv.conf
echo ""

# ── Extract bank hostnames from PipelineBankConfig.ts ───────────
# Matches lines like:    urls: { base: 'https://www.fibi.co.il' },
# Extracts hostname only (no scheme, no path, no trailing slash).
if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Config file not found: $CONFIG_FILE"
  exit 1
fi

BANK_FILTER="${1:-}"

if [ -n "$BANK_FILTER" ]; then
  # Per-bank matrix mode — extract only the hostname for the named
  # CompanyTypes key. Grep the line with `[CompanyTypes.<Bank>]:`
  # plus the next 2 lines so we catch the `base:` inside the
  # `urls: { base: '...' }` block on the following line.
  # shellcheck disable=SC2207
  HOSTS=($(grep -A 2 "\[CompanyTypes\.${BANK_FILTER}\]" "$CONFIG_FILE" \
           | grep -oE "base:[[:space:]]*'https?://[^/'[:space:]]+" \
           | sed -E "s|.*://||"))
  if [ "${#HOSTS[@]}" -eq 0 ]; then
    echo "❌ No hostname found for CompanyTypes.${BANK_FILTER} in $CONFIG_FILE."
    echo "   Either the bank name is misspelled or the config no longer"
    echo "   uses the [CompanyTypes.<Name>]: { urls: { base: ... } } shape."
    exit 1
  fi
  echo "===Warming up 1 bank host (CompanyTypes.${BANK_FILTER})==="
else
  # Preflight mode — warm every bank in the config.
  # shellcheck disable=SC2207
  HOSTS=($(grep -oE "base:[[:space:]]*'https?://[^/'[:space:]]+" "$CONFIG_FILE" \
           | sed -E "s|.*://||" \
           | sort -u))
  if [ "${#HOSTS[@]}" -eq 0 ]; then
    echo "❌ No bank hostnames extracted from $CONFIG_FILE — config format may have changed."
    echo "   Inspect the file and adjust the grep pattern in this script."
    exit 1
  fi
  echo "===Warming up ${#HOSTS[@]} bank hosts (all from PipelineBankConfig.ts)==="
fi
failed=0
for h in "${HOSTS[@]}"; do
  ok=false
  for i in 1 2 3; do
    # `dig +short` can emit CNAME aliases + `;;` warning lines ahead
    # of the actual A record. Filter to leading-digit lines so we
    # display the resolved IP, not a CNAME chain head.
    ip=$(dig +short +time=3 "$h" 2>/dev/null | grep -E '^[0-9]' | head -1 || true)
    if [ -n "$ip" ]; then
      echo "[OK]    $h -> $ip"
      ok=true
      break
    fi
    echo "[retry] $h (attempt $i)"
    sleep 2
  done
  if [ "$ok" = "false" ]; then
    echo "[FAIL]  $h — did not resolve after 3 attempts"
    failed=$((failed + 1))
  fi
done
echo ""

# ── Azure runner region (diagnostic) ────────────────────────────
echo "===Azure runner region==="
curl -s -m 3 -H Metadata:true \
  "http://169.254.169.254/metadata/instance/compute/location?api-version=2021-02-01&format=text" \
  || echo "(metadata endpoint unreachable — non-Azure or restricted)"
echo ""

# ── Amex/Isracard auth-subdomain reachability (DIAGNOSTIC, non-fatal) ──
# The fail-loud loop above only warms the apex hosts from
# PipelineBankConfig (americanexpress.co.il / isracard.co.il). The live
# login flow actually talks to the web./he. subdomains. The Amex CI
# auth-timeout hypothesis is that web.americanexpress.co.il resolves but
# is unreachable / WAF-blocked from the runner egress IP, while the
# adjacent web.isracard.co.il (GREEN control) is fine. This records the
# resolve + first-hop HTTP status for both so a CI run can classify DNS
# vs reachability vs window-block. It NEVER touches `failed` or the exit
# code — purely informational; Isracard rows are the GREEN control.
echo "===Auth-subdomain reachability (diagnostic, non-fatal)==="
for sub in web.americanexpress.co.il he.americanexpress.co.il web.isracard.co.il he.isracard.co.il; do
  subip=$(dig +short +time=3 "$sub" 2>/dev/null | grep -E '^[0-9]' | head -1 || true)
  status=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "https://${sub}/" 2>/dev/null || true)
  echo "[diag]  ${sub} -> ip=${subip:-UNRESOLVED} http=${status:-NO_RESPONSE}"
done
echo ""

if [ "$failed" -gt 0 ]; then
  echo "❌ DNS warmup FAILED for $failed host(s). Aborting so the failure is"
  echo "   attributable to DNS, not to bank-scrape logic. Subsequent"
  echo "   page.goto() inside Camoufox would also fail with"
  echo "   NS_ERROR_UNKNOWN_HOST."
  exit 1
fi
echo "✅ All Israeli bank hosts resolved successfully. Safe to approve E2E Real."
