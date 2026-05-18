#!/usr/bin/env bash
# run-banks.sh — run E2E Real A bank tests inside the CI-mirror image.
#
# Usage:
#   bash docker/run-banks.sh                     # all 6 in parallel
#   bash docker/run-banks.sh Beinleumi           # single bank
#   bash docker/run-banks.sh Beinleumi Hapoalim  # specific subset
#
# Each bank runs in its OWN container, sidestepping Camoufox upstream
# bug #386 ("instances interfere with each other") that constrains
# host-Camoufox to sequential mode (see scripts/run-real-suite.ts +
# telegram-m5-and-final-cleanup/origin-plan-work/post-m4-cleanup-and-m5-unblock/status.txt
# §"Camoufox parallel-launch limitation").
#
# Pre-requisites:
#   - Image built: docker build -f docker/Dockerfile.ci-mirror -t isbs-ci:latest .
#   - .env populated at repo root with all bank credentials +
#     TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${ISBS_CI_IMAGE:-isbs-ci:latest}"
LOG_DIR="${REPO_ROOT}/docker/logs"

# On Windows + git-bash, docker's --env-file and -v source paths
# must be in native Windows form (`C:/...`). `cygpath -w` converts
# the POSIX form returned by `pwd` to the Windows form docker
# expects. On Linux / macOS hosts cygpath is absent — we fall
# through to the unchanged POSIX path which docker accepts there.
if command -v cygpath >/dev/null 2>&1; then
    REPO_ROOT_DOCKER=$(cygpath -w "$REPO_ROOT")
else
    REPO_ROOT_DOCKER="$REPO_ROOT"
fi
ENV_FILE_DOCKER="${REPO_ROOT_DOCKER}/.env"
# Posix existence check uses the original POSIX path.
if [ ! -f "${REPO_ROOT}/.env" ]; then
    echo "ERROR: .env not found at ${REPO_ROOT}/.env" >&2
    exit 1
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "ERROR: image '$IMAGE' not built. Run:" >&2
    echo "  docker build -f docker/Dockerfile.ci-mirror -t $IMAGE $REPO_ROOT" >&2
    exit 1
fi

mkdir -p "$LOG_DIR"

# Default-on banks for the local pre-commit gate. NON-OTP only so
# the hook doesn't prompt for a Telegram reply on every commit.
# OTP-gated banks (Hapoalim / OneZero / Beinleumi) are listed but
# commented; uncomment a line to opt back in, or override per-commit
# with `LOCAL_BANKS="Hapoalim Beinleumi" git commit`. Pepper is in
# CI's E2E Real B (currently skipped) so it stays out of the local
# default. Order matches scripts/run-real-suite.ts.
ALL_BANKS=(
    Discount
    Max
    Visacal
    Hapoalim    # OTP-gated — requires Telegram reply
    # OneZero     # OTP-gated — requires Telegram reply
    # Beinleumi   # OTP-gated — requires Telegram reply
    Amex
    Isracard
)
if [ "$#" -gt 0 ]; then
    BANKS=("$@")
else
    BANKS=("${ALL_BANKS[@]}")
fi

# Rule #16 — Amex + Isracard share the Isracard auth-domain login
# infra and MUST NEVER overlap. The group map collapses both into
# one sequential worker; other banks each get a singleton group.
# Across groups, parallelism is safe because every container has
# its own Camoufox process space (the upstream bug #386 that
# constrains the host scripts/run-real-suite.ts to sequential mode
# does NOT apply once each instance is in a separate container).
declare -A BANK_TO_GROUP
BANK_TO_GROUP[Amex]=isracard-pair
BANK_TO_GROUP[Isracard]=isracard-pair

# Build groups[name] = "Bank1 Bank2 …" preserving the input order so
# Rule #16's Amex-first / Isracard-second sequencing is honored when
# both are requested together.
# NB: `GROUPS` is a reserved variable in bash 5.x (the running user's
# supplementary group list) and assignments are rejected with
# "variable may not be assigned value". Use `GROUPS_MAP` instead.
declare -A GROUPS_MAP=()
GROUP_ORDER=()
for bank in "${BANKS[@]}"; do
    group="${BANK_TO_GROUP[$bank]:-$bank}"
    if [ -z "${GROUPS_MAP[$group]+x}" ]; then
        GROUP_ORDER+=("$group")
        GROUPS_MAP[$group]="$bank"
    else
        GROUPS_MAP[$group]+=" $bank"
    fi
done

echo "Worker groups (parallel across, sequential within):"
for g in "${GROUP_ORDER[@]}"; do
    echo "  [$g] ${GROUPS_MAP[$g]}"
done

