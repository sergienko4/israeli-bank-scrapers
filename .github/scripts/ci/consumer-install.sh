#!/usr/bin/env bash
#
# Install the published package the way a consumer does, then run it.
#
# WHY THIS EXISTS
# ---------------
# CI tests the repository; it never tests the package. Every job runs from the
# working tree, where devDependencies are installed and `CI=true` is set by the
# runner. Issue #552 is invisible under both of those conditions:
#
#   * `pino-pretty` is a devDependency that the shipped code resolves at
#     runtime. In CI it is always on disk, so it always resolves.
#   * The transport that reaches for it is selected only when `CI` is unset
#     AND `NODE_ENV` is not `production` — which is the ordinary state of a
#     consumer's application, and a state no CI job can ever be in.
#
# So the failure is unreachable in CI by construction, not by accident. This
# gate is the one place that leaves the working tree behind: it packs the real
# tarball, installs it into an empty project with `--omit=dev`, and runs it
# with `CI` and `NODE_ENV` explicitly unset.
#
# WHAT IT ASSERTS
# ---------------
#   1. The scrape SETTLES. A silent `exit 0` is the worst outcome a library can
#      produce - the consumer cannot even tell that anything went wrong - so it
#      is treated as a failure, not as "no output".
#   2. The failure is not the logger's. Dying because a devDependency cannot be
#      resolved happens before any network call, which makes it look like the
#      bank is unreachable.
#
# NO BANK IS CONTACTED. Installing with `--ignore-scripts` leaves the native
# better-sqlite3 binding unbuilt, so Camoufox refuses to start well before any
# navigation. That is also what makes the gate hermetic and deterministic:
# the run cannot depend on a bank being up. The published defect reproduces
# with and without that flag, so nothing is lost by using it.
#
# Usage:
#   consumer-install.sh
#
# Exit codes:
#   0  the package settles with an actionable outcome in every environment
#   1  it abandoned the scrape, or died resolving its own logger

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${REPO_ROOT}"

# Proof that the scrape produced an outcome at all. Its absence is the
# silent-abandonment failure, which prints nothing by definition.
SETTLED_MARKER="SETTLED"

# The failure mode that must never reach a consumer: the shipped code
# resolving a devDependency at runtime.
TRANSPORT_FAILURE="unable to determine transport target"

# The one outcome a hermetic run may reach. Both strings are this repo's own
# (`CamoufoxIdentityFetchStrategy.ts`, `CamoufoxLauncher.ts`) and are pinned by
# unit tests, so they cannot drift underneath the gate the way a third-party
# error message could.
#
# Asserting the expected outcome POSITIVELY is the point. Accepting anything
# that merely settled would let an unrelated regression inside the package -
# a TypeError on import, a reworked error message - report success, because
# it too would print a settled line.
EXPECTED_OUTCOME="camoufox launch failed"

# A scrape reports failure by returning a result. `SETTLED throw` means an
# exception escaped to the consumer, which is a defect in its own right.
EXPECTED_KIND="SETTLED result"

# No bank may be contacted, so a scrape that reports success means the harness
# has stopped being hermetic and the gate is no longer proving anything.
EXPECTED_VERDICT='"success":false'

WORK_DIR=""

# Remove the throwaway project even when an assertion aborts the script, so a
# failed run leaves the working tree exactly as it found it. The tarball lives
# inside it, so there is nothing to clean up in the repo itself.
cleanup() {
  if [ -n "${WORK_DIR}" ] && [ -d "${WORK_DIR}" ]; then
    rm -rf "${WORK_DIR}"
  fi
}
trap cleanup EXIT

PKG_NAME="$(node -p "require('${REPO_ROOT}/package.json').name")"

WORK_DIR="$(mktemp -d)"

