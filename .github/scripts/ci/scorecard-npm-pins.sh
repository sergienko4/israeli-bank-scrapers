#!/usr/bin/env bash
#
# Run the OpenSSF Scorecard engine the scheduled scan uses over this commit,
# and fail if any npm command in it is not pinned.
#
# WHY THIS EXISTS
# ---------------
# Code-scanning rule PinnedDependenciesID (type npmCommand) is raised by the
# scheduled Scorecard scan (scorecard.yml) — after a change has merged. This
# gate runs the same engine over the pull request's merge tree, so the alert
# is caught before the merge instead. Running the engine itself, not a
# re-implementation of its shell parser, means the gate sees exactly what the
# scan sees: nested substitutions, wrapper commands, `sh -c` bodies, heredocs
# and Dockerfiles alike.
#
# HOW
# ---
#   1. Take the engine from scorecard.yml: read the scorecard-action commit it
#      runs, fetch that commit's go.mod, and use the one Scorecard release it
#      requires. Nothing here names a version, so a Dependabot bump of the
#      action moves the gate with it. (The action runs its engine from an
#      image it names by tag, not digest; an upstream rebuild of that tag is
#      beyond this check.)
#   2. Look up the commit that release was cut from in the Go module proxy,
#      which never changes what it serves for a version.
#   3. Download this machine's release asset and verify, BEFORE unpacking it,
#      its SLSA provenance: signed by the SLSA generator on a GitHub-hosted
#      runner, building ossf/scorecard at that tag and commit. Then extract
#      only the `scorecard` binary into a scratch directory.
#   4. Canary: scan a scratch tree holding one unpinned npm command and require
#      the checker to reject it, so a gate that has gone blind cannot pass.
#   5. Scan the commit the way the scheduled scan reads it: `git archive`
#      (export-ignore honoured, no untracked or ignored files), minus the
#      symlinks and empty files Scorecard's archive mode skips.
#   6. check-scorecard-npm-pins.mjs decides; Scorecard exits 0 whatever it
#      finds.
#
# No token is used: `gh` verifies the provenance bundle it is handed, and
# `--local` mode only reads files.
#
# Usage:
#   scorecard-npm-pins.sh
#
# Exit codes:
#   0  every npm command in the commit is pinned
#   1  an npm command is unpinned, the scan was incomplete, or the gate could
#      not establish either (download, engine, provenance, canary)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "${REPO_ROOT}"

ACTION_GO_MOD_URL="https://raw.githubusercontent.com/ossf/scorecard-action"
ACTION_WORKFLOW=".github/workflows/scorecard.yml"
CHECKER=".github/scripts/ci/check-scorecard-npm-pins.mjs"
ENGINE_MODULE="github.com/ossf/scorecard/v5"
MODULE_PROXY_URL="https://proxy.golang.org/${ENGINE_MODULE}/@v"
SOURCE_REPO="ossf/scorecard"
RELEASES_URL="https://github.com/${SOURCE_REPO}/releases/download"
# Every Scorecard release asset is built and signed by this workflow.
SIGNER_WORKFLOW="slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml"
PROVENANCE_TYPE="https://slsa.dev/provenance/v0.2"
OIDC_ISSUER="https://token.actions.githubusercontent.com"

# Release asset platform for this machine. CI uses linux_amd64; the others
# serve local runs.
release_platform() {
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) echo "linux_amd64" ;;
    Linux-aarch64) echo "linux_arm64" ;;
    Darwin-x86_64) echo "darwin_amd64" ;;
    Darwin-arm64) echo "darwin_arm64" ;;
    *)
      echo "no Scorecard release asset for $(uname -s)-$(uname -m)" >&2
      return 1
      ;;
  esac
}

# The provenance check needs a gh whose `attestation verify` can pin the
# source commit.
require_verifier() {
  if ! command -v gh >/dev/null 2>&1 ||
    ! gh attestation verify --help >"${WORK}/gh-help.txt" 2>&1 ||
    ! grep -qF -- '--source-digest' "${WORK}/gh-help.txt"; then
    echo "the gate needs the GitHub CLI with 'gh attestation verify --source-digest'" \
      "to verify the Scorecard release; install or upgrade gh" >&2
    return 1
  fi
}

# Each attempt is bounded, so a stalled transfer times out and is retried
# (curl counts a timeout as transient) instead of holding the step until
# its own cap kills it.
download() {
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --retry 3 --max-time 60 --output "$2" "$1"
}

