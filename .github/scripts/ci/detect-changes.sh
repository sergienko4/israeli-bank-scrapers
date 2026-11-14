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
#   ci_scripts  — `.github/scripts/ci/**`, `.github/workflows/**`,
#                 `.github/actions/**` or `.husky/**` was modified (drives
#                 the CI scripts smoke test, which pins the gate wiring).
#                 `scripts/check-shell-portability.mjs` is included for the
#                 same self-testing reason `metrics` exists: it is the gate
#                 that keeps those shell files runnable on macOS and
#                 Windows, and it sits outside every other group, so it
#                 could otherwise be weakened and merged without the job
#                 that runs it ever firing. The scheduled watches —
#                 `scripts/npm-audit/**`, `scripts/npm-audit-watch.mjs`,
#                 `scripts/dev-tooling/**`, `scripts/dev-tooling-watch.mjs`,
#                 `scripts/run-typedoc.mjs` and `typedoc.json`
#                 — are included for the same reason: they run on a cron or
#                 post-merge in `docs.yml`, so `unit-tests` is what proves a
#                 change to them before it merges.
#   metrics     — `scripts/decoupling-metrics/**` was modified. That tree
#                 sits outside both `src/` and `.github/`, so it matched NO
#                 other group: the tool that measures architectural
#                 regressions could itself be weakened and merged without
#                 the gate that depends on it ever running. Same
#                 self-testing role `ci_scripts` plays for the memory gate.
#   test_config — a Jest config (`jest.*.js` / `jest.*.cjs`) or the Jest-scope
#                 checker (`scripts/check-jest-scopes.mjs`) was modified.
#                 These files sit at the repo root, so they match NO other
#                 group: a change to `transformIgnorePatterns`, `moduleNameMapper`
#                 or `testEnvironment` used to reach main with the unit suite
#                 never having run under the new config. Forces `unit-tests`.
#   deps        — `package.json`, `package-lock.json`,
#                 `.github/dependabot.yml`, `renovate.json` or `.nvmrc` was
#                 modified. Forces the
#                 browser E2E gates (e2e-mocked + e2e-factory) to RUN on
#                 dependency-only PRs (e.g. dependabot bumps, Renovate's
#                 weekly lockfile maintenance) that touch
#                 no `src/` file. Without this a runtime-dependency bump
#                 could land UNvalidated against the bank APIs.
#                 Also forces `unit-tests`: a bump to a test-time dependency
#                 (`@jest/globals`, `@types/*`, `ts-jest`) can only surface
#                 there, and those bumps touch no `src/` file either.
#                 `.nvmrc` is the Node every single-version job installs and
#                 the version `unit-tests` picks its coverage leg from, yet it
#                 matched NO group: a PR moving it alone skipped `unit-tests`
#                 and the `lint:node-support` check that ties it to
#                 `engines.node` and the matrix.
#   critical_deps — a critical runtime package moved: one of the production
#                 dependencies in `package.json` (HTML parsing, date/time,
#                 logging, AST). `deps` alone says "a manifest moved" — it
#                 cannot say WHICH package, so it only buys the two E2E jobs.
#                 These packages ARE the runtime for every bank, so a bump must
#                 clear the SAME gates as a `src/` change (build, integration,
#                 bank coverage, the 17-bank smoke matrix, and the real-bank
#                 gates).
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

# Emit every flag as true and stop. Used whenever we cannot establish
# what changed: over-running the suite is recoverable, silently skipping
# every gate is not.
emit_fail_open() {
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
    echo "public_surface=true"
    echo "syntax_guardrails=true"
    echo "full_suite=true"
  } >> "$GITHUB_OUTPUT"
}

if [ -z "${BASE_SHA:-}" ] || [ "${BASE_SHA}" = "${ZERO_SHA}" ]; then
  echo "[detect-changes] No usable BASE_SHA — assuming all groups touched (full validate)."
  emit_fail_open
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
#
# `--no-renames` keeps a rename visible as a delete plus an add. Git
# detects renames by default and `--name-only` then prints only the
# destination, so moving a guarded file to an unwatched path would
# leave its flag false and skip the job that would notice it had gone.
#
# A failed diff is not an empty diff. If the base is unreachable and the
# fetch above did not recover it, both commands fail; treating that as
# "nothing changed" would skip every gate on a green run, so fail open.
if changed_files=$(git diff --name-only --no-renames "${BASE_SHA}...HEAD" 2>/dev/null); then
  :
elif changed_files=$(git diff --name-only --no-renames "${BASE_SHA}" HEAD 2>/dev/null); then
  :
else
  echo "[detect-changes] Cannot diff against ${BASE_SHA} — assuming all groups touched." >&2
  emit_fail_open
  exit 0
fi

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
    echo "public_surface=false"
    echo "syntax_guardrails=false"
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
  grep -qE "$1" <<< "${changed_files}"
}

# A critical runtime package bump needs the same coverage as a `src/` edit.
# The declared range or the resolved version is compared between base and HEAD.
#
# Comparing versions rather than grepping the manifest diff matters: a diff
# grep cannot tell a real bump from noise, because `npm i` rewrites a trailing
# comma onto an untouched dependency line whenever a later key is removed.
CRITICAL_PACKAGES=(
  '@babel/parser'
  'moment'
  'moment-timezone'
  'parse5'
  'pino'
)

