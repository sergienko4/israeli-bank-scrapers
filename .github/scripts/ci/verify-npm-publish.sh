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
# The registry is read-through-cache and eventually consistent, and since
# npm's publish-time malware scan a freshly published version is not merely
# uncached but absent: it becomes installable only once scanning completes.
# That is expected, not a failure — hence the bounded poll rather than a
# single request.
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

# npm scans every publish before the version becomes installable, which it
# documents as "typically around five minutes... up to 15 minutes or more at
# peak", with the explicit instruction to update automation that assumes
# immediate availability:
# https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/
#
# The budget is therefore set against that documented ceiling rather than its
# typical case: a budget sized for the typical case reports a healthy release
# as broken roughly whenever a scan runs slow. 80 x 15s = 20 minutes.
#
# This used to be 12 x 10s = 120s, written when the registry committed a
# version synchronously. Release 8.7.2 became installable 127s after publish —
# a fast scan by npm's own numbers — and the gate had already given up 16s
# earlier, failing a release that had in fact shipped correctly.
#
# Overridable so the smoke test can exercise both the give-up path and the
# appears-on-a-later-poll path in milliseconds.
readonly MAX_ATTEMPTS="${VERIFY_MAX_ATTEMPTS:-80}"
readonly SLEEP_SECONDS="${VERIFY_SLEEP_SECONDS:-15}"

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

echo "Verifying ${PKG_NAME}@${PKG_VERSION} on registry.npmjs.org (budget $((MAX_ATTEMPTS * SLEEP_SECONDS))s)"

attempt=1
# Three outcomes have to stay distinguishable, because they need three
# different recoveries. `published` and `latest` are only assigned inside the
# curl-success branch, so without this flag an unreadable registry is
# indistinguishable from a readable one that lacks the version.
did_read_document=no
while [ "${attempt}" -le "${MAX_ATTEMPTS}" ]; do
  # A 404 while the CDN catches up is normal; treat any non-200 as "not yet".
  if body=$(curl --fail --silent --show-error --location "${REGISTRY_URL}" 2>/dev/null); then
    did_read_document=yes
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
    if [ "${did_read_document}" = "no" ]; then
      echo "       The package document was never readable: every request to" >&2
      echo "       ${REGISTRY_URL} failed. That is a registry or network fault," >&2
      echo "       and it is no evidence about the publish itself -- the version" >&2
      echo "       may well be live. Re-run once the registry answers." >&2
      exit 1
    fi
    echo "       Consumers running 'npm install ${PKG_NAME}' are still getting" >&2
    echo "       '${latest:-the previous release}'." >&2
    # The loop already knows which of the two signals failed. Reporting both
    # the same way sends an operator to re-run a release that a re-run cannot
    # repair: a stale tag means the tarball is published and scanned, and only
    # `npm dist-tag` moves it.
    if [ "${published:-}" = "${PKG_VERSION}" ]; then
      echo "       The version itself resolves, so the tarball was published and" >&2
      echo "       scanned -- but dist-tags.latest was never moved onto it. A re-run" >&2
      echo "       will not fix this; move the tag with 'npm dist-tag add'." >&2
    else
      echo "       The version does not resolve at all. Either the publish never" >&2
      echo "       reached the registry, or npm's publish-time scan is still running" >&2
      echo "       or has blocked this version. Check" >&2
      echo "       https://www.npmjs.com/package/${PKG_NAME} before re-running: a" >&2
      echo "       version that is merely slow will appear on its own." >&2
    fi
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
