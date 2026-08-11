#!/usr/bin/env bash
# Detect which file groups this PR / push changed.
# ================================================
# Inputs (from env, set by pr.yml validate job):
#   BASE_SHA — the merge-base on the PR target branch, or the SHA
#              before the push on a push-to-main event.
#
# Outputs (written to $GITHUB_OUTPUT, consumed by step-level `if:`
#          guards in pr.yml and by `needs.validate.outputs.*` on
#          downstream jobs):
#   src         — any file under `src/` was modified
#   md          — any `*.md` was modified
#   docs        — `docs/**`, `mkdocs.yml`, `requirements-docs.txt`,
#                 `typedoc.json`, or either half of the compatibility page
#                 (`compatibility.json` data + `build-compatibility.mjs`
#                 renderer) was modified. Both halves must be listed: the
#                 page is generated, so a renderer-only change drifts it
#                 just as a data-only change does, and omitting the
#                 renderer let it bypass the `--check` drift gate.
#   pipeline_ts — `src/Scrapers/Pipeline/**/*.ts` was modified
#                 (drives the docs-coverage canary)
#   ci_scripts  — `.github/scripts/ci/**` or `.github/workflows/**`
#                 was modified (drives the CI scripts smoke test)
#   metrics     — `scripts/decoupling-metrics/**` was modified. That tree
#                 sits outside both `src/` and `.github/`, so it matched NO
#                 other group: the tool that measures architectural
#                 regressions could itself be weakened and merged without
#                 the gate that depends on it ever running. Same
#                 self-testing role `ci_scripts` plays for the memory gate.
#   test_config — a Jest config (`jest.*.js` / `jest.*.cjs`) was modified.
#                 These files sit at the repo root, so they match NO other
#                 group: a change to `transformIgnorePatterns`, `moduleNameMapper`
#                 or `testEnvironment` used to reach main with the unit suite
#                 never having run under the new config. Forces `unit-tests`.
#   deps        — `package.json`, `package-lock.json`, or
#                 `.github/dependabot.yml` was modified. Forces the
#                 browser E2E gates (e2e-mocked + e2e-factory) to RUN on
#                 dependency-only PRs (e.g. dependabot bumps) that touch
#                 no `src/` file. Without this a runtime-dep bump such as
#                 playwright-core could land UNvalidated against Camoufox
#                 (the 1.61.0 `Browser.setDefaultViewport` regression that
#                 broke `browser.newContext` slipped onto main this way).
#                 Also forces `unit-tests`: a bump to a test-time dependency
#                 (`@jest/globals`, `@types/*`, `ts-jest`) can only surface
#                 there, and those bumps touch no `src/` file either.
#   critical_deps — the BROWSER STACK moved: `playwright-core` or Camoufox
#                 (`@hieutran094/camoufox-js`, the pinned browser binary, or
#                 the `scripts/patch-playwright-core.mjs` guard). `deps` alone
#                 says "a manifest moved" — it cannot say WHICH package, so it
#                 only buys the two browser E2E jobs. These packages ARE the
#                 runtime for all 17 banks: a bump changes real navigation,
#                 anti-bot fingerprinting and frame handling, so it must clear
#                 the SAME gates as a `src/` change (build, integration, bank
#                 coverage, the 17-bank smoke matrix, and the real-bank gates).
#   full_suite  — `src OR critical_deps`. The single token every heavy job
#                 gates on, so "runs the full flow" has one definition instead
#                 of an OR-chain duplicated across a dozen `if:` conditions.
#
# Why one detector instead of `paths:` filters per workflow:
# Workflow-level `paths:` filters skip the WHOLE workflow on path
# mismatch, which loses the required-status-check context. Folding
# the detection into a step lets the workflow always fire (satisfying
# branch protection) while still skipping the expensive lint/tsc/build/
# test chain when nothing under src/ was touched. See pr.yml header
# comment for the migration notes.
#
# On `push: main` the `BASE_SHA` value is `github.event.before`. On
# the very first push to a brand-new branch that value is the all-zero
# sentinel; treat that as "no base" and assume every group changed
# (full validate) — better to over-run than to silently skip.

