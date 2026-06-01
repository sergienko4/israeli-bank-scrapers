#!/usr/bin/env bash
# Docs staleness gate (Case B)
# ============================
# Fails when a source file is modified BUT its declared docs page
# was NOT modified in the same diff. Complements docs-coverage.sh
# which only catches NEW public exports (Case A). Together they
# enforce "docs are not just present once — they stay synchronised
# with the code they describe".
#
# Inputs (env):
#   BASE_SHA   — merge-base on the PR target branch (CI mode) OR
#                the base commit to diff staged content against
#                (local mode, see STAGE_MODE).
#   BASE_REF   — informational; printed in the failure message.
#   STAGE_MODE — when '1', diff STAGED content (git diff --cached)
#                against BASE_SHA instead of BASE_SHA..HEAD. Use
#                this from husky pre-commit, where HEAD is still
#                the parent commit and BASE_SHA..HEAD is empty.
#
# Algorithm:
#   1. Walk docs/**/*.md; extract YAML front-matter `source-files:`
#      lists. Build inverted map src_file -> [doc_file, ...].
#   2. Enumerate changed source files in this diff.
#   3. For each changed source file that appears in the map,
#      check whether ANY of its declared doc files is also in the
#      diff. If none are, the source change is "stale" — fail.
#   4. Source files NOT in the map are silently exempt (opt-in
#      contract — frontmatter is the only way to enrol a doc page).
#
# Failure example:
#   src/Scrapers/Pipeline/Mediator/Init/InitActions.ts was edited
#   in this PR. It is declared as a source-file in
#   docs/observability/init-navigation-forensics.md, but that page
#   was not touched. Either update the page OR remove InitActions.ts
#   from its source-files list if the change is internal-only.

set -euo pipefail

BASE_SHA="${BASE_SHA:?BASE_SHA must be set}"
BASE_REF="${BASE_REF:-main}"
STAGE_MODE="${STAGE_MODE:-0}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DOCS_DIR="${REPO_ROOT}/docs"

# Resolve base — same retry pattern as docs-coverage.sh.
if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  echo "[docs-staleness] BASE_SHA ${BASE_SHA} not reachable; fetching ${BASE_REF}." >&2
  git fetch --no-tags --depth 1 origin "${BASE_SHA}" 2>/dev/null \
    || git fetch --no-tags origin "${BASE_REF}"
fi

# Build the inverted map by parsing YAML frontmatter from every
# docs/**/*.md file. Frontmatter is the lines between the first
# pair of `---` markers at the very top of the file. We look for
# the `source-files:` key and its list items.
#
# Output of the map: TSV — one "src_file<TAB>doc_file" row per
# enrolled (src, doc) pair. Sorted for stable diffing.
build_inverted_map() {
  local doc src in_fm=0 in_sf=0
  while IFS= read -r -d '' doc; do
    in_fm=0; in_sf=0
    while IFS= read -r line || [ -n "$line" ]; do
      # Strip trailing \r so the regex below works on CRLF files
      # (markdown edited on Windows often ships with CRLF endings).
      line="${line%$'\r'}"
      if [ "$in_fm" -eq 0 ]; then
        [ "$line" = "---" ] && in_fm=1
        continue
      fi
      if [ "$line" = "---" ]; then
        break
      fi
      if [[ "$line" =~ ^source-files:[[:space:]]*$ ]]; then
        in_sf=1
        continue
      fi
      if [ "$in_sf" -eq 1 ]; then
        if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*(.+)$ ]]; then
          src="${BASH_REMATCH[1]}"
          # Trim surrounding quotes/whitespace.
          src="${src#\"}"; src="${src%\"}"
          src="${src#\'}"; src="${src%\'}"
          src="${src#"${src%%[![:space:]]*}"}"
          src="${src%"${src##*[![:space:]]}"}"
          [ -n "$src" ] && printf '%s\t%s\n' "$src" "${doc#${REPO_ROOT}/}"
          continue
        fi
        # Any other non-list line ends the source-files block.
        [[ "$line" =~ ^[A-Za-z] ]] && in_sf=0
      fi
    done < "$doc"
  done < <(find "${DOCS_DIR}" -type f -name '*.md' -print0)
}

# Changed file list — CI mode or STAGE_MODE.
list_changed_files() {
  if [ "$STAGE_MODE" = "1" ]; then
    # Diff STAGED tree against BASE_SHA. This captures both:
    #   - pre-commit (husky): newly staged changes vs main
    #   - post-commit (manual rerun): whole-branch diff vs main
    # because STAGED == HEAD when nothing extra is staged.
    git diff --cached --name-only --diff-filter=AMR "${BASE_SHA}"
  else
    git diff --name-only --diff-filter=AMR "${BASE_SHA}...HEAD"
  fi
}

MAP="$(build_inverted_map | sort -u)"
if [ -z "$MAP" ]; then
  echo "[docs-staleness] No docs pages declare source-files: yet. Nothing to enforce. PASS."
  exit 0
fi

CHANGED="$(list_changed_files | sort -u)"
if [ -z "$CHANGED" ]; then
  echo "[docs-staleness] No changed files in this diff. PASS."
  exit 0
fi

# Sets of (a) declared source files and (b) docs files touched.
declare -A DECLARED_SRC=()
declare -A DOCS_TOUCHED=()
while IFS=$'\t' read -r src doc; do
  DECLARED_SRC["$src"]+="${doc}"$'\n'
done <<< "$MAP"

while IFS= read -r f; do
  case "$f" in
    docs/*.md|docs/**/*.md) DOCS_TOUCHED["$f"]=1 ;;
  esac
done <<< "$CHANGED"

# Walk changed source files; report stale.
declare -a STALE=()
while IFS= read -r f; do
  # Only consider source files (skip docs and configs).
  case "$f" in
    docs/*) continue ;;
    *.md) continue ;;
  esac
  declared="${DECLARED_SRC[$f]:-}"
  [ -z "$declared" ] && continue
  any_touched=0
  while IFS= read -r doc; do
    [ -z "$doc" ] && continue
    if [ -n "${DOCS_TOUCHED[$doc]:-}" ]; then
      any_touched=1
      break
    fi
  done <<< "$declared"
  if [ "$any_touched" -eq 0 ]; then
    STALE+=("$f")
  fi
done <<< "$CHANGED"

if [ "${#STALE[@]}" -eq 0 ]; then
  echo "[docs-staleness] All changed source files with declared docs were paired with docs updates. PASS."
  exit 0
fi

cat >&2 <<EOF
[docs-staleness] FAIL — these source files were modified but their
declared docs pages were NOT updated in the same diff:

EOF
for f in "${STALE[@]}"; do
  echo "  - ${f}" >&2
  while IFS= read -r doc; do
    [ -z "$doc" ] && continue
    echo "      declared in: ${doc}" >&2
  done <<< "${DECLARED_SRC[$f]}"
done
cat >&2 <<EOF

Fix options (pick ONE):

  1. Update the docs page. Reflect whatever changed in the source
     file. Even a one-line clarification or example tweak satisfies
     the gate — the goal is "docs and code move together".

  2. Remove the source-files binding. If the change is genuinely
     internal-only (refactor, test scaffolding) and does not affect
     anything the docs describe, drop the file from the docs page's
     \`source-files:\` frontmatter list.

  3. (Last resort) Allowlist the binding. There is no allowlist for
     staleness — by design. If you find yourself wanting one, prefer
     option 2 and let the docs declare a narrower, truer surface.

See docs/observability/init-navigation-forensics.md for a worked
example of the source-files frontmatter convention.
EOF

exit 1
