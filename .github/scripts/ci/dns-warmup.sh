#!/usr/bin/env bash
# DNS warmup for Israeli bank scraper CI.
#
# Forces /etc/resolv.conf to Cloudflare/Google/Quad9 (all of which have
# Tel-Aviv POPs and resolve IL bank authoritative DNS reliably from any
# Azure runner region). Then extracts bank hostnames from the project's
# two sources of truth and warms each via `dig +short`. Fails loud
# (exit 1) if any host doesn't resolve. Then records a non-fatal
# first-hop HTTP status per host, so a run that resolves fine but is
# handed an edge/WAF error page is classifiable from the job log.
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

# Browser-like agent for the reachability diagnostic only. The point of
# the probe is to predict what Camoufox will be served moments later, so
# it must present the same agent class as the engine; a default
# `curl/x.y` agent is a different client to these edges and its status
# would not be comparable. Kept in sync with Camoufox (Firefox).
DIAG_USER_AGENT='Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'

# Report one host's first-hop HTTP status. An origin that answers
# nothing is reported as NO_RESPONSE rather than an empty field, so the
# line is never ambiguous in a job log. curl prints the sentinel `000`
# (not an empty string) when the connection never produced a response,
# so it is normalised here too — otherwise `http=000` would read like a
# status the edge actually returned.
# $1 - hostname to probe.
probe_status() {
  local host="$1" status
  status=$(curl -s -o /dev/null -m 5 -w '%{http_code}' \
    -A "$DIAG_USER_AGENT" "https://${host}/" 2>/dev/null || true)
  if [ "$status" = '000' ]; then status=''; fi
  echo "[diag]  ${host} -> http=${status:-NO_RESPONSE}"
}

# Report one labelled diagnostic field fetched over HTTP. An endpoint
# that fails OR answers empty reports UNKNOWN, never a blank value — a
# blank field is indistinguishable from a field that was never emitted.
# $1   - field label.
# $2.. - curl arguments (including the URL).
report_field() {
  local label="$1" value
  shift
  value=$(curl -s "$@" 2>/dev/null || true)
  echo "${label}=${value:-UNKNOWN}"
}

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

# ── First-hop reachability (diagnostic, non-fatal) ──────────────
# Resolving a name proves DNS works; it does NOT prove the origin will
# serve us the real page. Israeli bank edges intermittently answer our
# CI egress with a branded error page (observed: Discount returned its
# 404 template with an appliance reference ID, from both westus and
# westus3, while the same URL served HTTP 200 to Israeli egress).
# Recording the first-hop status here lets a run be classified as DNS
# vs reachability vs edge-block from the job log alone, instead of
# downloading the forensic bundle to read a screenshot. NEVER touches
# `failed` or the exit code — a bank that blocks this probe but serves
# the browser must not fail the preflight.
echo "===First-hop reachability (diagnostic, non-fatal)==="
for h in "${HOSTS[@]}"; do
  probe_status "$h"
done
echo ""

# ── Runner egress identity (diagnostic) ─────────────────────────
# The region alone does not identify us to a bank edge — reputation is
# scored against the public IP. Two runs in the SAME region have been
# observed to disagree (Discount passed and Isracard failed from one
# westus3 pair), which rules region out as the discriminator and leaves
# the egress address as the one field we never recorded. Logging it
# makes `IP -> outcome` correlatable across runs; without it that
# hypothesis cannot be tested at all. Non-fatal: a blocked lookup must
# never fail the preflight.
echo "===Runner egress identity==="
report_field region -m 3 -H Metadata:true \
  "http://169.254.169.254/metadata/instance/compute/location?api-version=2021-02-01&format=text"
report_field egress_ip -m 5 https://api.ipify.org
echo ""

if [ "$failed" -gt 0 ]; then
  echo "❌ DNS warmup FAILED for $failed host(s). Aborting so the failure is"
  echo "   attributable to DNS, not to bank-scrape logic. Subsequent"
  echo "   page.goto() inside Camoufox would also fail with"
  echo "   NS_ERROR_UNKNOWN_HOST."
  exit 1
fi
echo "✅ All Israeli bank hosts resolved successfully. Safe to approve E2E Real."