set -euo pipefail

ZERO_SHA="0000000000000000000000000000000000000000"

if [ -z "${BASE_SHA:-}" ] || [ "${BASE_SHA}" = "${ZERO_SHA}" ]; then
  echo "[detect-changes] No usable BASE_SHA — assuming all groups touched (full validate)."
  {
    echo "src=true"
    echo "md=true"
    echo "docs=true"
    echo "pipeline_ts=true"
    echo "ci_scripts=true"
    echo "deps=true"
    echo "test_config=true"
    echo "critical_deps=true"
    echo "metrics=true"
    echo "full_suite=true"
  } >> "$GITHUB_OUTPUT"
  exit 0
fi

# Fetch the base ref if it isn't reachable from the merge commit.
# `actions/checkout` with `fetch-depth: 0` should have pulled the
# full history, but PR merge commits sometimes need an explicit
# fetch to resolve the base.
if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  echo "[detect-changes] BASE_SHA ${BASE_SHA} not local; fetching." >&2
  git fetch --no-tags --depth 1 origin "${BASE_SHA}" 2>/dev/null || true
fi

# `...HEAD` (three dots) compares HEAD against the merge-base with
# BASE_SHA, which is what we want for PRs: files the PR added/changed,
# not files main moved meanwhile.
changed_files=$(git diff --name-only "${BASE_SHA}...HEAD" 2>/dev/null || \
                git diff --name-only "${BASE_SHA}" HEAD 2>/dev/null || \
                echo "")

if [ -z "${changed_files}" ]; then
  echo "[detect-changes] No changed files between BASE_SHA and HEAD — leaving all flags false."
  {
    echo "src=false"
    echo "md=false"
    echo "docs=false"
    echo "pipeline_ts=false"
    echo "ci_scripts=false"
    echo "deps=false"
    echo "test_config=false"
    echo "critical_deps=false"
    echo "metrics=false"
    echo "full_suite=false"
  } >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "[detect-changes] ${BASE_SHA:0:12}...HEAD changed files:"
# Quote the expansion (shellcheck SC2086): paths with spaces or
# glob chars would otherwise be word-split / globbed by printf.
while IFS= read -r file; do
  [ -z "${file}" ] && continue
  printf '  - %s\n' "${file}"
done <<< "${changed_files}"
echo

has() {
  printf '%s\n' "${changed_files}" | grep -qE "$1"
}

# The browser stack — `playwright-core` + Camoufox — is the runtime for
# every bank, so a bump there needs the same coverage as a `src/` edit.
# Two independent signals feed `critical_deps`:
#
#   1. A pinning FILE moved: the script that applies our playwright-core
#      patch, or the composite action that pins the Camoufox browser
#      build. Neither is under `src/`, and `.github/actions/**` is not
#      covered by `ci_scripts` either — so both used to be completely
#      invisible to this detector. The patch signal was `^patches/`
#      until the `patch-package` overlay was replaced by the
#      dependency-free `scripts/patch-playwright-core.mjs`, which now
#      carries the same guard for consumers as well as CI.
#   2. The declared range or the resolved version of a critical package
#      actually MOVED between base and HEAD.
#
# (2) compares versions rather than grepping the manifest diff, because a
# diff grep cannot tell a real bump from noise: `npm i` rewrites a
# trailing comma onto the untouched `"playwright-core": "^1.62.0"` line
# whenever a later key is removed, and any dedupe under
# `node_modules/@hieutran094/camoufox-js/node_modules/**` mentions
# "camoufox" without the browser stack having moved at all. Both fired as
# false positives in testing, which would have degraded `critical_deps`
# into a second, noisier copy of `deps`.
CRITICAL_DEP_PATHS='^scripts/patch-playwright-core\.mjs|^\.github/actions/install-camoufox/'
CRITICAL_PACKAGES=('playwright-core' '@hieutran094/camoufox-js')

