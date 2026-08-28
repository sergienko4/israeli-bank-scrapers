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
echo "── 1/10: shellcheck ──"
if command -v shellcheck >/dev/null 2>&1; then
  for script in decrypt-token-cache.sh encrypt-token-cache.sh check-docs-links.sh pipeline-summary.sh memory-compare.sh memory-measure.sh decoupling-compare.sh verify-npm-publish.sh dns-warmup.sh; do
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
echo "── 2/10: token cache encrypt/decrypt roundtrip ──"
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
echo "── 3/10: docs-site link guard ──"
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
echo "── 4/10: post-merge pipeline summary ──"
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
echo "── 5/10: memory regression verdict ──"
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
echo "── 6/10: decoupling regression verdict ──"
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

# The rule ratchet reads a COUNT, so the thing that produces that count is
# asserted too. The cases above only prove the verdict reacts to the number;
# these prove the number means "rules enforced" and not "lines written".
# Without them, merging two scoped declarations of one rule into a single
# broader one — a widening — would register as a deleted rule and block the
# PR. Needs node but not jq, so it sits outside the guard above.
if ! command -v node >/dev/null 2>&1; then
  echo "  ! node not installed — skipping rule-count assertions"
else
  # This step runs whenever `ci_scripts` is true. `setup-node-deps` now runs for
  # those PRs too, so this deliberately does not lean on the job being
  # dependency-free — it constructs that condition itself. The metrics library
  # has to stay reachable from Node alone, because a bare specifier anywhere in
  # its import graph makes the import throw, print nothing, and leave every
  # count below comparing against an empty string rather than failing. A
  # `typescript` import reached through `graph.mjs` did exactly that, turning
  # workflow-only PRs red for a reason nothing on the failing job ever named.
  isolated_import() {
    local iso parent out
    iso="$(mktemp -d "$DEC_DIR/iso.XXXXXX")" || { printf 'mktemp failed'; return 1; }
    cp "$REPO_ROOT"/scripts/decoupling-metrics/lib/*.mjs "$iso/" ||
      { printf 'cp failed'; return 1; }
    # Node resolves bare specifiers by walking the importing module's ancestors,
    # so the isolation holds only while none of them carries a node_modules.
    # Asserting that beats assuming it: TMPDIR is not ours to choose.
    parent="$iso"
    while [ "$parent" != "$(dirname "$parent")" ]; do
      if [ -d "$parent/node_modules" ]; then
        printf 'not isolated: %s/node_modules' "$parent"
        return 1
      fi
      parent="$(dirname "$parent")"
    done
    # One real `: any` and one in prose. `stripComments` is the only reason
    # guardrails reached into `graph.mjs` at all, so counting 1 and not 2 proves
    # both that the module resolved and that the moved helper still works.
    printf '// prose mentioning : any that must not count\nexport const x: any = 1;\n' \
      > "$iso/probe.ts"
    out="$(node --input-type=module -e "
      import { pathToFileURL } from 'node:url';
      const { guardrails } = await import(pathToFileURL(process.argv[1]).href);
      process.stdout.write(String(guardrails(process.argv[2], ['probe.ts']).anyUsages));
    " "$iso/guardrails.mjs" "$iso" 2>&1)" || { printf '%s' "${out%%$'\n'*}"; return 1; }
    printf '%s' "$out"
  }

  assert_eq "metrics library resolves and strips comments with no node_modules" \
    "1" "$(isolated_import)"

  # Both paths are passed as arguments, never interpolated into the script
  # text: a shell that rewrites POSIX paths for a native node binary converts
  # arguments correctly but mangles the same path inside a string literal.
  rule_count() {
    local root
    root="$(mktemp -d "$DEC_DIR/cfg.XXXXXX")"
    printf '%s\n' "$1" > "$root/eslint.config.mjs"
    node --input-type=module -e "
      import { pathToFileURL } from 'node:url';
      const { guardrails } = await import(pathToFileURL(process.argv[2]).href);
      process.stdout.write(String(guardrails(process.argv[1], []).eslintRules));
    " "$root" "$REPO_ROOT/scripts/decoupling-metrics/lib/guardrails.mjs"
  }

  # Two narrow declarations of one rule, plus an unrelated second rule.
  TWO_SCOPED="  'unicorn/prefer-export-from': ['error', { checkUsedVariables: false }],
  'sonarjs/no-identical-functions': 'error',
  'unicorn/prefer-export-from': ['error', { checkUsedVariables: true }],"
  # The same coverage expressed once, more broadly. Strictly stronger.
  ONE_WIDE="  'unicorn/prefer-export-from': ['error', { checkUsedVariables: true }],
  'sonarjs/no-identical-functions': 'error',"
  # The rule genuinely dropped. This must still be caught.
  ONE_DELETED="  'sonarjs/no-identical-functions': 'error',"

  assert_eq "two scoped declarations of one rule count once" "2" "$(rule_count "$TWO_SCOPED")"
  assert_eq "widening a rule into one declaration does not regress" "2" "$(rule_count "$ONE_WIDE")"
  assert_eq "deleting a rule outright still drops the count" "1" "$(rule_count "$ONE_DELETED")"
fi

# ── 7. cited-path gate ──
echo ""
echo "── 7/10: cited-path gate ──"
DOC_DIR="$(mktemp -d "${TMPDIR:-/tmp}/doc-paths-smoke.XXXXXX")"
trap 'rm -f "$SUMMARY_FILE" "$MEM_FILE"; rm -rf "$DEC_DIR" "$DOC_DIR"' EXIT

# The fixtures below embed literal Markdown backticks, which is the whole
# point of the gate — SC2016 would have us "fix" them into expansions.
# shellcheck disable=SC2016
if ! command -v node >/dev/null 2>&1; then
  echo "  ⚠ node not found — skipping cited-path gate tests"
else
  DOCPATHS="$REPO_ROOT/scripts/check-doc-paths.mjs"
  # Every case runs from the repo root: a cited path is repo-relative by
  # definition and is resolved against the cwd.
  doc_check() {
    (cd "$REPO_ROOT" && node "$DOCPATHS" "$@" > "$DOC_DIR/out.txt" 2>&1)
    echo "$?"
  }

  printf 'See `src/Common/Browser.ts` for the context builder.\n' > "$DOC_DIR/good.md"
  printf 'See `src/helpers/browser.ts` for the context builder.\n' > "$DOC_DIR/phantom.md"

  assert_eq "a resolving path passes" "0" "$(doc_check "$DOC_DIR/good.md")"

  # The exact drift that motivated the gate: the pre-restructure path
  # from CLAUDE.md's Key Files list.
  assert_eq "a phantom path fails" "1" "$(doc_check "$DOC_DIR/phantom.md")"

  doc_check "$DOC_DIR/phantom.md" > /dev/null
  if grep -qF 'src/helpers/browser.ts' "$DOC_DIR/out.txt"; then doc_named=1; else doc_named=0; fi
  assert_eq "the unresolved path is named in the output" "1" "$doc_named"

  # docs/ shortens the label relative to a documented base while the link
  # target carries the full path, so a label is not a repo-relative claim.
  printf 'See [`Banks/Amex/AmexPipeline.ts`](https://example.com/x) for detail.\n' \
    > "$DOC_DIR/label.md"
  assert_eq "a link label is not treated as a repo path" "0" "$(doc_check "$DOC_DIR/label.md")"

  # Absent by default; gating it would pass on a machine with one lying
  # around and fail in CI.
  printf 'The hook looks for `.github/PR_BODY.md` before validating.\n' > "$DOC_DIR/optional.md"
  assert_eq "a run-time artefact is not gated" "0" "$(doc_check "$DOC_DIR/optional.md")"

  printf 'Run `npm run lint` and set `PR_BODY_FILE` first.\n' > "$DOC_DIR/prose.md"
  assert_eq "tokens without a path shape are ignored" "0" "$(doc_check "$DOC_DIR/prose.md")"

  assert_eq "no arguments is a usage error" "2" "$(doc_check)"

  # A valueless flag must not silently disable removed-path handling, which
  # would report a legitimate deletion as drift.
  assert_eq "--diff-base without a ref is a usage error" "2" \
    "$(doc_check "$DOC_DIR/good.md" --diff-base)"
  assert_eq "--diff-base followed by a flag is a usage error" "2" \
    "$(doc_check --diff-base --other "$DOC_DIR/good.md")"

  # Regression: an early build derived the file list from the flag index,
  # so the first file was silently dropped. Both forms must read the file.
  assert_eq "--diff-base does not swallow the file list" "1" \
    "$(doc_check --diff-base origin/main "$DOC_DIR/phantom.md")"

  # A body may describe a file it deletes or renames away. Build a throwaway
  # history so the removed path is real rather than mocked.
  DOC_REPO="$DOC_DIR/repo"
  mkdir -p "$DOC_REPO"
  (
    cd "$DOC_REPO" || exit 1
    git init -q .
    git config user.email smoke@example.com
    git config user.name smoke
    mkdir -p old
    printf 'x\n' > old/gone.ts
    printf 'y\n' > old/moved.ts
    git add -A && git commit -qm base
    git branch -q doc-base
    git rm -q old/gone.ts
    git mv old/moved.ts old/renamed.ts
    git commit -qm remove
  ) > /dev/null 2>&1
  printf 'Removes `old/gone.ts` and renames `old/moved.ts`.\n' > "$DOC_REPO/body.md"
  # Keep the checker output: on an unexpected result the exit status alone
  # says nothing about which citation the run disagreed on.
  # This repo has no package.json, so the run also covers the manifest-free
  # checkout the entry-point exemption must tolerate. Naming that here keeps
  # the failure legible: a crash on load reads as a parse problem otherwise.
  (cd "$DOC_REPO" && node "$DOCPATHS" --diff-base doc-base body.md) > "$DOC_DIR/removed.log" 2>&1
  removed_status=$?
  if [ "$removed_status" -ne 0 ]; then cat "$DOC_DIR/removed.log"; fi
  assert_eq "a deleted and a renamed path are accepted with no manifest" "0" "$removed_status"
  (cd "$DOC_REPO" && node "$DOCPATHS" body.md) > "$DOC_DIR/removed-nobase.log" 2>&1
  nobase_status=$?
  if [ "$nobase_status" -ne 1 ]; then cat "$DOC_DIR/removed-nobase.log"; fi
  assert_eq "the same paths fail without --diff-base" "1" "$nobase_status"

  # A `#L` locator is documented as supported, so it must actually resolve
  # rather than fail the path shape and be skipped as a non-path.
  printf 'See `src/Common/Browser.ts#L17` and `src/Common/Browser.ts:17`.\n' > "$DOC_DIR/locator.md"
  assert_eq "a #L locator resolves to the file" "0" "$(doc_check "$DOC_DIR/locator.md")"
  printf 'Gone: `src/helpers/browser.ts#L17`.\n' > "$DOC_DIR/locator-bad.md"
  assert_eq "a #L locator on a phantom path still fails" "1" \
    "$(doc_check "$DOC_DIR/locator-bad.md")"

  # PR-body text is contributor-controlled, so a citation must not be able to
  # probe for files outside the repo and report the answer via the exit status.
  printf 'Escape: `../../../etc/passwd` and `../outside/file.md`.\n' > "$DOC_DIR/escape.md"
  assert_eq "a path escaping the repo is not probed" "0" "$(doc_check "$DOC_DIR/escape.md")"

  # The gate is only worth having if the docs it guards actually pass, so
  # a future move that rots a citation fails here too.
  assert_eq "the gated agent docs all resolve" "0" \
    "$(doc_check README.md CLAUDE.md CLEAN_CODE.md CONTRIBUTING.md .github/copilot-instructions.md)"
fi

# ── 8. bot-PR exemption ──
echo ""
echo "── 8/10: bot-PR exemption ──"
if ! command -v node >/dev/null 2>&1; then
  echo "  ⚠ node not found — skipping bot-exemption tests"
else
  # The exemption decides whether a PR skips the body gates, so a branch-name
  # bypass would let a fork opt out of them entirely.
  is_bot() {
    node -e '
      const isBotPr = require(process.argv[1]);
      process.stdout.write(String(isBotPr(JSON.parse(process.argv[2]))));
    ' "$REPO_ROOT/.github/scripts/ci/is-bot-pr.cjs" "$1"
  }
  SAME='{"repo":{"full_name":"o/r"}}'

  assert_eq "a bot author is exempt" "true" \
    "$(is_bot "{\"user\":{\"login\":\"dependabot[bot]\"},\"head\":$SAME,\"base\":$SAME}")"
  assert_eq "a same-repo bot branch is exempt" "true" \
    "$(is_bot "{\"user\":{\"login\":\"human\"},\"head\":{\"ref\":\"release-please--x\",\"repo\":{\"full_name\":\"o/r\"}},\"base\":$SAME}")"
  assert_eq "a fork cannot claim a bot branch" "false" \
    "$(is_bot "{\"user\":{\"login\":\"human\"},\"head\":{\"ref\":\"dependabot/x\",\"repo\":{\"full_name\":\"fork/r\"}},\"base\":$SAME}")"
  assert_eq "an ordinary PR is not exempt" "false" \
    "$(is_bot "{\"user\":{\"login\":\"human\"},\"head\":{\"ref\":\"fix/thing\",\"repo\":{\"full_name\":\"o/r\"}},\"base\":$SAME}")"
  assert_eq "a payload missing repo data is not exempt" "false" \
    "$(is_bot '{"user":{"login":"human"},"head":{"ref":"dependabot/x"}}')"
fi

# ── 9. npm publish verification ──
# `verify-npm-publish.sh` is what turns "npm publish exited 0" into "a consumer
# can actually install this". It can't be pointed at the live registry from CI
# or from a machine behind a proxy, so the package document is served from a
# fixture through a stub `curl` on PATH — the script itself runs unmodified.
echo "── 9/10: npm publish verification ──"
NPM_TMP="$(mktemp -d)"
mkdir -p "$NPM_TMP/bin"
cat > "$NPM_TMP/bin/curl" <<'STUB_CURL'
#!/usr/bin/env bash
# Stands in for registry.npmjs.org: ignores curl's flags, serves the fixture.
cat "${FIXTURE_PACKUMENT}"
STUB_CURL
chmod +x "$NPM_TMP/bin/curl"

# $1 file, $2 dist-tags.latest, $3 extra `dist` members (leading comma, or empty)
write_packument() {
  cat > "$1" <<EOF
{
  "dist-tags": { "latest": "$2" },
  "versions": {
    "9.9.9": {
      "version": "9.9.9",
      "dist": { "shasum": "deadbeef", "tarball": "https://example.invalid/p.tgz"$3 }
    }
  }
}
EOF
}

ATTESTED=', "attestations": { "provenance": { "predicateType": "https://slsa.dev/provenance/v1" } }'
write_packument "$NPM_TMP/signed.json" "9.9.9" "$ATTESTED"
write_packument "$NPM_TMP/unsigned.json" "9.9.9" ""
write_packument "$NPM_TMP/stale.json" "8.8.8" "$ATTESTED"

run_verify() {
  PATH="$NPM_TMP/bin:$PATH" FIXTURE_PACKUMENT="$1" \
    VERIFY_MAX_ATTEMPTS=1 VERIFY_SLEEP_SECONDS=0 \
    bash "$SCRIPT_DIR/verify-npm-publish.sh" "@scope/pkg" "9.9.9" >/dev/null 2>&1
  echo "$?"
}

assert_eq "a published, latest-tagged, attested version passes" "0" \
  "$(run_verify "$NPM_TMP/signed.json")"
# Regression guard: this failed open until the provenance read moved off
# `npm view`, which prints nothing and still exits 0 for an absent field, so
# the `! npm view ...` guard could never fire on an unsigned publish.
assert_eq "a publish carrying no provenance attestation fails" "1" \
  "$(run_verify "$NPM_TMP/unsigned.json")"
assert_eq "a version the registry does not serve as latest fails" "1" \
  "$(run_verify "$NPM_TMP/stale.json")"

rm -rf "$NPM_TMP"

# ── 10. DNS warm-up host extraction ──
echo "── 10/10: DNS warm-up host extraction ──"

# dns-warmup.sh runs BEFORE `npm install`, so it reads the bank registry
# with awk/grep/sed instead of importing TypeScript. That puts its
# extractors out of reach of both tsc and jest, and a silently-skipped
# host is not a loud failure — it surfaces much later as the browser
# failing to resolve an auth origin (NS_ERROR_UNKNOWN_HOST) mid-login.
#
# These assertions eval the REAL functions straight out of the shipped
# script, so the test cannot drift away from what CI actually runs.
DNS_SCRIPT="$SCRIPT_DIR/dns-warmup.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CONFIG_DIR="${REPO_ROOT}/src/Scrapers/Pipeline/Registry/Config"
CONFIG_FILE="${CONFIG_DIR}/PipelineBankConfig.ts"
HOSTS_FILE="${CONFIG_DIR}/PipelineBankHosts.ts"

eval "$(sed -n '/^bank_block()/,/^}/p' "$DNS_SCRIPT")"
eval "$(sed -n '/^to_hostnames()/,/^}/p' "$DNS_SCRIPT")"
eval "$(sed -n '/^extra_hosts()/,/^}/p' "$DNS_SCRIPT")"
eval "$(sed -n '/^require_readable()/,/^}/p' "$DNS_SCRIPT")"

# Every host the warm-up loop would resolve for one bank: the base URL
# extracted from its registry block, unioned with its declared extras.
warm_set() {
  { bank_block "$1" | to_hostnames; extra_hosts "$1"; } | grep -v '^$' | sort -u
}

contains() {
  if printf '%s\n' "$2" | grep -qx "$1"; then echo "yes"; else echo "no"; fi
}

YAHAV_HOSTS="$(warm_set Yahav)"
# Regression guard for the CI outage: Yahav's login iframe origin is set
# at runtime by the marketing page, so it appears in no source file and
# cannot be auto-extracted. It has to come from the manifest.
assert_eq "Yahav warms its runtime-only login iframe origin" "yes" \
  "$(contains login.yahav.co.il "$YAHAV_HOSTS")"

VISACAL_HOSTS="$(warm_set VisaCal)"
assert_eq "VisaCal warms its own apex" "yes" \
  "$(contains www.cal-online.co.il "$VISACAL_HOSTS")"
# The previous fixed-window `grep -A 2` read past the end of short
# entries into the next bank, so VisaCal inherited Amex's apex.
assert_eq "VisaCal does not bleed the neighbouring Amex apex" "no" \
  "$(contains www.americanexpress.co.il "$VISACAL_HOSTS")"

# A bank whose whole flow lives on urls.base has no manifest entry; that
# is a valid answer, not an error, and must not abort under `set -e`.
assert_eq "a bank with no declared extras still yields its base" "yes" \
  "$(contains www.max.co.il "$(warm_set Max)")"

PREFLIGHT_HOSTS="$({ to_hostnames < "$CONFIG_FILE"; extra_hosts; } | sort -u)"
# he.isracard.co.il has no A record. The warm loop fails loud on an
# unresolvable host, so declaring it would hold every E2E run red.
assert_eq "preflight never warms the host that has no A record" "no" \
  "$(contains he.isracard.co.il "$PREFLIGHT_HOSTS")"

# The extractor once pinned hostnames to .co.il/.com, which would drop a
# future .net or .org auth origin without a word. Silent omission is the
# whole failure mode here, so the pattern must stay TLD-agnostic.
DNS_TMP="$(mktemp -d)"
printf "  [CompanyTypes.Fake]: ['auth.example.net'],\n" > "$DNS_TMP/hosts.ts"
assert_eq "an auth origin outside .co.il/.com is still warmed" "yes" \
  "$(contains auth.example.net "$(HOSTS_FILE="$DNS_TMP/hosts.ts" extra_hosts Fake)")"
rm -rf "$DNS_TMP"

# An unreadable manifest must abort, not read as "this bank has no
# extras" — that would quietly restore the original Yahav outage.
assert_eq "an unreadable registry file fails loud" "1" \
  "$( (require_readable "$REPO_ROOT/no-such-registry-file.ts") >/dev/null 2>&1; echo $? )"

# The reachability diagnostic was once deleted along with a bank-specific
# block, taking the only signal that separates "DNS resolved fine but the
# edge served us an error page" from a generic scrape failure. Losing it
# cost a forensic-bundle download to read a screenshot. `curl` is shadowed
# so this asserts the reporting contract without touching the network.
eval "$(sed -n '/^probe_status()/,/^}/p' "$REPO_ROOT/.github/scripts/ci/dns-warmup.sh")"
DIAG_USER_AGENT='smoke-agent'

curl() { echo "404"; }
assert_eq "an edge-blocked host is reported with its status" \
  "[diag]  bank.example -> http=404" "$(probe_status bank.example)"

curl() { echo "200"; }
assert_eq "a healthy host is reported with its status" \
  "[diag]  bank.example -> http=200" "$(probe_status bank.example)"

# An origin that answers nothing must not render as an empty field, or the
# job log cannot be told apart from a probe that never ran.
curl() { echo ""; }
assert_eq "a silent origin is reported as NO_RESPONSE" \
  "[diag]  bank.example -> http=NO_RESPONSE" "$(probe_status bank.example)"

# curl reports an unreachable origin as the sentinel `000`, not as an
# empty string, so the `${status:-...}` default never fires for it. Left
# unnormalised the log reads `http=000`, which looks like a status the
# edge returned rather than a connection that never happened.
curl() { echo "000"; }
assert_eq "an unreachable origin is reported as NO_RESPONSE, not 000" \
  "[diag]  bank.example -> http=NO_RESPONSE" "$(probe_status bank.example)"

# It is a diagnostic, not a gate: a bank that blocks the probe but serves
# the browser must never fail the preflight. The subshell re-enables the
# `set -e` the real script runs under — without it a failed assignment
# aborts nothing here, and this assertion could not tell the guard apart
# from its absence.
curl() { return 7; }
assert_eq "a failed probe never aborts the preflight" "0" \
  "$( ( set -e; probe_status bank.example ) >/dev/null 2>&1; echo $? )"
unset -f curl

# Region alone never identified us to a bank edge — two runs in the same
# region disagreed — so the egress IP is logged beside it. A field that
# fails or answers empty must read UNKNOWN: a blank value cannot be told
# apart from a field that was never emitted, which is exactly the
# ambiguity that made the region log unusable on its own.
eval "$(sed -n '/^report_field()/,/^}/p' "$REPO_ROOT/.github/scripts/ci/dns-warmup.sh")"

curl() { echo "20.51.1.2"; }
assert_eq "a reachable field is reported with its value" \
  "egress_ip=20.51.1.2" "$(report_field egress_ip https://example.invalid)"

curl() { echo ""; }
assert_eq "an empty field reads UNKNOWN, not blank" \
  "egress_ip=UNKNOWN" "$(report_field egress_ip https://example.invalid)"

curl() { return 7; }
assert_eq "a failed field lookup reads UNKNOWN" \
  "region=UNKNOWN" "$(report_field region https://example.invalid)"

# Same non-fatal contract as the reachability probe: identity is a
# diagnostic, and a blocked lookup must never fail the preflight.
assert_eq "a failed field lookup never aborts the preflight" "0" \
  "$( ( set -e; report_field region https://example.invalid ) >/dev/null 2>&1; echo $? )"
unset -f curl

# ── Final summary ──
echo ""
echo "Smoke test summary: ${PASS} passed, ${FAIL} failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