# Packing into the scratch directory rather than the repo root keeps the run
# from leaving a tarball behind, and leaves exactly one `.tgz` to glob for -
# so the version never has to be spelled out, and a stale tarball from an
# earlier build cannot be picked up by mistake.
echo "==> Packing ${PKG_NAME}"
npm pack --pack-destination "${WORK_DIR}" >/dev/null
set -- "${WORK_DIR}"/*.tgz
TARBALL="$1"

echo "==> Installing into a clean project (--omit=dev)"
mkdir -p "${WORK_DIR}/app"
cd "${WORK_DIR}/app"
npm init -y >/dev/null 2>&1
npm i "${TARBALL}" --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null 2>&1
cp "${REPO_ROOT}/.github/scripts/ci/consumer-smoke.cjs" ./smoke.cjs

# `pino-pretty` must be absent, or the gate proves nothing: the transport
# would resolve and the defect would stay hidden exactly as it does in CI.
if [ -d "node_modules/pino-pretty" ]; then
  echo "FAIL: pino-pretty is present in a production install - gate is vacuous"
  exit 1
fi

FAILED=0

# Diagnostics go to stdout, not stderr, so each verdict stays next to the
# `==>` header it belongs to. The two streams are buffered independently once
# CI captures them, which detaches a failure from the environment that caused
# it. The exit code, not the stream, is the machine-readable verdict.
#
# Assert the settled outcome is the expected controlled environment failure
# rather than merely *an* outcome.
#
# $1 - captured smoke output
#
# Returns 0 when every expectation is present, 1 otherwise (marking the run
# failed, so the caller can bail out without repeating the bookkeeping).
assert_expected_outcome() {
  local output="$1"
  local expectation
  for expectation in "${EXPECTED_KIND}" "${EXPECTED_VERDICT}" "${EXPECTED_OUTCOME}"; do
    case "${output}" in
      *"${expectation}"*)
        ;;
      *)
        echo "    FAIL: settled, but not with the outcome this gate expects."
        echo "          missing: ${expectation}"
        echo "          ${output}"
        FAILED=1
        return 1
        ;;
    esac
  done
  return 0
}

# Run the consumer program under one environment and assert on the outcome.
#
# $1 - human-readable label for the log
# $2 - `env` arguments describing the consumer's environment
run_environment() {
  local label="$1"
  shift
  echo "==> Consumer environment: ${label}"

  # The exit status is part of the verdict, so it is captured rather than
  # discarded: the smoke program exits non-zero when an exception escapes to
  # the consumer. `|| status=$?` keeps that from aborting the run under
  # `set -e` while still recording what happened.
  local output
  local status=0
  output="$(env "$@" node ./smoke.cjs 2>&1)" || status=$?

  case "${output}" in
    *"${SETTLED_MARKER}"*)
      ;;
    *)
      echo "    FAIL: the scrape never settled - no result, no error."
      echo "          A consumer sees the process exit silently."
      FAILED=1
      return 0
      ;;
  esac

  case "${output}" in
    *"${TRANSPORT_FAILURE}"*)
      echo "    FAIL: died resolving its own logger transport."
      echo "          ${output}"
      FAILED=1
      return 0
      ;;
  esac

  if [ "${status}" -ne 0 ]; then
    echo "    FAIL: an exception escaped to the consumer (exit ${status})."
    echo "          A scrape must report failure by returning a result."
    echo "          ${output}"
    FAILED=1
    return 0
  fi

  assert_expected_outcome "${output}" || return 0

  echo "    ok - settled with the expected environment failure"
  echo "    ${output}"
  return 0
}

# The default state of a consumer's application: neither variable is set.
# This is the environment no CI job can reproduce.
run_environment "default (CI and NODE_ENV unset)" -u CI -u NODE_ENV

# A consumer who does set NODE_ENV. Different transport branch, same contract.
run_environment "NODE_ENV=production" -u CI NODE_ENV=production

if [ "${FAILED}" -ne 0 ]; then
  echo "" >&2
  echo "consumer-install: the published package does not work for consumers." >&2
  exit 1
fi

echo "consumer-install: package behaves for consumers in every environment ✓"