# Declared range from package.json, e.g. `"playwright-core": "^1.62.1"`.
declared_range() {
  printf '%s\n' "$1" | grep -m1 -oE "\"$2\": *\"[^\"]+\"" || true
}

# Resolved version from the lockfile. The `": {" suffix anchors the match
# to the TOP-LEVEL entry: nested copies are keyed
# `node_modules/<pkg>/node_modules/<dep>` and cannot collide.
locked_version() {
  printf '%s\n' "$1" | grep -A2 -F "\"node_modules/$2\": {" \
    | grep -m1 -oE '"version": *"[^"]+"' || true
}

# One line per critical package capturing both the declared range and the
# resolved version at a given ref. Base != HEAD means the stack moved.
critical_fingerprint() {
  local ref="$1" manifest lock pkg
  manifest=$(git show "${ref}:package.json" 2>/dev/null || echo "")
  lock=$(git show "${ref}:package-lock.json" 2>/dev/null || echo "")
  for pkg in "${CRITICAL_PACKAGES[@]}"; do
    printf '%s|%s|%s\n' "${pkg}" "$(declared_range "${manifest}" "${pkg}")" \
      "$(locked_version "${lock}" "${pkg}")"
  done
}

src=false
md=false
docs=false
pipeline_ts=false
ci_scripts=false
deps=false
test_config=false
critical_deps=false
metrics=false
full_suite=false

if has '^src/'; then src=true; fi
if has '\.md$'; then md=true; fi
if has '^docs/|^mkdocs\.yml$|^requirements-docs\.txt$|^typedoc\.json$|^compatibility\.json$|^scripts/build-compatibility\.mjs$'; then docs=true; fi
if has '^src/Scrapers/Pipeline/.*\.ts$'; then pipeline_ts=true; fi
if has '^\.github/scripts/ci/|^\.github/workflows/'; then ci_scripts=true; fi
if has '^package\.json$|^package-lock\.json$|^\.github/dependabot\.yml$'; then deps=true; fi
if has '^jest\..*\.(js|cjs|mjs|ts)$|^jest\.config\.(js|cjs|mjs|ts)$'; then test_config=true; fi
if has '^scripts/decoupling-metrics/'; then metrics=true; fi

# Compare against the merge-base, mirroring the `...HEAD` semantics used
# for `changed_files`: main bumping playwright-core meanwhile must not be
# attributed to this PR.
merge_base=$(git merge-base "${BASE_SHA}" HEAD 2>/dev/null || echo "${BASE_SHA}")
if has "${CRITICAL_DEP_PATHS}" \
  || [ "$(critical_fingerprint "${merge_base}")" != "$(critical_fingerprint HEAD)" ]; then
  critical_deps=true
fi
if [ "${src}" = "true" ] || [ "${critical_deps}" = "true" ]; then full_suite=true; fi

{
  echo "src=${src}"
  echo "md=${md}"
  echo "docs=${docs}"
  echo "pipeline_ts=${pipeline_ts}"
  echo "ci_scripts=${ci_scripts}"
  echo "deps=${deps}"
  echo "test_config=${test_config}"
  echo "critical_deps=${critical_deps}"
  echo "metrics=${metrics}"
  echo "full_suite=${full_suite}"
} >> "$GITHUB_OUTPUT"

echo "[detect-changes] decisions:"
echo "  src=${src}"
echo "  md=${md}"
echo "  docs=${docs}"
echo "  pipeline_ts=${pipeline_ts}"
echo "  ci_scripts=${ci_scripts}"
echo "  deps=${deps}"
echo "  test_config=${test_config}"
echo "  critical_deps=${critical_deps}"
echo "  metrics=${metrics}"
echo "  full_suite=${full_suite}"
