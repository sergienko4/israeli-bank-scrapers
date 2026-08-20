#!/usr/bin/env bash
#
# Assert that a release actually reached the public npm registry.
#
# WHY THIS EXISTS
# ---------------
# `npm publish` exiting 0 means the registry accepted the tarball, not that
# consumers can install it. Two failures survive a green publish step:
#
#   1. The version lands but `dist-tags.latest` still points at the previous
#      release, so `npm install <pkg>` keeps serving the old code. Every
#      consumer who does not pin an exact version silently stays behind, and
#      the release looks successful from inside CI.
#   2. The tarball publishes without a provenance attestation. `publishConfig`
#      asks for one, but a misconfigured OIDC token degrades to an unsigned
#      publish rather than failing, and the missing signature is only visible
#      on the npm web page nobody checks after a release.
#
# Both are invisible from the publish job itself, which is why this runs
# afterwards and reads back from the registry as a consumer would.
#
# The registry is read-through-cache and eventually consistent, so a fresh
# publish can 404 for a few seconds. That is expected, not a failure — hence
# the bounded poll rather than a single request.
#
# Usage:
#   verify-npm-publish.sh <package-name> <version>
#
# Exit codes:
#   0  the version resolves, is tagged `latest`, and carries provenance
#   1  the registry disagrees after every attempt, or an argument is missing

set -euo pipefail

PKG_NAME="${1:?package name required}"
PKG_VERSION="${2:?version required}"

# The registry addresses a scoped package with the slash percent-encoded;
# an unencoded `/` is read as a path separator and returns the scope, not
# the package.
ENCODED_NAME="${PKG_NAME//\//%2f}"
REGISTRY_URL="https://registry.npmjs.org/${ENCODED_NAME}"

# Overridable so the smoke test can exercise the give-up path in milliseconds
# instead of the two minutes a real release is willing to wait.
readonly MAX_ATTEMPTS="${VERIFY_MAX_ATTEMPTS:-12}"
readonly SLEEP_SECONDS="${VERIFY_SLEEP_SECONDS:-10}"

# Reads the registry's package document on stdin and prints two fields:
# the version's own `version` string (empty when absent) and `dist-tags.latest`.
# Node rather than jq: the publish job already guarantees a Node toolchain,
# which keeps this script runnable — and therefore testable — outside CI.
readonly READ_FIELDS='
  const doc = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const wanted = process.argv[1];
  const published = doc.versions?.[wanted]?.version ?? "";
  const latest = doc["dist-tags"]?.latest ?? "";
  process.stdout.write(published + " " + latest);
'

echo "Verifying ${PKG_NAME}@${PKG_VERSION} on registry.npmjs.org"

attempt=1
while [ "${attempt}" -le "${MAX_ATTEMPTS}" ]; do
  # A 404 while the CDN catches up is normal; treat any non-200 as "not yet".
  if body=$(curl --fail --silent --show-error --location "${REGISTRY_URL}" 2>/dev/null); then
    fields=$(printf '%s' "${body}" | node -e "${READ_FIELDS}" "${PKG_VERSION}")
    published="${fields%% *}"
    latest="${fields##* }"

    if [ "${published}" = "${PKG_VERSION}" ] && [ "${latest}" = "${PKG_VERSION}" ]; then
      echo "  ✓ version resolves and dist-tags.latest == ${PKG_VERSION}"
      break
    fi

    echo "  attempt ${attempt}/${MAX_ATTEMPTS}: version='${published:-missing}' latest='${latest:-unknown}'"
  else
    echo "  attempt ${attempt}/${MAX_ATTEMPTS}: package document not readable yet"
  fi

  if [ "${attempt}" -eq "${MAX_ATTEMPTS}" ]; then
    echo "ERROR: ${PKG_NAME}@${PKG_VERSION} is not installable after $((MAX_ATTEMPTS * SLEEP_SECONDS))s." >&2
    echo "       The publish step reported success, so the tarball was accepted, but the" >&2
    echo "       registry does not serve this version as 'latest'. Consumers running" >&2
    echo "       'npm install ${PKG_NAME}' are still getting '${latest:-the previous release}'." >&2
    exit 1
  fi

  sleep "${SLEEP_SECONDS}"
  attempt=$((attempt + 1))
done

# Provenance is the signal that lets a consumer verify this tarball was built
# by this workflow from this commit. package.json asks for it via
# `publishConfig.provenance`, so its absence means the OIDC exchange degraded
# silently and the supply-chain claim in our README is no longer true.
# Read it out of the package document already fetched above rather than asking
# `npm view` for the field. `npm view <pkg> <missing.field>` prints nothing and
# still exits 0, so a `! npm view ...` guard never fires and an unsigned publish
# would sail through the very check meant to catch it.
readonly READ_PROVENANCE='
  const doc = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const dist = doc.versions?.[process.argv[1]]?.dist ?? {};
  process.stdout.write(dist.attestations?.provenance?.predicateType ?? "");
'

echo "Verifying provenance attestation"
predicate=$(printf '%s' "${body}" | node -e "${READ_PROVENANCE}" "${PKG_VERSION}")

if [ -z "${predicate}" ]; then
  echo "ERROR: ${PKG_NAME}@${PKG_VERSION} published without a provenance attestation." >&2
  echo "       package.json sets publishConfig.provenance=true, so the OIDC token" >&2
  echo "       exchange degraded to an unsigned publish instead of failing." >&2
  exit 1
fi

echo "  ✓ provenance attestation present (${predicate})"
echo "${PKG_NAME}@${PKG_VERSION} is installable, tagged latest, and signed."
