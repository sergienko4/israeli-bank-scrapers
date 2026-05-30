#!/usr/bin/env bash
# Docs coverage canary
# ====================
# Fails CI when a new public export under `src/Scrapers/Pipeline/`
# ships without any mention in `docs/`.
#
# Inputs (from env, set by .github/workflows/docs-coverage.yml):
#   BASE_SHA  — the merge-base commit on the PR's target branch.
#               Used as the "before" snapshot for symbol diffing.
#   BASE_REF  — informational; printed in the failure message so the
#               reviewer knows which branch we diffed against.
#
# Algorithm:
#   1. Enumerate Pipeline TS files changed between BASE_SHA..HEAD.
#   2. For each file:
#        a. Extract public top-level export names from HEAD content.
#        b. Extract public top-level export names from BASE_SHA content
#           (empty set if the file did not exist at BASE_SHA).
#        c. NEW = HEAD set minus BASE set.
#   3. For each NEW symbol:
#        - Skip if listed in `.github/docs-coverage-allowlist.txt`.
#        - Else: `grep -rqw "$symbol" docs/`. Pass if ≥1 match, else
#          add to missing[].
#   4. If missing[] is non-empty, print a structured failure report
#      and exit 1.
#
# Why symbol-set-diff instead of `git diff +` line parsing:
# `+` lines include reformatted, moved, or rewritten code that was
# already exported under the same name. We want NEW symbols only —
# i.e. names present in HEAD that did not exist on the base branch.
# Comparing sets is robust against reorder/rename-of-surroundings.

set -euo pipefail

BASE_SHA="${BASE_SHA:?BASE_SHA must be set (workflow env)}"
BASE_REF="${BASE_REF:-main}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ALLOWLIST_FILE="${REPO_ROOT}/.github/docs-coverage-allowlist.txt"
DOCS_DIR="${REPO_ROOT}/docs"
SCOPE_PREFIX='src/Scrapers/Pipeline/'

# Public top-level exports we care about. Matches:
#   export function Foo
#   export const Foo
#   export class Foo
#   export type Foo
#   export interface Foo
#   export enum Foo
#   export abstract class Foo
# Does NOT match:
#   export { Foo } from './bar.js'   (re-export barrel)
#   export default ...               (no symbol name to grep)
#   export async function Foo        (covered — `async` between
#                                     keyword + name handled by [^=]*)
# Regex anchors at column 0 so functions inside namespaces or
# classes aren't accidentally picked up.
EXPORT_REGEX='^export (abstract +)?(async +)?(function|const|class|type|interface|enum)[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)'

extract_symbols() {
  # Reads a TS file's content on stdin, prints one export name per line.
  # Uses `sed -E` (extended regex) since EXPORT_REGEX uses groups.
  sed -nE "s/${EXPORT_REGEX}.*/\4/p" | sort -u
}

load_allowlist() {
  if [ ! -f "$ALLOWLIST_FILE" ]; then
    echo ""
    return
  fi
  # Strip comments (# …) + blank lines; preserve symbol names only.
  # `grep -v` returns exit 1 when nothing matched (e.g. allowlist
  # holds only comments/blank lines — current state) — that would
  # trip `set -o pipefail` and abort the calling script. Swallow it.
  #
  # Per-line whitespace trim (sed) — NOT `tr -d '[:space:]'`, which
  # would also strip newlines and collapse every symbol onto a single
  # line, breaking the `grep -qx "$sym"` whole-line match downstream
  # (Phase 5 PR #277 was the first real test of this code path; the
  # allowlist held only comments until then, hiding the bug).
  { grep -vE '^\s*(#|$)' "$ALLOWLIST_FILE" || true; } \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sort -u
}

# Resolve base — handles same-repo PRs and pre-fetched checkouts.
if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  echo "[docs-coverage] BASE_SHA ${BASE_SHA} not reachable; fetching ${BASE_REF}." >&2
  git fetch --no-tags --depth 1 origin "${BASE_SHA}" 2>/dev/null \
    || git fetch --no-tags origin "${BASE_REF}"
fi

# Changed Pipeline TS files. --diff-filter=AMR includes added,
# modified, and renamed files; --find-renames makes git emit the
# pre-rename path alongside the post-rename path so we can diff
# the symbol set against the SAME source file even after a move.
# Without rename tracking, a pure rename would look up
# `git show ${BASE_SHA}:<new-path>` (which doesn't exist on BASE),
# fall back to an empty base set, and every existing export would
# read as new — false-positive failures on rename-only PRs.
declare -a CHANGED_FILES=()
declare -A BASE_PATH_BY_HEAD=()  # post-rename path → pre-rename path

