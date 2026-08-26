#!/usr/bin/env bash
# Unit test for the docs-coverage export extractor.
#
# Sources the REAL `extract_symbols` from extract-exports.sh and
# feeds it synthetic TypeScript, so a regression in the gate's own
# parser is caught here rather than by a reviewer noticing that a new
# export shipped undocumented. Run via:
#
#   bash .github/scripts/ci/tests/extract-exports.test.sh
#
# Exit 0 = every scenario extracted the expected symbol set; 1 = a
# scenario regressed.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# shellcheck source=.github/scripts/ci/extract-exports.sh
. .github/scripts/ci/extract-exports.sh

PASS=0
FAIL=0

# Asserts that `source` yields exactly `expected` (a space-separated,
# alphabetically sorted symbol list; "" means "no symbols").
run_scenario() {
    local name="$1" source="$2" expected="${3-}"
    local actual
    actual="$(printf '%s\n' "$source" | extract_symbols | tr '\n' ' ')"
    actual="$(echo "$actual" | sed 's/[[:space:]]*$//')"

    if [ "$actual" = "$expected" ]; then
        echo "PASS: $name"
        PASS=$((PASS + 1))
    else
        echo "FAIL: $name"
        echo "        expected: [$expected]"
        echo "        actual:   [$actual]"
        FAIL=$((FAIL + 1))
    fi
}

# --- Form 1: inline declarations (pre-existing behaviour, must not regress)
run_scenario "inline const" \
    'export const Alpha = 1;' 'Alpha'
run_scenario "inline function" \
    'export function Alpha() {}' 'Alpha'
run_scenario "inline async function" \
    'export async function Alpha() {}' 'Alpha'
run_scenario "inline abstract class" \
    'export abstract class Alpha {}' 'Alpha'
run_scenario "inline type/interface/enum" \
    "$(printf 'export type Alpha = string;\nexport interface Beta {}\nexport enum Gamma {}')" \
    'Alpha Beta Gamma'
run_scenario "indented declaration is not top-level" \
    '  export const Alpha = 1;' ''

# --- Form 2: local export lists (the 2026-08 fix)
run_scenario "single-line export list" \
    'export { Alpha };' 'Alpha'
run_scenario "single-line list, several symbols" \
    'export { Alpha, Beta, Gamma };' 'Alpha Beta Gamma'
run_scenario "export type list" \
    'export type { Alpha, Beta };' 'Alpha Beta'
run_scenario "multi-line export list" \
    "$(printf 'export {\n  Alpha,\n  Beta,\n};')" 'Alpha Beta'
run_scenario "trailing comma leaves no empty symbol" \
    'export { Alpha, };' 'Alpha'
run_scenario "inline type modifier inside list" \
    'export { type Alpha, Beta };' 'Alpha Beta'
run_scenario "alias publishes the public name only" \
    'export { internalName as Alpha };' 'Alpha'
# `default` is the module default, not a documentable named export.
run_scenario "alias to default is not a documentable symbol" \
    'export { internalName as default };' ''
run_scenario "alias to default alongside a real named export" \
    'export { internalName as default, Beta };' 'Beta'
run_scenario "empty list yields nothing" \
    'export {};' ''

# --- Form 3: re-export barrels stay excluded (by design)
run_scenario "single-line barrel is skipped" \
    "export { Alpha } from './bar.js';" ''
run_scenario "multi-line barrel is skipped" \
    "$(printf 'export {\n  Alpha,\n} from '"'"'./bar.js'"'"';')" ''
run_scenario "export type barrel is skipped" \
    "export type { Alpha } from './bar.js';" ''
run_scenario "star re-export is skipped" \
    "export * from './bar.js';" ''

# --- Regression guards for the anchoring choices
run_scenario "trailing comment mentioning 'from' is not a barrel" \
    'export { Alpha };  // ported from legacy' 'Alpha'
run_scenario "import list is never an export" \
    "import { Alpha } from './bar.js';" ''

# --- Mixed file: both definition forms in one source
run_scenario "inline and list forms combine, deduplicated" \
    "$(printf 'export const Alpha = 1;\nconst Beta = 2;\nexport { Beta };\nexport { Gamma } from '"'"'./x.js'"'"';')" \
    'Alpha Beta'

# --- Real-world shape that the old extractor missed (PR #517)
run_scenario "RenderHealth.ts export shape" \
    "$(printf 'export type { IRenderCounts, IRenderHealth, RenderProbeStatus };\nexport {\n  measureRenderHealth,\n  RENDER_PROBE_TIMEOUT_MS,\n};')" \
    'IRenderCounts IRenderHealth RENDER_PROBE_TIMEOUT_MS RenderProbeStatus measureRenderHealth'

echo
echo "extract-exports: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ] || exit 1
