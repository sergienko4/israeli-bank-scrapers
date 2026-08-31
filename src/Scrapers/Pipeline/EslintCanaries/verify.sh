#!/usr/bin/env bash
# ESLint Canary Verification — asserts every canary file triggers at
# least one REAL rule-ID (i.e. `ruleId !== null` in ESLint's JSON
# output) AND every bash canary correctly rejects its rejected fixture
# while accepting its accepted fixture.
#
# Spec.txt §1 + decide.md §1 TRD §9.2: single integration point
# extends the existing TS canary loop. New rule classes (RC-2, RC-3,
# RC-4) add `*.canary.sh` siblings alongside the TS canaries; the loop
# below runs each bash canary against the matching `fixtures/<slug>
# .{accepted,rejected}.{yml,dockerfile}` pair.
#
# Phase 8.5c / Commit T1 — Silent-pass hardening. Earlier verify.sh
# revisions accepted ANY `errorCount > 0`, which silently passed any
# canary whose enclosing tsconfig excluded it (typescript-eslint then
# emits `Parsing error` with `ruleId === null` — counted as an error
# but no actual rule fired). The §13A grandfather drain (Phase 8.5c)
# requires this loophole closed BEFORE removing the Facade.ts cap
# escape, so every canary's intended rule provably guards production.
# Two defences:
#   1. `EslintCanaries/tsconfig.json` (new) feeds typescript-eslint
#      via `projectService`, so canaries parse cleanly.
#   2. The assertion harness demands at least one message with a
#      non-null `ruleId` per file — Parsing errors no longer mask
#      a dead canary.
#
# 2026-06 — Target hardening. Both defences above still passed a canary
# that errored on INCIDENTAL lint noise (jsdoc, prefer-default-export)
# after its real target had been overwritten by a later flat-config
# block. `canary-expects-rule:` is now MANDATORY, and a canary whose
# target is `no-restricted-syntax` must also declare
# `canary-expects-message:` — that rule is a ~58-selector bundle, so a
# bare rule-ID match proves only that SOME selector fired. The
# assertion moved to `assert-canaries.cjs`; it had outgrown a shell
# string.
set -euo pipefail

CANARY_DIR="src/Scrapers/Pipeline/EslintCanaries"
FIXTURE_DIR="$CANARY_DIR/fixtures"
# Use node to get a cross-platform temp file path (works on Windows + Unix)
TMPFILE="$(node -e "const os=require('os');const p=require('path');console.log(p.join(os.tmpdir(),'canary-verify.json'))")"

echo "🔍 Running Canary Validation..."

# Run ESLint specifically on canaries
npx eslint "$CANARY_DIR"/*.canary.ts --no-ignore --format json 2>/dev/null > "$TMPFILE" || true

node "$CANARY_DIR/assert-canaries.cjs" "$TMPFILE"

rm -f "$TMPFILE"

# ── Bash canary loop (RC-2, RC-3, RC-4) ───────────────────────────
# Each `*.canary.sh` sibling MUST exit non-zero on its rejected fixture
# and zero on its accepted fixture. Fixture extensions are discovered
# (.yml or .dockerfile) so the same loop covers workflows + Dockerfiles.

assert_canary() {
  local script="$1"
  local fixture="$2"
  local expected_exit="$3"
  local actual_exit=0
  bash "$script" "$fixture" >/dev/null 2>&1 || actual_exit=$?
  if [[ "$actual_exit" != "$expected_exit" ]]; then
    echo "❌ canary mismatch: $script $fixture — expected exit $expected_exit, got $actual_exit" >&2
    return 1
  fi
  return 0
}

bash_canary_count=0
for sh_canary in "$CANARY_DIR"/verify-*.canary.sh; do
  [[ -e "$sh_canary" ]] || continue
  bash_canary_count=$((bash_canary_count + 1))
  slug="$(basename "$sh_canary" .canary.sh)"
  slug="${slug#verify-}"

  # Find the rejected + accepted fixtures. Discovered extensions:
  # .yml (workflow canaries), .dockerfile (Dockerfile pin canaries),
  # .md (README / markdown canaries — added PR #261 / V7).
  rejected=""
  accepted=""
  for ext in yml dockerfile md; do
    if [[ -f "$FIXTURE_DIR/$slug.rejected.$ext" ]]; then
      rejected="$FIXTURE_DIR/$slug.rejected.$ext"
    fi
    if [[ -f "$FIXTURE_DIR/$slug.accepted.$ext" ]]; then
      accepted="$FIXTURE_DIR/$slug.accepted.$ext"
    fi
  done

  if [[ -z "$rejected" || -z "$accepted" ]]; then
    echo "❌ fixture pair missing for $sh_canary (slug=$slug)" >&2
    exit 1
  fi

  assert_canary "$sh_canary" "$rejected" 1 || exit 1
  assert_canary "$sh_canary" "$accepted" 0 || exit 1
done

if [[ "$bash_canary_count" -gt 0 ]]; then
  echo "✅ All $bash_canary_count bash canaries reject + accept their fixtures"
fi

# ── Rule #10 layer boundary (armed / exempt / grandfathered) ──────
# Asserted from the RESOLVED config rather than by linting a probe file: the
# Mediator's contract is that Rule #10 does NOT fire there, and "no error on a
# file that contains no `page.*` call" is true whether the rule is scoped
# correctly or deleted outright. See assert-rule10-boundary.cjs.
node "$(dirname "$0")/assert-rule10-boundary.cjs" || exit 1

# ── Numeric canaries must be anchored to their OWN scoped cap ─────
# A size fixture padded far past every declared cap stays red even if its
# guard were loosened to the loosest cap in the config, so it would certify
# only "some cap exists" rather than the tightened one it is named for.
# assert-numeric-canaries.cjs re-lints each numeric canary with its rule
# forced to that loosest declared cap and requires a clean result.
node "$(dirname "$0")/assert-numeric-canaries.cjs" || exit 1