run_one_bank() {
    local bank="$1"
    local log="${LOG_DIR}/${bank}.log"
    # MSYS_NO_PATHCONV=1 disables git-bash's automatic path translation
    # so `-v <src>:/work -w /work` keep their POSIX-style values when
    # they reach the docker CLI (without it git-bash rewrites `/work`
    # to `C:/Program Files/Git/work`). `npm run test:e2e:real:single`
    # doesn't exist — we invoke jest directly with the bank-specific
    # testPathPatterns + testNamePattern to match the CI workflow's
    # E2E Real A invocation byte-for-byte.
    # Explicit --dns flags so each container has its own resolver
    # configuration rather than racing on Docker Desktop's shared
    # vEthernet adapter. The 1st failed Phase 5 (run 2026-05-12)
    # saw all 8 parallel banks fail with `Server Not Found` on the
    # bank URL — Docker Desktop's DNS was saturated. Google + Cloudflare
    # public resolvers are intentionally redundant.
    # Host-side artifact dir — pipeline.log + screenshots + network
    # captures from the in-container run land at `C:/tmp/runs/docker/`
    # so the host can inspect them after the container exits.
    local RUNS_HOST_POSIX="/c/tmp/runs/docker"
    mkdir -p "$RUNS_HOST_POSIX"
    local RUNS_HOST_DOCKER
    if command -v cygpath >/dev/null 2>&1; then
        RUNS_HOST_DOCKER=$(cygpath -w "$RUNS_HOST_POSIX")
    else
        RUNS_HOST_DOCKER="$RUNS_HOST_POSIX"
    fi
    # NOTE: We deliberately do NOT pass `--env-file` here. Docker's
    # env-file parser is bug-compatible with shell `source` — it does
    # NOT strip `"..."` wrapping quotes. dotenv DOES strip them. So
    # values like `MAX_PASSWORD="8d@$wm2#*^9X!"` (wrapped to escape
    # the `#` comment char in dotenv) would leak the literal quotes
    # into the container env, which then get typed into bank login
    # fields with `maxlength` limits, truncating the trailing quote
    # and submitting an off-by-one password. Instead we mount the
    # repo (which already includes `.env`) and rely on each test's
    # `dotenv.config()` to load + correctly strip quotes from `.env`.
    MSYS_NO_PATHCONV=1 docker run --rm \
    --name "isbs-ci-${bank,,}" \
    --dns=8.8.8.8 --dns=1.1.1.1 \
    -v "${REPO_ROOT_DOCKER}:/work" \
    -v "${RUNS_HOST_DOCKER}:/tmp/runs" \
    -w /work \
    -e CI=true \
    -e LOG_LEVEL=trace \
    -e RUNS_ROOT=/tmp/runs \
    -e CAMOUFOX_HUMANIZE="${CAMOUFOX_HUMANIZE:-true}" \
    -e CAMOUFOX_DISABLE_COOP="${CAMOUFOX_DISABLE_COOP:-true}" \
    -e CAMOUFOX_VIRTUAL_HEADLESS="${CAMOUFOX_VIRTUAL_HEADLESS:-true}" \
    "$IMAGE" \
    node --experimental-vm-modules node_modules/jest/bin/jest.js \
    --ci \
    --testPathPatterns="E2eReal/${bank}\\.e2e-real" \
    --testNamePattern='scrapes transactions successfully' \
    --testPathIgnorePatterns='/node_modules/' \
    --verbose --forceExit \
    > "$log" 2>&1
    echo "$bank: exit=$?"
}

run_group_sequentially() {
    # Runs the banks in a worker group one at a time. Each bank's
    # status is preserved via its individual log file; we exit
    # the subshell non-zero if any bank in the group failed so the
    # parent wait loop accurately accounts for group failures.
    local group_failed=0
    for bank in $1; do
        if ! run_one_bank "$bank"; then
            group_failed=1
        fi
    done
    return "$group_failed"
}

START_TIME=$(date +%s)
PIDS=()
GROUP_NAMES=()
for group in "${GROUP_ORDER[@]}"; do
    (run_group_sequentially "${GROUPS_MAP[$group]}") &
    PIDS+=($!)
    GROUP_NAMES+=("$group")
done

# Wait for every group to finish and collect exit codes per group.
FAILED_GROUPS=()
for i in "${!PIDS[@]}"; do
    if ! wait "${PIDS[$i]}"; then
        FAILED_GROUPS+=("${GROUP_NAMES[$i]}")
    fi
done
WALL=$(( $(date +%s) - START_TIME ))

echo
echo "════════════════════════════════════════════════════════════"
echo "DOCKER E2E RESULTS — wall=${WALL}s"
echo "════════════════════════════════════════════════════════════"
for bank in "${BANKS[@]}"; do
    log="${LOG_DIR}/${bank}.log"
    if grep -q '"action":"OK","index":"[0-9]\+/[0-9]\+"' "$log" 2>/dev/null \
    && ! grep -q '"action":"FAIL"' "$log" 2>/dev/null; then
        status=PASS
    else
        status=FAIL
    fi
    printf "  %-10s %s   (%s)\n" "$bank" "$status" "$log"
done

if [ "${#FAILED_GROUPS[@]}" -eq 0 ]; then
    echo "ALL ${#BANKS[@]}/${#BANKS[@]} PASSED — EXIT 0"
    exit 0
fi
echo "FAILED GROUPS: ${FAILED_GROUPS[*]} — EXIT 1"
exit 1
