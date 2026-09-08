#!/usr/bin/env bash
# Unit test for the portable string-keyed map helpers.
#
# Sources the REAL helpers from portable-map.sh and drives them with
# the key shapes the gate scripts actually use — repo-relative file
# paths and TypeScript identifiers — so a regression in the map
# implementation is caught here rather than by a gate silently
# reporting the wrong answer on one contributor's OS.
#
# The point of these helpers is bash 3.2 support (macOS ships 3.2,
# which has no `declare -A`). Run it under the OLDEST bash you have —
# on macOS that is the system one, which is the real floor:
#
#   /bin/bash .github/scripts/ci/tests/portable-map.test.sh   # 3.2
#   npm run lint:shell-tests                                  # PATH bash
#
# Exit 0 = every scenario matched; 1 = a scenario regressed.

set -euo pipefail
# Resolve the repo root from this file's own location rather than via
# `git rev-parse`, so the test stays runnable in any checkout regardless
# of cwd and without depending on git being on PATH.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

# shellcheck source=.github/scripts/ci/portable-map.sh
. .github/scripts/ci/portable-map.sh

PASS=0
FAIL=0

# Asserts that `actual` equals `expected` ("" means "empty output").
assert_eq() {
    local name="$1" actual="$2" expected="${3-}"
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

# Asserts that `cmd...` exits 0 (expected=yes) or non-zero (expected=no).
assert_status() {
    local name="$1" expected="$2"
    shift 2
    local actual=no
    if "$@"; then actual=yes; fi
    assert_eq "$name" "$actual" "$expected"
}

# --- Basic put / get -------------------------------------------------
M=''
map_put M 'src/Alpha.ts' 'docs/alpha.md'
assert_eq "get returns the stored value" "$(map_get M 'src/Alpha.ts')" 'docs/alpha.md'
assert_eq "get on a missing key is empty" "$(map_get M 'src/Nope.ts')" ''

# An empty map must not explode under `set -u`.
EMPTY=''
assert_eq "get on an empty map is empty" "$(map_get EMPTY 'anything')" ''
assert_status "has on an empty map is false" no map_has EMPTY 'anything'

# A never-assigned map variable must also be safe under `set -u`,
# because callers declare maps lazily inside `if` branches.
assert_eq "get on an unset map var is empty" "$(map_get NEVER_ASSIGNED 'k')" ''

# --- Multi-value keys -------------------------------------------------
# docs-staleness binds ONE source file to MANY docs pages.
MULTI=''
map_put MULTI 'src/Shared.ts' 'docs/one.md'
map_put MULTI 'src/Shared.ts' 'docs/two.md'
map_put MULTI 'src/Other.ts' 'docs/three.md'
assert_eq "get is first-wins on a duplicated key" \
    "$(map_get MULTI 'src/Shared.ts')" 'docs/one.md'
assert_eq "get_all returns every value for the key" \
    "$(map_get_all MULTI 'src/Shared.ts' | tr '\n' ' ' | sed 's/ *$//')" \
    'docs/one.md docs/two.md'
assert_eq "get_all does not leak other keys' values" \
    "$(map_get_all MULTI 'src/Other.ts')" 'docs/three.md'
assert_eq "get_all on a missing key is empty" \
    "$(map_get_all MULTI 'src/Ghost.ts')" ''

# --- Membership -------------------------------------------------------
assert_status "has finds a present key" yes map_has MULTI 'src/Other.ts'
assert_status "has rejects an absent key" no map_has MULTI 'src/Ghost.ts'

# A key whose VALUE is empty must still register as present — this is
# how a set (rather than a map) is modelled.
SET=''
map_put SET 'docs/touched.md' ''
assert_status "has finds a key stored with an empty value" yes map_has SET 'docs/touched.md'

# --- Exact-match discipline ------------------------------------------
# These are the scenarios a naive `grep "$key"` implementation gets
# WRONG. Keys must match whole-field and literally, never as a
# substring and never as a regex.
PREFIX=''
map_put PREFIX 'src/A.ts' 'short'
map_put PREFIX 'src/A.ts.bak' 'long'
assert_eq "a longer key is not returned for its prefix" \
    "$(map_get PREFIX 'src/A.ts')" 'short'
assert_eq "a prefix key is not returned for the longer key" \
    "$(map_get PREFIX 'src/A.ts.bak')" 'long'
assert_status "a key that is only a substring is absent" no map_has PREFIX 'src/A.t'

REGEX=''
map_put REGEX 'src/[bracket].ts' 'bracket'
map_put REGEX 'src/a.b.ts' 'dots'
assert_eq "bracket metacharacters are matched literally" \
    "$(map_get REGEX 'src/[bracket].ts')" 'bracket'
assert_eq "a dot does not match an arbitrary character" \
    "$(map_get REGEX 'src/a.b.ts')" 'dots'
assert_status "a regex-equivalent key does not match" no map_has REGEX 'src/aXb.ts'

# --- Whitespace-bearing keys and values -------------------------------
SPACED=''
map_put SPACED 'docs/my page.md' 'src/My File.ts'
assert_eq "keys and values may contain spaces" \
    "$(map_get SPACED 'docs/my page.md')" 'src/My File.ts'

# --- Insertion order is preserved -------------------------------------
# docs-coverage prints new symbols in discovery order; a map that
# reorders would churn the report between runs.
ORDERED=''
map_put ORDERED 'k' 'first'
map_put ORDERED 'k' 'second'
map_put ORDERED 'k' 'third'
assert_eq "get_all preserves insertion order" \
    "$(map_get_all ORDERED 'k' | tr '\n' ' ' | sed 's/ *$//')" \
    'first second third'

# --- Independence -----------------------------------------------------
# Two maps in the same shell must not bleed into each other.
A_MAP=''
B_MAP=''
map_put A_MAP 'shared-key' 'from-a'
map_put B_MAP 'shared-key' 'from-b'
assert_eq "maps are independent (a)" "$(map_get A_MAP 'shared-key')" 'from-a'
assert_eq "maps are independent (b)" "$(map_get B_MAP 'shared-key')" 'from-b'

# --- Mutation inside a while-read loop --------------------------------
# Both gate scripts populate their maps from `while read ... done < <(...)`.
# That must mutate the CALLER's variable, not a subshell copy.
LOOP=''
while IFS= read -r item; do
    [ -z "$item" ] && continue
    map_put LOOP "$item" "seen-$item"
done < <(printf 'one\ntwo\nthree\n')
assert_eq "puts inside a while-read loop persist" \
    "$(map_get LOOP 'two')" 'seen-two'

echo
echo "portable-map: ${PASS} passed, ${FAIL} failed (bash ${BASH_VERSION})"
[ "$FAIL" -eq 0 ]
