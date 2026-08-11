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
echo "── 1/6: shellcheck ──"
if command -v shellcheck >/dev/null 2>&1; then
  for script in decrypt-token-cache.sh encrypt-token-cache.sh check-docs-links.sh pipeline-summary.sh memory-compare.sh memory-measure.sh decoupling-compare.sh; do
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
echo "── 2/6: token cache encrypt/decrypt roundtrip ──"
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
echo "── 3/6: docs-site link guard ──"
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
echo "── 4/6: post-merge pipeline summary ──"
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

# ── 5. memory regression verdict ──
# This gate can block a PR, so its threshold behaviour is asserted on both
# sides of the limit. The "not measured" path matters just as much: a
# measurement that did not happen must never be reported as a 0 MB win, and
# must never fail a PR for a reason the author cannot act on.
echo "── 5/6: memory regression verdict ──"
MEMCMP="$SCRIPT_DIR/memory-compare.sh"
MEM_FILE="$(mktemp "${TMPDIR:-/tmp}/memory-compare-smoke.XXXXXX")"
trap 'rm -f "$SUMMARY_FILE" "$MEM_FILE"' EXIT

memory() {
  : > "$MEM_FILE"
  env "$@" GITHUB_STEP_SUMMARY="$MEM_FILE" bash "$MEMCMP" >/dev/null 2>&1
  echo "$?"
}

assert_eq "small growth is allowed" "0" \
  "$(memory BASE_MB=400 HEAD_MB=420 THRESHOLD_PCT=10)"
assert_eq "growth beyond the limit fails" "1" \
  "$(memory BASE_MB=400 HEAD_MB=520 THRESHOLD_PCT=10)"

# Exactly at the limit must pass: the gate fires on "more than", so a PR
# sitting on the boundary is not blocked by a rounding artefact.
assert_eq "exactly at the limit passes" "0" \
  "$(memory BASE_MB=400 HEAD_MB=440 THRESHOLD_PCT=10)"
assert_eq "one MB over the limit fails" "1" \
  "$(memory BASE_MB=400 HEAD_MB=441 THRESHOLD_PCT=10)"

# A regression that rounds down to exactly the limit must still fail. 2001 ->
# 2202 is 10.04%, which prints as "10.0"; comparing the formatted percentage
# instead of the raw numbers let this through.
assert_eq "a regression that rounds to the limit fails" "1" \
  "$(memory BASE_MB=2001 HEAD_MB=2202 THRESHOLD_PCT=10)"

assert_eq "an improvement passes" "0" \
  "$(memory BASE_MB=400 HEAD_MB=350 THRESHOLD_PCT=10)"
if grep -qF "improved" "$MEM_FILE"; then improved=1; else improved=0; fi
assert_eq "an improvement is reported as such" "1" "$improved"

# A missing measurement must be visible rather than silently green.
assert_eq "unmeasured base does not fail the PR" "0" \
  "$(memory BASE_MB=unavailable HEAD_MB=420 THRESHOLD_PCT=10)"
if grep -qF "not measured" "$MEM_FILE"; then unmeasured=1; else unmeasured=0; fi
assert_eq "unmeasured run says so in the summary" "1" "$unmeasured"
assert_eq "unmeasured head does not fail the PR" "0" \
  "$(memory BASE_MB=400 HEAD_MB=unavailable THRESHOLD_PCT=10)"

# A zero base would make the percentage a division by zero.
assert_eq "zero base is treated as unmeasured" "0" \
  "$(memory BASE_MB=0 HEAD_MB=420 THRESHOLD_PCT=10)"

# The regression summary must carry the numbers, not just a verdict, so the
# author can see how far over the line the PR is without opening the log.
memory BASE_MB=400 HEAD_MB=520 THRESHOLD_PCT=10 >/dev/null
if grep -qF "120 MB" "$MEM_FILE"; then delta_shown=1; else delta_shown=0; fi
assert_eq "the delta in MB is shown" "1" "$delta_shown"
if grep -qF "30.0%" "$MEM_FILE"; then pct_shown=1; else pct_shown=0; fi
assert_eq "the delta percentage is shown" "1" "$pct_shown"

# ── 6. decoupling regression verdict ──
# This gate can also block a PR. Guardrails here are RATCHETS rather than
# budgets, so each one is asserted in both directions: weakening must fail,
# strengthening must pass. The distinction between "could not measure"
# (skip, exit 0) and "measured garbage" (fail loudly, exit 2) is asserted
# too — collapsing the two would let a broken tool disable the gate.
echo "── 6/6: decoupling regression verdict ──"
DECCMP="$SCRIPT_DIR/decoupling-compare.sh"
DEC_DIR="$(mktemp -d "${TMPDIR:-/tmp}/decoupling-smoke.XXXXXX")"
trap 'rm -f "$SUMMARY_FILE" "$MEM_FILE"; rm -rf "$DEC_DIR"' EXIT

