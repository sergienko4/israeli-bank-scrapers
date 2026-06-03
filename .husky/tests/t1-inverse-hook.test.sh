#!/usr/bin/env bash
# Unit test for the T1-INVERSE pre-commit guard in .husky/pre-commit.
#
# T1-INVERSE blocks production-code (src/Scrapers/**) changes on
# test-only branches (refactor/phase-7-*, refactor/phase-9-*, chore/test-*)
# so test-refactor PRs cannot silently smuggle behaviour changes.
#
# This test extracts the guard's predicate logic and runs it against
# synthetic STAGED_FILES / BRANCH combinations. Run via:
#
#   bash .husky/tests/t1-inverse-hook.test.sh
#
# Exit 0 = all scenarios behave correctly; 1 = a scenario regressed.

set -o pipefail
cd "$(git rev-parse --show-toplevel)"

PASS=0
FAIL=0

run_scenario() {
    local name="$1" branch="$2" staged="$3" expected_exit="$4"
    local actual_exit=0
    local prod_diff
    prod_diff=$(echo "$staged" | grep -E '^src/' \
        | grep -v -E '^src/Tests/' \
        | grep -v -E '^src/Scrapers/Pipeline/EslintCanaries/' \
        || true)
    case "$branch" in
        refactor/phase-7-*|refactor/phase-9-*|chore/test-*)
            if [ -n "$prod_diff" ]; then
                actual_exit=1
            fi
            ;;
    esac

    if [ "$actual_exit" = "$expected_exit" ]; then
        echo "PASS: $name (exit $actual_exit)"
        PASS=$((PASS + 1))
    else
        echo "FAIL: $name (expected exit $expected_exit, got $actual_exit)"
        FAIL=$((FAIL + 1))
    fi
}

run_scenario "test-only branch + test files only" \
    "refactor/phase-7-test-diamond-structural" \
    "src/Tests/Unit/Pipeline/Login.test.ts
src/Tests/Helpers/factory.ts" \
    0

run_scenario "test-only branch + prod file staged (BLOCK)" \
    "refactor/phase-7-test-diamond-structural" \
    "src/Tests/Unit/Pipeline/Login.test.ts
src/Scrapers/Pipeline/Mediator/Login/LoginResolver.ts" \
    1

run_scenario "test-only branch + canary file (ALLOW)" \
    "refactor/phase-9-max-lines" \
    "src/Scrapers/Pipeline/EslintCanaries/new-rule.canary.ts" \
    0

run_scenario "fix/foo branch + prod file (hook inactive)" \
    "fix/some-bug" \
    "src/Scrapers/Pipeline/Mediator/Login/LoginResolver.ts" \
    0

run_scenario "chore/test-* branch + .husky only (ALLOW)" \
    "chore/test-husky-t1-inverse-hook" \
    ".husky/pre-commit" \
    0

run_scenario "phase-7 branch + mixed test+prod (BLOCK)" \
    "refactor/phase-7-flow-diamond" \
    "src/Tests/Unit/Pipeline/Flow/Login.test.ts
src/Scrapers/Pipeline/Strategy/Fetch/FetchStrategy.ts
src/Tests/Helpers/banks.ts" \
    1

run_scenario "chore/test-* + Tests only (ALLOW)" \
    "chore/test-add-helper" \
    "src/Tests/Helpers/new.ts" \
    0

run_scenario "main branch + prod file (hook inactive)" \
    "main" \
    "src/Scrapers/Pipeline/Mediator/Login/LoginResolver.ts" \
    0

run_scenario "phase-7 branch + zero staged (ALLOW)" \
    "refactor/phase-7-test-diamond-structural" \
    "" \
    0

run_scenario "detached HEAD + prod file (hook inactive)" \
    "" \
    "src/Scrapers/Pipeline/Mediator/Login/LoginResolver.ts" \
    0

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] && exit 0 || exit 1
