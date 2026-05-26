#!/usr/bin/env bash
# ESLint Canary Verification — asserts every canary file triggers at
# least 1 error AND every bash canary correctly rejects its rejected
# fixture while accepting its accepted fixture.
#
# Spec.txt §1 + decide.md §1 TRD §9.2: single integration point
# extends the existing TS canary loop. New rule classes (RC-2, RC-3,
# RC-4) add `*.canary.sh` siblings alongside the TS canaries; the loop
# below runs each bash canary against the matching `fixtures/<slug>
# .{accepted,rejected}.{yml,dockerfile}` pair.
set -euo pipefail

CANARY_DIR="src/Scrapers/Pipeline/EslintCanaries"
FIXTURE_DIR="$CANARY_DIR/fixtures"
# Use node to get a cross-platform temp file path (works on Windows + Unix)
TMPFILE="$(node -e "const os=require('os');const p=require('path');console.log(p.join(os.tmpdir(),'canary-verify.json'))")"

echo "🔍 Running Canary Validation..."

# Run ESLint specifically on canaries
npx eslint "$CANARY_DIR"/*.canary.ts --no-ignore --format json 2>/dev/null > "$TMPFILE" || true

node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
  const dead = [];

  data.forEach(f => {
    const name = f.filePath.replace(/.*[\\\\/]/, '');
    if (f.errorCount === 0) dead.push(name);
  });

  if (dead.length > 0) {
    console.error('\n❌ ARCHITECTURAL FAILURE — Guardrails are inactive for:', dead.join(', '));
    process.exit(1);
  }
  console.log('\n✅ All ' + data.length + ' TS canaries triggered errors');
" "$TMPFILE"

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
