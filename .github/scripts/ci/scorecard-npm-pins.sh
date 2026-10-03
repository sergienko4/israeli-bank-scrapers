#!/usr/bin/env bash
#
# Run the OpenSSF Scorecard engine the scheduled scan uses over this commit,
# and fail if any npm command in it is not pinned.
#
# WHY THIS EXISTS
# ---------------
# Code-scanning rule PinnedDependenciesID (type npmCommand) is raised by the
# scheduled Scorecard scan (scorecard.yml) — after a change has merged. This
# gate runs the same engine, pinned by version and checksum, over the pull
# request's merge tree, so the alert is caught before the merge instead.
# Running the engine itself, not a re-implementation of its shell parser,
# means the gate sees exactly what the scan sees: nested substitutions,
# wrapper commands, `sh -c` bodies, heredocs and Dockerfiles alike.
#
# HOW
# ---
#   1. Check the pin against scorecard.yml: read the scorecard-action commit it
#      runs, fetch that commit's go.mod, and require the same Scorecard module
#      version. A Dependabot bump of the action fails here until this pin moves
#      with it. (The action runs its engine from an image it names by tag, not
#      digest; an upstream rebuild of that tag is beyond this check.)
#   2. Download the pinned release asset, verify its SHA-256 BEFORE unpacking
#      it, and extract only the `scorecard` binary into a scratch directory.
#   3. Canary: scan a scratch tree holding one unpinned npm command and require
#      the checker to reject it, so a gate that has gone blind cannot pass.
#   4. Scan the commit the way the scheduled scan reads it: `git archive`
#      (export-ignore honoured, no untracked or ignored files), minus the
#      symlinks and empty files Scorecard's archive mode skips.
#   5. check-scorecard-npm-pins.mjs decides; Scorecard exits 0 whatever it
#      finds.
#
# No token is used: `--local` mode only reads files.
#
# Usage:
#   scorecard-npm-pins.sh
#
# Exit codes:
#   0  every npm command in the commit is pinned
#   1  an npm command is unpinned, the scan was incomplete, or the gate could
#      not establish either (download, checksum, engine pin, canary)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${REPO_ROOT}"

SCORECARD_VERSION="5.5.0"
RELEASE_URL="https://github.com/ossf/scorecard/releases/download/v${SCORECARD_VERSION}"
ACTION_GO_MOD_URL="https://raw.githubusercontent.com/ossf/scorecard-action"
ACTION_WORKFLOW=".github/workflows/scorecard.yml"
CHECKER=".github/scripts/ci/check-scorecard-npm-pins.mjs"

# Release asset for this machine and its SHA-256, from the release's
# scorecard_checksums.txt. CI uses linux_amd64; the others serve local runs.
release_asset() {
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) echo "linux_amd64 83b90a05c1540ef1390db1cd5711e5fd04be9c1d8537fb84d39d02092d6a8dff" ;;
    Linux-aarch64) echo "linux_arm64 3ce59d20c1d53e540c4a14e0da1e0d96b3b294e8ddc96a3c5a7b8a637b32991e" ;;
    Darwin-x86_64) echo "darwin_amd64 979487ca20e726f6a4d2bd63a0a4c544184f589724b3d12d2ba8d0ea80889063" ;;
    Darwin-arm64) echo "darwin_arm64 bac6371a4f810d6bdd0b65d63c3311906bdfe3ba0d76a5ea743ce24ced170fcf" ;;
    *)
      echo "no pinned Scorecard asset for $(uname -s)-$(uname -m)" >&2
      return 1
      ;;
  esac
}