if ! command -v jq >/dev/null 2>&1; then
  echo "  ! jq not installed — skipping decoupling assertions"
else
  cat > "$DEC_DIR/base.json" <<'JSON'
{
  "summary": { "files": 1000, "edges": 5000 },
  "runtimeSummary": { "files": 1000, "edges": 2500, "avgFanOut": 2.5 },
  "cycles": { "count": 0, "largest": 0 },
  "guardrails": { "canaries": 75, "eslintRules": 170, "anyUsages": 1 }
}
JSON

  # Each case starts from the same base and mutates exactly one thing, so a
  # failure names the metric that broke rather than a whole snapshot.
  decoupling() {
    local filter="$1"
    jq "$filter" "$DEC_DIR/base.json" > "$DEC_DIR/head.json"
    BASE_SNAPSHOT="$DEC_DIR/base.json" HEAD_SNAPSHOT="$DEC_DIR/head.json" \
      THRESHOLD_PCT=10 GITHUB_STEP_SUMMARY="$DEC_DIR/summary.md" \
      bash "$DECCMP" >/dev/null 2>&1
    echo "$?"
  }

  assert_eq "an unchanged architecture passes" "0" "$(decoupling '.')"

  # Ratchets — the weakening direction must fail.
  assert_eq "a new import cycle fails" "1" "$(decoupling '.cycles.count = 1')"
  assert_eq "a new any usage fails" "1" "$(decoupling '.guardrails.anyUsages += 1')"
  assert_eq "a deleted canary fails" "1" "$(decoupling '.guardrails.canaries -= 1')"
  assert_eq "a deleted eslint rule fails" "1" "$(decoupling '.guardrails.eslintRules -= 1')"

  # Ratchets — the strengthening direction must pass, or the gate would
  # punish exactly the changes it exists to encourage.
  assert_eq "removing an any passes" "0" "$(decoupling '.guardrails.anyUsages = 0')"
  assert_eq "adding a canary passes" "0" "$(decoupling '.guardrails.canaries += 1')"
  assert_eq "adding an eslint rule passes" "0" "$(decoupling '.guardrails.eslintRules += 1')"

  # Fan-out is a tolerance band, not a ratchet: adding code moves it a little.
  assert_eq "fan-out drift within tolerance passes" "0" \
    "$(decoupling '.runtimeSummary.avgFanOut = 2.6')"
  assert_eq "fan-out growth beyond tolerance fails" "1" \
    "$(decoupling '.runtimeSummary.avgFanOut = 3.2')"

  # Either side of the limit, where the reported percentage rounds to exactly
  # "10.0" both times. Judging by that display value passed 2.751 — a real
  # 10.04% rise — so these two pin the verdict to the raw ratio.
  assert_eq "fan-out growth just past the limit fails" "1" \
    "$(decoupling '.runtimeSummary.avgFanOut = 2.751')"
  assert_eq "fan-out growth just under the limit passes" "0" \
    "$(decoupling '.runtimeSummary.avgFanOut = 2.7499')"

  # Growth itself is not a regression — a feature adds files and edges.
  assert_eq "proportional growth passes" "0" \
    "$(decoupling '.summary.files += 50 | .summary.edges += 250 | .runtimeSummary.edges += 125')"

  # Degradation paths.
  BASE_SNAPSHOT="$DEC_DIR/missing.json" HEAD_SNAPSHOT="$DEC_DIR/base.json" \
    GITHUB_STEP_SUMMARY="$DEC_DIR/summary.md" bash "$DECCMP" >/dev/null 2>&1
  assert_eq "an unmeasured base does not fail the PR" "0" "$?"
  if grep -qF "not measured" "$DEC_DIR/summary.md"; then dec_unmeasured=1; else dec_unmeasured=0; fi
  assert_eq "an unmeasured run says so in the summary" "1" "$dec_unmeasured"

  # A present-but-unparseable snapshot is a broken tool, not a skip.
  printf 'not json' > "$DEC_DIR/garbage.json"
  BASE_SNAPSHOT="$DEC_DIR/base.json" HEAD_SNAPSHOT="$DEC_DIR/garbage.json" \
    GITHUB_STEP_SUMMARY="$DEC_DIR/summary.md" bash "$DECCMP" >/dev/null 2>&1
  assert_eq "a malformed snapshot fails loudly" "2" "$?"

  # The summary must carry the numbers so the author can act without
  # opening the job log.
  decoupling '.cycles.count = 2' >/dev/null
  if grep -qF "Runtime import cycles" "$DEC_DIR/summary.md"; then dec_named=1; else dec_named=0; fi
  assert_eq "the failing metric is named in the summary" "1" "$dec_named"
fi

# ── Final summary ──
echo ""
echo "Smoke test summary: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
