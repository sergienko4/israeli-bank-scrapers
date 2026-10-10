#!/usr/bin/env bash
# ??????????????????????????????????????????????????????????????
# Compute gate booleans (single source of truth for `if:` conditions).
#
# Emits two GitHub Actions outputs:
#
#   trusted_event       ? true unless this is a PR from a fork (head repo ? base repo).
#                         Used by jobs that touch secrets / external services and must
#                         NEVER run on untrusted fork PRs (e.g. real-bank E2E matrices).
#
#   real_gates_enabled  ? true ONLY when ALL prerequisites hold for running the heavy
#                         real-network / CPU-intensive gates:
#                           1. trusted_event             (excludes fork PRs)
#                           2. PR author is not a dependency bot (dependabot[bot] or
#                              renovate[bot]); stable across reruns because it uses
#                              pull_request.user.login, NOT github.actor
#                           3. full_suite                 (src/ touched OR the browser
#                              stack moved ? see detect-changes.sh `critical_deps`;
#                              skips docs-only / chore PRs)
#                         workflow_dispatch is treated as trusted + skips the src filter
#                         (operator manually triggered ? assume intent).
#
# Note on (2): a Dependabot-authored playwright-core / camoufox bump still cannot
# reach the real gates, because Dependabot PRs run with restricted secrets and the
# bank credentials would resolve empty. The supported path for validating a browser
# stack bump end-to-end is to re-raise it on a maintainer-owned branch, where
# `full_suite` then unlocks the same gates a `src/` PR gets.
#
# Renovate's weekly lockfile-maintenance PR is excluded for the opposite reason:
# it lives on a same-repo branch, so it WOULD receive the full bank secrets while
# `npm ci` runs install scripts from packages no maintainer has reviewed yet.
#
# Inputs come via env (set in the calling workflow step):
#   EVENT_NAME   ? github.event_name
#   HEAD_REPO    ? github.event.pull_request.head.repo.full_name
#   BASE_REPO    ? github.repository
#   PR_AUTHOR    ? github.event.pull_request.user.login
#   FULL_SUITE   ? needs.changes.outputs.full_suite ('true' or 'false')
#
# Downstream pattern — `validate` is an `always()` aggregator, so a BARE
# boolean `if:` on a job that needs it is skipped whenever any of validate's
# conditional needs skipped, even though validate itself is green and this
# output reads 'true'. That silently disabled the real gates from 2026-09-08
# until it was caught. Opting out with `!cancelled()` drops the implicit
# `success()` over the whole needs list, so re-state EVERY need:
#
#   if: >-                                                    # heavy gates
#     !cancelled() &&
#     needs.validate.result == 'success' &&
#     needs.validate.outputs.real_gates_enabled == 'true'
#
#   if: >-                                                    # secret-touching jobs
#     !cancelled() &&
#     needs.validate.result == 'success' &&
#     needs.validate.outputs.trusted_event == 'true'
#
# PrYamlGateHardening.test.ts [PR-YAML-SKIP-POISON] enforces this.
# ??????????????????????????????????????????????????????????????
set -euo pipefail

is_trusted_event() {
  [[ "$EVENT_NAME" == "workflow_dispatch" ]] && return 0
  [[ "$EVENT_NAME" == "pull_request" && "$HEAD_REPO" == "$BASE_REPO" ]] && return 0
  return 1
}

is_dependency_bot_pr() {
  [[ "$EVENT_NAME" == "pull_request" ]] || return 1
  case "$PR_AUTHOR" in
    "dependabot[bot]" | "renovate[bot]") return 0 ;;
  esac
  return 1
}

full_suite_or_dispatch() {
  [[ "$EVENT_NAME" == "workflow_dispatch" ]] && return 0
  [[ "$FULL_SUITE" == "true" ]]
}

trusted="false"
if is_trusted_event; then
  trusted="true"
fi

real="false"
if [[ "$trusted" == "true" ]] && ! is_dependency_bot_pr && full_suite_or_dispatch; then
  real="true"
fi

echo "trusted_event=$trusted" >> "$GITHUB_OUTPUT"
echo "real_gates_enabled=$real" >> "$GITHUB_OUTPUT"

echo "[gate] event=$EVENT_NAME head=$HEAD_REPO base=$BASE_REPO author=$PR_AUTHOR full_suite=$FULL_SUITE ? trusted=$trusted real=$real"