download() {
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --retry 3 --output "$2" "$1"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

# Step 1: the scheduled scan's engine must be the one pinned here. Every
# mention of the action outside a comment line must be a plain `uses:` line
# (so a quoted or flow-style second reference cannot hide), and together they
# must name one full commit SHA; a commented-out pin does not count.
check_action_engine() {
  local mentions uses refs sha
  mentions="$(awk '!/^[[:space:]]*#/ && /ossf\/scorecard-action@/ { n++ } END { print n + 0 }' \
    "${ACTION_WORKFLOW}")"
  uses="$(sed -nE 's/^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]*ossf\/scorecard-action@([^[:space:]]+).*/\2/p' \
    "${ACTION_WORKFLOW}")"
  refs="$(printf '%s' "${uses}" | sort -u)"
  if [ -z "${refs}" ] || [ "$(printf '%s\n' "${uses}" | wc -l)" -ne "${mentions}" ] ||
    [ "$(printf '%s\n' "${refs}" | wc -l)" -ne 1 ] ||
    ! printf '%s\n' "${refs}" | grep -Eqx '[0-9a-f]{40}'; then
    echo "expected one SHA-pinned ossf/scorecard-action in ${ACTION_WORKFLOW}, each a plain" \
      "uses: line; found ${mentions} mention(s), refs: $(printf '%s' "${refs:-none}" | tr '\n' ' ')" >&2
    return 1
  fi
  sha="${refs}"
  download "${ACTION_GO_MOD_URL}/${sha}/go.mod" "${WORK}/action-go.mod"
  if ! awk -v want="v${SCORECARD_VERSION}" \
    '$1 == "github.com/ossf/scorecard/v5" && $2 == want { found = 1 } END { exit !found }' \
    "${WORK}/action-go.mod"; then
    echo "scorecard-action ${sha} (${ACTION_WORKFLOW}) does not embed Scorecard v${SCORECARD_VERSION};" \
      "move SCORECARD_VERSION and the checksums in $0 to the engine it embeds" >&2
    return 1
  fi
}

scan() {
  "${SCORECARD}" --local="$1" --checks=Pinned-Dependencies --show-details \
    --format=json --output="$2"
}

WORK="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/scorecard-npm-pins.XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT

check_action_engine

# Step 2: the binary, verified before it is unpacked.
ASSET="$(release_asset)"
read -r PLATFORM EXPECTED_SHA <<<"${ASSET}"
ARCHIVE="${WORK}/scorecard.tar.gz"
download "${RELEASE_URL}/scorecard_${SCORECARD_VERSION}_${PLATFORM}.tar.gz" "${ARCHIVE}"
ACTUAL_SHA="$(sha256_of "${ARCHIVE}")"
if [ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]; then
  echo "Scorecard ${PLATFORM} asset checksum ${ACTUAL_SHA} does not match the pinned ${EXPECTED_SHA}" >&2
  exit 1
fi
mkdir "${WORK}/bin"
tar -xzf "${ARCHIVE}" -C "${WORK}/bin" scorecard
SCORECARD="${WORK}/bin/scorecard"

# Step 3: built at run time, not committed — a committed copy would be part of
# the scanned tree. `printf` keeps this line itself from being an npm command.
CANARY="${WORK}/canary"
CANARY_RESULT="${WORK}/canary.json"
mkdir "${CANARY}"
printf '#!/bin/sh\n%s install left-pad\n' npm >"${CANARY}/canary.sh"
scan "${CANARY}" "${CANARY_RESULT}"
if node "${CHECKER}" "${CANARY_RESULT}" "v${SCORECARD_VERSION}" >"${WORK}/canary.log" 2>&1; then
  echo "canary: the checker accepted an unpinned npm command, so the gate cannot fail" >&2
  cat "${WORK}/canary.log" >&2
  exit 1
fi
if ! grep -qF 'npmCommand not pinned by hash: canary.sh:2' "${WORK}/canary.log"; then
  echo "canary: the scan did not report the unpinned npm command it was given" >&2
  cat "${WORK}/canary.log" >&2
  exit 1
fi

# Step 4: the tree the scheduled scan reads.
TREE="${WORK}/tree"
RESULT="${WORK}/result.json"
mkdir "${TREE}"
git archive --format=tar HEAD | tar -xf - -C "${TREE}"
find "${TREE}" \( -type l -o -type f -empty \) -delete
scan "${TREE}" "${RESULT}"

# Step 5: the verdict.
node "${CHECKER}" "${RESULT}" "v${SCORECARD_VERSION}"