# The version a go.mod requires of the engine module, read per directive, in
# its one-line or `( … )` block form, with `//` comments dropped and `\r`
# read as a space, as Go reads it. Prints nothing unless exactly one
# `require` and no other directive names it, and nothing either when a line
# holds a quote or a parenthesis outside a bare `verb (` or `)` line: Go
# reads `"…"` as an escaped path and `replace(` as a block, so those could
# name the module without this reader seeing it.
engine_requirement() {
  awk -v module="${ENGINE_MODULE}" '
    { gsub(/\r/, " "); sub(/[[:space:]]*\/\/.*/, "") }
    NF == 1 && $1 == ")" { block = ""; next }
    NF == 2 && $2 == "(" && $1 ~ /^[a-z]+$/ { block = $1; next }
    /["`()]/ { unread++; next }
    {
      directive = (block == "") ? $1 : block
      at = (block == "") ? 2 : 1
      if ($at != module) next
      if (directive == "require") { n++; v = $(at + 1) } else { other++ }
    }
    END { if (n == 1 && other == 0 && unread == 0) print v }
  ' "$1"
}

# Step 1: the scheduled scan's engine. Every mention of the action outside a
# comment line must be a plain `uses:` line (so a quoted or flow-style second
# reference cannot hide), and together they must name one full commit SHA; a
# commented-out pin does not count. Its go.mod must name the engine module in
# exactly one `require` — a `replace` or `exclude` naming it too would build
# something other than that release — at a release version, not a
# pseudo-version, and with no quote or glued `(` outside a `//` comment,
# so neither can hide such a directive.
read_action_engine() {
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
  SCORECARD_VERSION="$(engine_requirement "${WORK}/action-go.mod")"
  if ! [[ "${SCORECARD_VERSION}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "scorecard-action ${sha} (${ACTION_WORKFLOW}) does not require exactly one" \
      "${ENGINE_MODULE} release in plain go.mod syntax (no quotes, parentheses" \
      "only on block lines); its go.mod says: $(grep -F "${ENGINE_MODULE}" \
      "${WORK}/action-go.mod" | tr -s '[:space:]' ' ')" >&2
    return 1
  fi
}

# Step 2: the commit the release was cut from. The Go module proxy records a
# version's origin once and never changes it, so a moved tag cannot move it.
read_source_digest() {
  download "${MODULE_PROXY_URL}/${SCORECARD_VERSION}.info" "${WORK}/engine.info"
  SOURCE_DIGEST="$(node -e '
    const [file, version, url] = process.argv.slice(1);
    let info = {};
    try { info = JSON.parse(require("node:fs").readFileSync(file, "utf8")); } catch {}
    const o = info.Origin ?? {};
    const isRelease = info.Version === version && o.VCS === "git" && o.URL === url;
    const isTagged = o.Ref === `refs/tags/${version}` && /^[0-9a-f]{40}$/.test(o.Hash);
    if (isRelease && isTagged) process.stdout.write(o.Hash);
  ' "${WORK}/engine.info" "${SCORECARD_VERSION}" "https://github.com/${SOURCE_REPO}")"
  if [ -z "${SOURCE_DIGEST}" ]; then
    echo "the Go module proxy names no tagged ${SOURCE_REPO} commit for ${SCORECARD_VERSION}" >&2
    return 1
  fi
}

scan() {
  "${SCORECARD}" --local="$1" --checks=Pinned-Dependencies --show-details \
    --format=json --output="$2"
}

WORK="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/scorecard-npm-pins.XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT

require_verifier
read_action_engine
read_source_digest

# Step 3: the binary, verified before it is unpacked.
PLATFORM="$(release_platform)"
ASSET_NAME="scorecard_${SCORECARD_VERSION#v}_${PLATFORM}.tar.gz"
ARCHIVE="${WORK}/${ASSET_NAME}"
BUNDLE="${WORK}/provenance.intoto.jsonl"
download "${RELEASES_URL}/${SCORECARD_VERSION}/${ASSET_NAME}" "${ARCHIVE}"
download "${RELEASES_URL}/${SCORECARD_VERSION}/multiple.intoto.jsonl" "${BUNDLE}"
if ! gh attestation verify "${ARCHIVE}" --bundle "${BUNDLE}" --repo "${SOURCE_REPO}" \
  --predicate-type "${PROVENANCE_TYPE}" --source-ref "refs/tags/${SCORECARD_VERSION}" \
  --source-digest "${SOURCE_DIGEST}" --signer-workflow "${SIGNER_WORKFLOW}" \
  --cert-oidc-issuer "${OIDC_ISSUER}" --deny-self-hosted-runners \
  >"${WORK}/provenance.log" 2>&1; then
  echo "Scorecard ${SCORECARD_VERSION} ${PLATFORM} asset failed provenance verification:" >&2
  cat "${WORK}/provenance.log" >&2
  exit 1
fi
mkdir "${WORK}/bin"
tar -xzf "${ARCHIVE}" -C "${WORK}/bin" scorecard
SCORECARD="${WORK}/bin/scorecard"

# Step 4: built at run time, not committed — a committed copy would be part of
# the scanned tree. `printf` keeps this line itself from being an npm command.
CANARY="${WORK}/canary"
CANARY_RESULT="${WORK}/canary.json"
mkdir "${CANARY}"
printf '#!/bin/sh\n%s install left-pad\n' npm >"${CANARY}/canary.sh"
scan "${CANARY}" "${CANARY_RESULT}"
if node "${CHECKER}" "${CANARY_RESULT}" "${SCORECARD_VERSION}" >"${WORK}/canary.log" 2>&1; then
  echo "canary: the checker accepted an unpinned npm command, so the gate cannot fail" >&2
  cat "${WORK}/canary.log" >&2
  exit 1
fi
if ! grep -qF 'npmCommand not pinned by hash: canary.sh:2' "${WORK}/canary.log"; then
  echo "canary: the scan did not report the unpinned npm command it was given" >&2
  cat "${WORK}/canary.log" >&2
  exit 1
fi

# Step 5: the tree the scheduled scan reads.
TREE="${WORK}/tree"
RESULT="${WORK}/result.json"
mkdir "${TREE}"
git archive --format=tar HEAD | tar -xf - -C "${TREE}"
find "${TREE}" \( -type l -o -type f -empty \) -delete
scan "${TREE}" "${RESULT}"

# Step 6: the verdict.
node "${CHECKER}" "${RESULT}" "${SCORECARD_VERSION}"
