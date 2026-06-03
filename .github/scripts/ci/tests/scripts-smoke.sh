#!/usr/bin/env bash
# scripts-smoke.sh — smoke tests for the CI cooldown + token-cache
# bash helpers. Designed to run on the GitHub-Actions ubuntu-latest
# image (bash 5, gpg 2.4, shellcheck preinstalled).
#
# Why a separate smoke script (not jest): the helpers are pure-bash
# CI-glue with no node deps. The smoke runs ALL three helpers
# end-to-end so any regression in stdin/fd-3 wiring, env propagation,
# or GPG flag drift is caught pre-merge.
#
# Usage (called from CI in `pr.yml` validate job):
#   bash .github/scripts/ci/tests/scripts-smoke.sh
#
# Exit codes:
#   0  all assertions passed
#   1  any assertion failed

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
    echo "  ✓ ${name}"
  else
    FAIL=$((FAIL + 1))
    echo "  ✗ ${name}"
    echo "    expected: ${expected}"
    echo "    actual:   ${actual}"
  fi
}

# ── 1. shellcheck ──
echo "── 1/4: shellcheck ──"
if command -v shellcheck >/dev/null 2>&1; then
  for script in cooldown-wait.sh decrypt-token-cache.sh encrypt-token-cache.sh; do
    if shellcheck "$SCRIPT_DIR/$script"; then
      PASS=$((PASS + 1))
      echo "  ✓ shellcheck $script"
    else
      FAIL=$((FAIL + 1))
      echo "  ✗ shellcheck $script"
    fi
  done
else
  echo "  ! shellcheck not installed — skipping (install on CI runner)"
fi

# ── 2. cooldown cold start ──
echo "── 2/4: cooldown cold start ──"
COLD_TS="/tmp/cooldown-CooldownTestBank.txt"
rm -f "$COLD_TS"
START=$(date +%s)
bash "$SCRIPT_DIR/cooldown-wait.sh" "CooldownTestBank" 5 >/dev/null
ELAPSED=$(($(date +%s) - START))
if [ "$ELAPSED" -le 1 ]; then cold_ok=1; else cold_ok=0; fi
assert_eq "cold start exits immediately (elapsed=${ELAPSED}s)" "1" "$cold_ok"
if [ -f "$COLD_TS" ]; then file_ok=1; else file_ok=0; fi
assert_eq "timestamp file is created" "1" "$file_ok"
rm -f "$COLD_TS"

# ── 3. cooldown warm path ──
echo "── 3/4: cooldown warm path enforces gap ──"
WARM_TS="/tmp/cooldown-WarmTestBank.txt"
echo "$(($(date +%s) - 1))" > "$WARM_TS"
START=$(date +%s)
bash "$SCRIPT_DIR/cooldown-wait.sh" "WarmTestBank" 3 >/dev/null
ELAPSED=$(($(date +%s) - START))
if [ "$ELAPSED" -ge 1 ] && [ "$ELAPSED" -le 4 ]; then warm_ok=1; else warm_ok=0; fi
assert_eq "warm path sleeps ~2s (got ${ELAPSED}s)" "1" "$warm_ok"
rm -f "$WARM_TS"

# ── 4. encrypt → decrypt roundtrip ──
echo "── 4/4: token cache encrypt/decrypt roundtrip ──"
if ! command -v gpg >/dev/null 2>&1; then
  echo "  ! gpg not installed — skipping roundtrip"
else
  ROUNDTRIP_PLAIN="/tmp/roundtripbank-token.cache"
  echo "fake-jwt-eyJhbGciOiJIUzI1NiJ9.payload.signature" > "$ROUNDTRIP_PLAIN"
  ORIGINAL_BODY=$(cat "$ROUNDTRIP_PLAIN")
  export CACHE_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  bash "$SCRIPT_DIR/encrypt-token-cache.sh" "RoundtripBank" >/dev/null
  if [ -f "/tmp/tokens-encrypted/roundtripbank-token.cache.gpg" ]; then enc_ok=1; else enc_ok=0; fi
  assert_eq "encrypt produces ciphertext" "1" "$enc_ok"
  if [ ! -f "$ROUNDTRIP_PLAIN" ]; then shred_ok=1; else shred_ok=0; fi
  assert_eq "plaintext is shredded after encrypt" "1" "$shred_ok"

  bash "$SCRIPT_DIR/decrypt-token-cache.sh" "RoundtripBank" >/dev/null
  if [ -f "$ROUNDTRIP_PLAIN" ]; then dec_ok=1; else dec_ok=0; fi
  assert_eq "decrypt restores plaintext" "1" "$dec_ok"
  if [ "$dec_ok" = "1" ]; then
    DECRYPTED_BODY=$(cat "$ROUNDTRIP_PLAIN")
    assert_eq "decrypted body matches original" "$ORIGINAL_BODY" "$DECRYPTED_BODY"
  fi

  # Negative test: wrong key must fail with non-zero.
  rm -f "$ROUNDTRIP_PLAIN"
  export CACHE_KEY="wrong-key-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  if bash "$SCRIPT_DIR/decrypt-token-cache.sh" "RoundtripBank" >/dev/null 2>&1; then
    bad_key_ok=0
  else
    bad_key_ok=1
  fi
  assert_eq "wrong key exits non-zero" "1" "$bad_key_ok"

  # No-key path: must NOT fail; must skip gracefully.
  unset CACHE_KEY
  echo "fresh-token" > /tmp/nokeybank-token.cache
  if bash "$SCRIPT_DIR/encrypt-token-cache.sh" "NoKeyBank" >/dev/null 2>&1; then
    no_key_enc_ok=1
  else
    no_key_enc_ok=0
  fi
  assert_eq "encrypt without CACHE_KEY exits 0 (graceful skip)" "1" "$no_key_enc_ok"

  # Cleanup
  rm -f /tmp/tokens-encrypted/roundtripbank-token.cache.gpg
  rm -f /tmp/roundtripbank-token.cache
  rm -f /tmp/nokeybank-token.cache
fi

# ── Final summary ──
echo ""
echo "Smoke test summary: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