# Declared range from package.json, e.g. `"moment": "^2.30.1"`.
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
public_surface=false
syntax_guardrails=false
full_suite=false

if has '^src/'; then src=true; fi
if has '\.md$'; then md=true; fi
if has '^docs/|^mkdocs_hooks/|^mkdocs\.yml$|^requirements-docs\.txt$|^typedoc\.json$|^scripts/run-typedoc\.mjs$|^compatibility\.json$|^scripts/build-compatibility\.mjs$'; then docs=true; fi
if has '^src/Scrapers/Pipeline/.*\.ts$'; then pipeline_ts=true; fi
if has '^\.github/scripts/ci/|^\.github/workflows/|^\.github/actions/|^\.husky/|^scripts/check-shell-portability\.mjs$|^scripts/npm-audit/|^scripts/npm-audit-watch\.mjs$|^scripts/dev-tooling/|^scripts/dev-tooling-watch\.mjs$|^typedoc\.json$|^scripts/run-typedoc\.mjs$'; then ci_scripts=true; fi
if has '^package\.json$|^package-lock\.json$|^\.github/dependabot\.yml$|^renovate\.json$|^\.nvmrc$'; then deps=true; fi
if has '^jest\..*\.(js|cjs|mjs|ts)$|^jest\.config\.(js|cjs|mjs|ts)$|^scripts/check-jest-scopes\.mjs$'; then test_config=true; fi
if has '^scripts/decoupling-metrics/'; then metrics=true; fi
# Everything that defines the published API surface or the check that guards
# it. `full_suite` is `src OR critical_deps` and so misses a snapshot-only,
# checker-only or build-config-only change — exactly the edits most able to
# disable the guard. `tsconfig.json` is included because `tsconfig.build.json`
# extends it, and `package-lock.json` because it pins the resolved tsup and
# TypeScript versions that generate the declarations.
public_surface_paths='^api-surface\.d\.ts$'
public_surface_paths="${public_surface_paths}|^scripts/check-public-surface\.mjs$"
public_surface_paths="${public_surface_paths}|^scripts/normalize-public-exports\.mjs$"
public_surface_paths="${public_surface_paths}|^tsup\.config\.ts$"
public_surface_paths="${public_surface_paths}|^tsconfig\.build\.json$|^tsconfig\.json$"
public_surface_paths="${public_surface_paths}|^\.github/actions/build-package/"
public_surface_paths="${public_surface_paths}|^package\.json$|^package-lock\.json$"
if has "${public_surface_paths}"; then public_surface=true; fi

# The restricted-syntax guardrail set and the gate that proves it resolves.
# Kept out of `full_suite` (pinned to `src OR critical_deps` by
# CriticalDepsFullSuiteGate.test.ts) for the same reason as `public_surface`:
# a config-only or checker-only edit is precisely the change most able to
# disarm the guard, and it touches no file under `src/`.
# `package.json` is in the set because the gate is reached through the
# `lint:syntax-guardrails` npm script: deleting or redirecting that script
# would otherwise silently skip the guard while every group stayed false.
# `eslint.canary-scope.mjs` is in the set because `eslint.config.mjs`
# imports it directly and it decides which files the guard even sees —
# editing it alone would otherwise skip lint entirely.
# `eslint/` is in the set because the flat config is split across
# `eslint/rules/` and `eslint/clusters/`; editing a rule there alone is a
# config-only change that touches no file under `src/`.
# `biome.json` is in the set because it is Biome's whole configuration: a
# PR that loosens or disables a Biome rule touches no file under `src/`.
# `tsconfig.json` is in the set because the ESLint config turns on
# `parserOptions.projectService`, so the tsconfig IS a lint input: it
# decides which files are in the program and which compiler options the
# type-aware rules see. The canary tree's own tsconfig extends it, so one
# edit moves both programs. It otherwise sets only `public_surface`, which
# does not gate this step. `tsconfig.build.json` is deliberately absent:
# `projectService` resolves the nearest `tsconfig.json`, never that file,
# so it changes the build, not the lint.
if has '^eslint\.config\.mjs$|^eslint/|^eslint\.canary-scope\.mjs$|^scripts/check-syntax-guardrails\.mjs$|^package\.json$|^tsconfig\.json$|^biome\.json$'; then
  syntax_guardrails=true
fi

# Compare against the merge-base, mirroring the `...HEAD` semantics used
# for `changed_files`: main bumping a critical package meanwhile must not be
# attributed to this PR.
merge_base=$(git merge-base "${BASE_SHA}" HEAD 2>/dev/null || echo "${BASE_SHA}")
if [ "$(critical_fingerprint "${merge_base}")" != "$(critical_fingerprint HEAD)" ]; then
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
  echo "public_surface=${public_surface}"
  echo "syntax_guardrails=${syntax_guardrails}"
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
echo "  public_surface=${public_surface}"
echo "  syntax_guardrails=${syntax_guardrails}"
echo "  full_suite=${full_suite}"
