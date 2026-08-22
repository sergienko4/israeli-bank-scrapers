#!/usr/bin/env bash
# DNS warmup for Israeli bank scraper CI.
#
# Forces /etc/resolv.conf to Cloudflare/Google/Quad9 (all of which have
# Tel-Aviv POPs and resolve IL bank authoritative DNS reliably from any
# Azure runner region). Then extracts bank hostnames from the project's
# two sources of truth and warms each via `dig +short`. Fails loud
# (exit 1) if any host doesn't resolve.
#
#   PipelineBankConfig*.ts  — each bank's `urls.base` marketing apex.
#   PipelineBankHosts.ts    — the auth/API origins the login handshake
#                             actually talks to (login./web./online./
#                             api. subdomains). Warming the apex alone
#                             left these cold, and a cold lookup inside
#                             Camoufox surfaces as NS_ERROR_UNKNOWN_HOST
#                             — a blank login form that looks like a
#                             scraper bug. Yahav's iframe origin
#                             (login.yahav.co.il) is declared there
#                             because it exists only as a runtime
#                             iframe `src` and is greppable from no
#                             source file.
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
# checked-in config files. Adding a new bank requires zero CI edits;
# the script picks it up automatically on the next push. A new bank
# that talks to an auth/API subdomain declares it in
# PipelineBankHosts.ts, which this script reads the same way.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CONFIG_DIR="${REPO_ROOT}/src/Scrapers/Pipeline/Registry/Config"
CONFIG_FILE="${CONFIG_DIR}/PipelineBankConfig.ts"
HOSTS_FILE="${CONFIG_DIR}/PipelineBankHosts.ts"

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
# Hosts are matched generically as any quoted 'https?://…' inside a
# bank's entry, rather than by enumerating the factory names that
# build it (defineBank / fibiConfig / calConfig / object literal).
# That keeps the zero-CI-edits contract: a new bank, or a new config
# factory, is picked up with no change here. It also captures the
# secondary origins a factory already carries — fibiConfig's
# `postLoginNav` online. host, for example.
if [ ! -f "$CONFIG_FILE" ]; then
  echo "❌ Config file not found: $CONFIG_FILE"
  exit 1
fi

# Both registry files are read with grep/awk before `npm install`, so an
# unreadable one cannot surface as an import error the way it would in
# TypeScript — it just yields nothing. For the manifest that is worse
# than useless: it is the only source for origins no extractor can find
# (Yahav's login iframe), so an empty read would silently shrink the
# warm-up set back to the bug this script exists to prevent.
require_readable() {
  [ -r "$1" ] || { echo "❌ Registry file not readable: $1"; exit 1; }
}

require_readable "$CONFIG_FILE"
require_readable "$HOSTS_FILE"

# Print one bank's whole config entry: every line from its
# `[CompanyTypes.<Bank>]` key up to the next bank key. A fixed
# `grep -A N` window cannot do this — entries range from one line
# (Pagi) to a dozen (Amex), so a short window truncates long entries
# while a long one bleeds the NEXT bank's host into this bank's set.
bank_block() {
  awk -v bank="$1" '
    /\[CompanyTypes\./ { inblock = ($0 ~ ("\\[CompanyTypes\\." bank "\\]")) }
    inblock { print }
  ' "$CONFIG_FILE"
}

# Strip a quoted URL list down to bare hostnames.
to_hostnames() {
  grep -oE "'https?://[^/'[:space:]]+" | sed -E "s|.*://||" | sort -u
}

BANK_FILTER="${1:-}"

# Extra auth/API hosts from PipelineBankHosts.ts. Restricted to lines
# carrying a `[CompanyTypes.X]` key so prose hostnames in the file's
# doc comment (deliberately backticked, never quoted) can never leak
# into the fail-loud set. Any TLD is accepted — pinning the pattern to
# .co.il/.com would silently drop a future .net or .org origin. Pass a
# bank name for one bank, or nothing for every bank. The `|| true`
# covers grep's no-match exit only: a bank with no extra hosts (Max) is
# a valid, empty answer. An unreadable manifest already exited above.
extra_hosts() {
  local key="${1:-[A-Za-z]+}"
  { grep -hE "\[CompanyTypes\.${key}\]" "$HOSTS_FILE" \
      | grep -oE "'[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'" \
      | tr -d "'" \
      | sort -u; } || true
}

if [ -n "$BANK_FILTER" ]; then
  # Per-bank matrix mode — extract only the hostname for the named
  # CompanyTypes key. Grep the line with `[CompanyTypes.<Bank>]:`
  # plus the next 2 lines so we catch either the `base:` inside a
  # `urls: { base: '...' }` block or the `defineBank('https://...')` factory
  # call on the following lines.
  # shellcheck disable=SC2207
  BASE=($(bank_block "$BANK_FILTER" | to_hostnames))
  if [ "${#BASE[@]}" -eq 0 ]; then
    echo "❌ No hostname found for CompanyTypes.${BANK_FILTER} in $CONFIG_FILE."
    echo "   Either the bank name is misspelled or the config no longer"
    echo "   uses the [CompanyTypes.<Name>]: … 'https://…' shape."
    exit 1
  fi
  # Union the marketing apex with this bank's declared auth/API origins.
  # shellcheck disable=SC2207
  HOSTS=($({ printf '%s\n' "${BASE[@]}"; extra_hosts "$BANK_FILTER"; } | sort -u))
  echo "===Warming up ${#HOSTS[@]} host(s) for CompanyTypes.${BANK_FILTER}==="
else
  # Preflight mode — warm every bank in the config.
  # shellcheck disable=SC2207
  BASE=($(to_hostnames < "$CONFIG_FILE"))
  if [ "${#BASE[@]}" -eq 0 ]; then
    echo "❌ No bank hostnames extracted from $CONFIG_FILE — config format may have changed."
    echo "   Inspect the file and adjust the grep pattern in this script."
    exit 1
  fi
  # shellcheck disable=SC2207
  HOSTS=($({ printf '%s\n' "${BASE[@]}"; extra_hosts; } | sort -u))
  echo "===Warming up ${#HOSTS[@]} bank hosts (apex + declared auth/API origins)==="
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

if [ "$failed" -gt 0 ]; then
  echo "❌ DNS warmup FAILED for $failed host(s). Aborting so the failure is"
  echo "   attributable to DNS, not to bank-scrape logic. Subsequent"
  echo "   page.goto() inside Camoufox would also fail with"
  echo "   NS_ERROR_UNKNOWN_HOST."
  exit 1
fi
echo "✅ All Israeli bank hosts resolved successfully. Safe to approve E2E Real."
