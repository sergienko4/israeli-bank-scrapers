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

# `-e` is intentionally OMITTED here. This is an assertion harness that
# MUST keep running past failing setup steps and negative-test commands
# (e.g. the "wrong key must exit non-zero" test below `set +e`s its way
# through the failure on purpose) so it can tally PASS/FAIL totals.
# Adding `-e` would short-circuit the suite on the first expected
# failure and silently skip the rest of the assertions. Per CR review
# on PR #300: keep this deviation explicit.
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
  for script in decrypt-token-cache.sh encrypt-token-cache.sh check-docs-links.sh pipeline-summary.sh; do
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

# ── 2. encrypt → decrypt roundtrip ──
# Cooldown enforcement is no longer script-based — see pr.yml
# `Cooldown hold` post-run step which simply `sleep`s 600 s to
# hold the job's concurrency.group slot (per CR review on PR #300;
# `actions/cache`-backed timestamps were PR-branch scoped and could
# not enforce repo-wide cross-PR cooldown).
echo "── 2/4: token cache encrypt/decrypt roundtrip ──"
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

# ── 3. docs-site link guard ──
# Behavioural test, not just shellcheck: the guard's whole value is that
# it FAILS on a link with no backing page, so assert both directions.
echo "── 3/4: docs-site link guard ──"
GUARD="$SCRIPT_DIR/check-docs-links.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

if bash "$GUARD" >/dev/null 2>&1; then
  guard_clean=1
else
  guard_clean=0
fi
assert_eq "guard passes on the committed tree" "1" "$guard_clean"

# Append a deliberately dangling site link, assert non-zero, restore.
GUARD_BAK="$(mktemp)"
cp "$REPO_ROOT/README.md" "$GUARD_BAK"
printf '\n[dangling](https://sergienko4.github.io/israeli-bank-scrapers/no-such-page/)\n' \
  >> "$REPO_ROOT/README.md"
if bash "$GUARD" >/dev/null 2>&1; then
  guard_catches=0
else
  guard_catches=1
fi
cp "$GUARD_BAK" "$REPO_ROOT/README.md"
rm -f "$GUARD_BAK"
assert_eq "guard fails on a dangling site link" "1" "$guard_catches"

# Restoring must leave the tree exactly as found, or the smoke test
# itself would dirty the working copy it just validated.
if bash "$GUARD" >/dev/null 2>&1; then
  guard_restored=1
else
  guard_restored=0
fi
assert_eq "README restored after negative test" "1" "$guard_restored"

# ── 4. post-merge pipeline summary ──
# This is the one artifact a maintainer reads when a merge goes wrong, and
# its exit status is what stops a red merge looking green. Assert the verdict
# in both directions, plus the release wording that distinguishes "shipped"
# from "only refreshed the Release PR".
echo "── 4/4: post-merge pipeline summary ──"
SUMMARY="$SCRIPT_DIR/pipeline-summary.sh"
SUMMARY_FILE="$(mktemp "${TMPDIR:-/tmp}/pipeline-summary-smoke.XXXXXX")"
trap 'rm -f "$SUMMARY_FILE"' EXIT

render() {
  # The renderer appends, so truncate between cases or later greps would
  # match output left over from an earlier render.
  : > "$SUMMARY_FILE"
  env "$@" SHA=abc1234def GITHUB_STEP_SUMMARY="$SUMMARY_FILE" \
    bash "$SUMMARY" >/dev/null 2>&1
  echo "$?"
}

clean_exit=$(render R_CHANGES=success R_CODEQL=success R_SONAR=success \
  R_WFSEC=success R_DOCS=skipped R_RELEASE=success RELEASED=false VERSION=)
assert_eq "clean run exits 0" "0" "$clean_exit"
if grep -qF "no new version" "$SUMMARY_FILE"; then no_rel=1; else no_rel=0; fi
assert_eq "no-release merge is labelled, not just 'success'" "1" "$no_rel"

pub_exit=$(render R_CHANGES=success R_CODEQL=success R_SONAR=success \
  R_WFSEC=success R_DOCS=success R_RELEASE=success RELEASED=true VERSION=9.9.9)
assert_eq "published run exits 0" "0" "$pub_exit"
if grep -qF "published v9.9.9" "$SUMMARY_FILE"; then pub_lbl=1; else pub_lbl=0; fi
assert_eq "published version appears in the table" "1" "$pub_lbl"

# A failing release must fail the summary — the whole point of folding
# release into the pipeline is that it can no longer fail unnoticed.
rel_fail_exit=$(render R_CHANGES=success R_CODEQL=success R_SONAR=success \
  R_WFSEC=success R_DOCS=skipped R_RELEASE=failure RELEASED= VERSION=)
assert_eq "failed release exits non-zero" "1" "$rel_fail_exit"

scan_fail_exit=$(render R_CHANGES=success R_CODEQL=failure R_SONAR=success \
  R_WFSEC=success R_DOCS=skipped R_RELEASE=success RELEASED=false VERSION=)
assert_eq "failed scan exits non-zero" "1" "$scan_fail_exit"

# ── Final summary ──
echo ""
echo "Smoke test summary: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
