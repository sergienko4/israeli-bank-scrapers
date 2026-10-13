#!/usr/bin/env bash
# Install the pinned Camoufox build into camoufox-js's cache directory.
#
# One script for the install-camoufox composite action (CI) and
# docker/Dockerfile.ci-mirror, so the mirror carries the build CI tests.
# The tag is `camoufox.tag` in browser-stack.json, read through the
# manifest validator, which fails closed (exit 2, MANIFEST-INVALID) unless
# the WHOLE manifest is valid. Never hardcode a version here.
#
# A cache hit — version.json records the pinned tag AND camoufox-bin is a
# non-empty executable regular file — skips the download; anything less is a
# miss. A miss tries `camoufox-js fetch` first; camoufox-js resolves the
# newest release inside its own supported range rather than an exact tag, so
# any other result is replaced by the pinned release asset. Do
# NOT let that fallback track LATEST: v150.0.2-beta.25's locale
# regression (navigator.language he-IL to en-US) broke
# AntiDetection.e2e-mocked.test.ts.
#
# Download: `gh release download` when GH_TOKEN is set (CI); otherwise
# curl from the public release URL (the Docker build has no token). gh
# reads the token from the environment; this script never prints it.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../../.." && pwd)
PINNED_TAG=$(node "${REPO_ROOT}/scripts/browser-stack/manifest.mjs" tag)
# The directory camoufox-js installs to and launches from on Linux: the
# CAMOUFOX_INSTALL_DIR override, else the per-user cache. Pinning any other
# directory would leave the runtime on whatever camoufox-js put there.
CACHE_DIR="${CAMOUFOX_INSTALL_DIR:-$HOME/.cache/camoufox}"
# camoufox-js records the install as {"version","release"} and reads it
# back on launch; `<version>-<release>` is the tag minus the `v`.
EXPECTED="${PINNED_TAG#v}"
ASSET="camoufox-${EXPECTED}-lin.x86_64.zip"
ASSET_DIR=""
trap 'rm -rf "${ASSET_DIR}"' EXIT

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

# -f first: -s and -x also hold for a searchable, non-empty directory.
binary_ok() {
  [ -f "$CACHE_DIR/camoufox-bin" ] && [ -s "$CACHE_DIR/camoufox-bin" ] && [ -x "$CACHE_DIR/camoufox-bin" ]
}

installed_version() {
  [ -f "$CACHE_DIR/version.json" ] || return 1
  node -e 'const fs = require("fs");
    const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(v.version + "-" + v.release);' "$CACHE_DIR/version.json"
}

pinned_cache_ok() {
  [ "$(installed_version || true)" = "$EXPECTED" ] && binary_ok
}

download_asset() {
  if [ -n "${GH_TOKEN:-}" ]; then
    gh release download "${PINNED_TAG}" --repo daijro/camoufox --pattern "${ASSET}" --dir "$1" --clobber
  else
    curl -fsSL --retry 3 -o "$1/${ASSET}" "https://github.com/daijro/camoufox/releases/download/${PINNED_TAG}/${ASSET}"
  fi
}

install_pinned_release() {
  echo "Downloading pinned daijro/camoufox release: ${PINNED_TAG}"
  ASSET_DIR=$(mktemp -d "${TMPDIR:-/tmp}/camoufox-asset.XXXXXX")
  download_asset "$ASSET_DIR"
  rm -rf "$CACHE_DIR"
  mkdir -p "$CACHE_DIR"
  unzip -o "$ASSET_DIR/$ASSET" -d "$CACHE_DIR/"
  chmod -R 755 "$CACHE_DIR"
  # version.json goes last: a failed or partial extract leaves none, so the
  # next run sees a miss instead of trusting a half-installed cache.
  binary_ok || fail "no usable camoufox-bin after extracting ${ASSET}"
  printf '{"version":"%s","release":"%s"}' "${EXPECTED%%-*}" "${EXPECTED#*-}" > "$CACHE_DIR/version.json"
}

if pinned_cache_ok; then
  echo "Camoufox ${PINNED_TAG} already cached, skipping fetch"
else
  echo "Cache miss — attempting camoufox-js fetch..."
  if npx @hieutran094/camoufox-js fetch && pinned_cache_ok; then
    echo "Camoufox ${PINNED_TAG} installed via camoufox-js"
  else
    echo "camoufox-js produced '$(installed_version || echo none)', want ${EXPECTED} — installing the pinned asset instead"
    install_pinned_release
  fi
fi
binary_ok || fail "no usable camoufox-bin in $CACHE_DIR"
