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
#                           2. PR author ? dependabot[bot] (stable across reruns; uses
#                              pull_request.user.login, NOT github.actor)
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
# Inputs come via env (set in the calling workflow step):
#   EVENT_NAME   ? github.event_name
#   HEAD_REPO    ? github.event.pull_request.head.repo.full_name
#   BASE_REPO    ? github.repository
#   PR_AUTHOR    ? github.event.pull_request.user.login
#   FULL_SUITE   ? needs.changes.outputs.full_suite ('true' or 'false')
#
# Downstream pattern:
#   if: needs.validate.outputs.real_gates_enabled == 'true'   # heavy gates
#   if: needs.validate.outputs.trusted_event == 'true'        # secret-touching jobs
# ??????????????????????????????????????????????????????????????
set -euo pipefail

is_trusted_event() {
  [[ "$EVENT_NAME" == "workflow_dispatch" ]] && return 0
  [[ "$EVENT_NAME" == "pull_request" && "$HEAD_REPO" == "$BASE_REPO" ]] && return 0
  return 1
}

is_dependabot_pr() {
  [[ "$EVENT_NAME" == "pull_request" && "$PR_AUTHOR" == "dependabot[bot]" ]]
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
if [[ "$trusted" == "true" ]] && ! is_dependabot_pr && full_suite_or_dispatch; then
  real="true"
fi

echo "trusted_event=$trusted" >> "$GITHUB_OUTPUT"
echo "real_gates_enabled=$real" >> "$GITHUB_OUTPUT"

echo "[gate] event=$EVENT_NAME head=$HEAD_REPO base=$BASE_REPO author=$PR_AUTHOR full_suite=$FULL_SUITE ? trusted=$trusted real=$real"
