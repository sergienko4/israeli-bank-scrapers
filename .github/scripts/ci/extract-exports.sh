#!/usr/bin/env bash
# Public-export extraction for the docs-coverage canary.
# =====================================================
# Sourced by `.github/scripts/ci/docs-coverage.sh` and exercised
# directly by `.github/scripts/ci/tests/extract-exports.test.sh`.
#
# It lives in its own file so the test can drive the REAL extractor
# instead of re-implementing its regexes — a gate whose test copies
# the logic proves nothing about the gate.
#
# Two export forms carry a documentable symbol name:
#
#   1. Inline declaration    `export const Foo = …`
#   2. Local export list     `export { Foo };`  /  `export type { Foo };`
#
# A third form deliberately carries none:
#
#   3. Re-export barrel      `export { Foo } from './bar.js';`
#
# Form 3 is skipped by design: the symbol is *defined* elsewhere and is
# documented at that definition site, so charging the barrel for it would
# demand the same doc entry twice. Forms 1 and 2 are both definition
# sites and are both in scope.
#
# Historical note — why form 2 exists here at all: until 2026-08 the
# extractor understood form 1 only. Because `{` is not in `[A-Za-z_]`,
# `export { Foo };` matched nothing, so ~58% of Pipeline files were
# invisible to the gate. PR #517 added `RenderHealth.ts` and
# `ElementIdentity.ts` — both brand-new files using form 2 — and the
# gate reported "0 missing" while CodeRabbit flagged those very exports
# as undocumented. See docs/workflow/docs-coverage.md.

# Form 1. Anchored at column 0 so declarations nested inside a namespace
# or class body are not mistaken for top-level exports.
EXPORT_REGEX='^export (abstract +)?(async +)?(function|const|class|type|interface|enum)[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)'

# Form 2. A small awk state machine, because an export list may span
# lines and `sed` is line-at-a-time:
#
#   export {
#     alpha,
#     beta,
#   };
#
# Accumulates from `export {` until the first `}`, then decides.
EXPORT_LIST_AWK='
function emit(s,   ob, cb, body, after, n, i, parts, sym) {
  ob = index(s, "{")
  cb = index(s, "}")
  if (ob == 0 || cb == 0 || cb < ob) return
  body  = substr(s, ob + 1, cb - ob - 1)
  after = substr(s, cb + 1)
  # `from` must sit immediately after the brace to make this a re-export
  # barrel. Anchoring here (rather than searching the whole tail) stops a
  # trailing comment such as `};  // ported from legacy` from being
  # misread as a barrel and silently dropping real symbols.
  if (after ~ /^[ \t]*from[^A-Za-z0-9_]/) return
  n = split(body, parts, ",")
  for (i = 1; i <= n; i++) {
    sym = parts[i]
    gsub(/^[ \t]+|[ \t]+$/, "", sym)
    sub(/^type[ \t]+/, "", sym)
    # `export { internal as Public }` publishes `Public`, not `internal`.
    if (sym ~ /[ \t]as[ \t]/) sub(/^.*[ \t]as[ \t]+/, "", sym)
    gsub(/^[ \t]+|[ \t]+$/, "", sym)
    # `export { x as default }` publishes the module default, which has no
    # documentable symbol name. Drop it rather than demand docs for "default".
    if (sym == "default") continue
    # Drops the empty slot left by a trailing comma and anything that is
    # not a plain identifier.
    if (sym ~ /^[A-Za-z_][A-Za-z0-9_]*$/) print sym
  }
}
/^export[ \t]*(type[ \t]+)?\{/ {
  buf = $0
  if (index(buf, "}") > 0) { emit(buf); buf = ""; next }
  inlist = 1
  next
}
inlist == 1 {
  buf = buf " " $0
  if (index($0, "}") > 0) { inlist = 0; emit(buf); buf = "" }
  next
}
'

extract_symbols() {
  # Reads a TS file's content on stdin, prints one export name per line.
  # stdin is consumed once into a variable because both extractors need
  # a full pass over the same content.
  local content
  content="$(cat)"
  {
    printf '%s\n' "$content" | sed -nE "s/${EXPORT_REGEX}.*/\4/p"
    printf '%s\n' "$content" | awk "${EXPORT_LIST_AWK}"
  } | sort -u
}