while IFS=$'\t' read -r status path_a path_b; do
  case "${status}" in
    R*) head_path="${path_b}"; base_path="${path_a}" ;;
    A|M) head_path="${path_a}"; base_path="${path_a}" ;;
    *) continue ;;
  esac
  # Apply the same scope/exclusion filters as the old mapfile.
  case "${head_path}" in
    "${SCOPE_PREFIX}"*.ts) ;;
    *) continue ;;
  esac
  case "${head_path}" in
    *.test.ts | */Tests/* | */EslintCanaries/* | *.canary.ts) continue ;;
  esac
  CHANGED_FILES+=("${head_path}")
  BASE_PATH_BY_HEAD["${head_path}"]="${base_path}"
done < <(git diff --name-status --find-renames --diff-filter=AMR \
           "${BASE_SHA}...HEAD" -- "${SCOPE_PREFIX}")

if [ "${#CHANGED_FILES[@]}" -eq 0 ]; then
  echo "[docs-coverage] No Pipeline production-code files changed. Skipping."
  exit 0
fi

echo "[docs-coverage] Diffing against ${BASE_REF} @ ${BASE_SHA:0:12}"
echo "[docs-coverage] ${#CHANGED_FILES[@]} Pipeline file(s) touched:"
for f in "${CHANGED_FILES[@]}"; do
  base_p="${BASE_PATH_BY_HEAD[$f]:-$f}"
  if [ "${base_p}" != "${f}" ]; then
    echo "  - ${f}  (renamed from ${base_p})"
  else
    echo "  - ${f}"
  fi
done
echo

ALLOWLIST="$(load_allowlist)"

declare -a NEW_SYMBOLS=()
declare -A SYMBOL_OWNERS=()  # symbol → first file that introduced it

for file in "${CHANGED_FILES[@]}"; do
  # HEAD set (working copy on this CI runner == merge commit HEAD).
  if [ -f "${REPO_ROOT}/${file}" ]; then
    head_syms="$(extract_symbols < "${REPO_ROOT}/${file}")"
  else
    head_syms=""
  fi

  # BASE set. Look up using the PRE-rename path so a rename without
  # any export changes resolves to the same symbol set on both sides
  # and produces an empty NEW diff. `git show` still errors when the
  # file is genuinely new (`A` status, base_path == head_path that
  # didn't exist on BASE) — treat that as an empty set.
  base_file="${BASE_PATH_BY_HEAD[$file]:-$file}"
  if base_content="$(git show "${BASE_SHA}:${base_file}" 2>/dev/null)"; then
    base_syms="$(printf '%s\n' "$base_content" | extract_symbols)"
  else
    base_syms=""
  fi

  # NEW = HEAD \ BASE (set difference).
  if [ -z "$head_syms" ]; then continue; fi
  diff_new="$(comm -23 <(printf '%s\n' "$head_syms") <(printf '%s\n' "$base_syms"))"

  while IFS= read -r sym; do
    [ -z "$sym" ] && continue
    NEW_SYMBOLS+=("$sym")
    [ -z "${SYMBOL_OWNERS[$sym]:-}" ] && SYMBOL_OWNERS[$sym]="$file"
  done <<< "$diff_new"
done

if [ "${#NEW_SYMBOLS[@]}" -eq 0 ]; then
  echo "[docs-coverage] No new public Pipeline exports in this PR. PASS."
  exit 0
fi

echo "[docs-coverage] New public Pipeline exports detected:"
for sym in "${NEW_SYMBOLS[@]}"; do
  echo "  + ${sym}    (from ${SYMBOL_OWNERS[$sym]})"
done
echo

declare -a MISSING=()
declare -a ALLOWLISTED=()
declare -a DOCUMENTED=()

for sym in "${NEW_SYMBOLS[@]}"; do
  if printf '%s\n' "$ALLOWLIST" | grep -qx "$sym"; then
    ALLOWLISTED+=("$sym")
    continue
  fi
  # `-w` = whole-word match so `Page` doesn't match `PageContext`.
  # `-r` walks the entire docs/ tree; -q is silent — we only care
  # about the exit code.
  if grep -rqw -- "$sym" "$DOCS_DIR" 2>/dev/null; then
    DOCUMENTED+=("$sym")
  else
    MISSING+=("$sym")
  fi
done

echo "[docs-coverage] Coverage breakdown:"
echo "  documented:   ${#DOCUMENTED[@]}"
echo "  allowlisted:  ${#ALLOWLISTED[@]}"
echo "  missing:      ${#MISSING[@]}"
echo

if [ "${#MISSING[@]}" -eq 0 ]; then
  echo "[docs-coverage] All new public Pipeline exports are mentioned in docs/. PASS."
  exit 0
fi

cat >&2 <<EOF
[docs-coverage] FAIL — these symbols are exported from
src/Scrapers/Pipeline/ but never mentioned in docs/:

EOF
for sym in "${MISSING[@]}"; do
  echo "  - ${sym}    (introduced in ${SYMBOL_OWNERS[$sym]})" >&2
done
cat >&2 <<EOF

Fix options (pick ONE):

  1. Document it. Add a short mention to the relevant page under
     docs/ (e.g. docs/architecture/, docs/phases/, docs/observability/).
     A one-liner referencing the symbol name by word is enough to
     satisfy this gate — the doc page itself should explain when /
     why a consumer would reach for it.

  2. Make it internal. If the symbol is not part of the public API,
     drop the leading \`export\` keyword. Pipeline tests under
     src/Tests/Unit/Pipeline/ that need cross-module access should
     import via the existing internal barrel files rather than
     promoting the symbol to public surface.

  3. Allowlist it. If the symbol is intentionally exported but not
     part of the user-facing guide (test helpers, framework-internal
     factories, deprecated re-exports during migration), add it to
     .github/docs-coverage-allowlist.txt with a \`# Reason:\` comment
     on the preceding line.

See docs/observability/ for examples of the documentation style.
EOF

exit 1
