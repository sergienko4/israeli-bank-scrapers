#!/usr/bin/env bash
# Install the pinned Camoufox build into camoufox-js's install directory.
#
# One script for the install-camoufox composite action (CI) and
# docker/Dockerfile.ci-mirror, so the mirror carries the build CI tests.
# The tag and the SHA-256 of its Linux x86_64 asset are `camoufox.tag` and
# `camoufox.linuxX64Sha256` in browser-stack.json, read through the
# manifest validator, which fails closed (exit 2, MANIFEST-INVALID) unless
# the WHOLE manifest is valid. Never hardcode either value here.
#
# Every run installs from release-asset bytes that hash to the pinned
# digest, and trusts nothing already on disk: an install left by an earlier
# run, or restored from a cache, could hold any binary. Checking it would
# need a second pin per release for the whole extracted tree, so the
# script checks the one asset file instead and extracts it on every run.
#
# The asset is the copy kept in CAMOUFOX_ASSET_DIR when that is set and the
# copy still hashes to the pin; the action restores that directory from its
# cache. Otherwise the script downloads it: `gh release download` when
# GH_TOKEN is set (CI), else curl from the public release URL (the Docker
# build has no token). gh reads the token from the environment; this script
# never prints it. A download that does not hash to the pin fails the run
# before anything is extracted. With CAMOUFOX_ASSET_DIR set, a verified
# download is kept there and `downloaded=true` goes to $GITHUB_OUTPUT, so the
# action saves it. Unset, the asset sits in a temp directory removed on exit,
# so the Docker image keeps no copy.
#
# The run changes nothing it did not create, except a kept asset that
# failed the hash: it installs into a directory that does not exist yet and
# never replaces one. CI jobs and the Docker build always start without one;
# to reinstall, remove the old install first.
#
# It never runs `camoufox-js fetch`: that resolves the newest non-prerelease
# release inside camoufox-js's own range (`>=alpha.1, <1`), not an exact tag,
# so it matches the pin only when the pin is that release. Do NOT track
# LATEST: a past release's locale regression (navigator.language he-IL to
# en-US) broke AntiDetection.e2e-mocked.test.ts.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../../.." && pwd)
PINNED_TAG=$(node "${REPO_ROOT}/scripts/browser-stack/manifest.mjs" tag)
PINNED_SHA256=$(node "${REPO_ROOT}/scripts/browser-stack/manifest.mjs" sha256)
# The directory camoufox-js installs to and launches from on Linux: the
# CAMOUFOX_INSTALL_DIR override, else the per-user cache. Pinning any other
# directory would leave the runtime on whatever camoufox-js put there.
# Trailing slashes go, so a symlink there is seen as the link it is.
INSTALL_DIR="${CAMOUFOX_INSTALL_DIR:-$HOME/.cache/camoufox}"
while [ "$INSTALL_DIR" != / ] && [ "${INSTALL_DIR%/}" != "$INSTALL_DIR" ]; do
  INSTALL_DIR="${INSTALL_DIR%/}"
done
ASSET_DIR="${CAMOUFOX_ASSET_DIR:-}"
# camoufox-js records the install as {"version","release"} and reads it
# back on launch; `<version>-<release>` is the tag minus the `v`.
EXPECTED="${PINNED_TAG#v}"
ASSET="camoufox-${EXPECTED}-lin.x86_64.zip"
ASSET_PATH=""
DOWNLOADED=false
TEMP_DIR=""
STAGE_DIR=""

# rename(2) through node: unlike mv, it never moves into an existing
# directory; a directory replaces only an absent or empty one, and a file
# never replaces a directory.
rename_exact() {
  node -e 'try { require("fs").renameSync(process.argv[1], process.argv[2]); }
    catch (e) { console.error(e.message); process.exit(1); }' "$1" "$2"
}

cleanup() {
  local dir
  for dir in "$TEMP_DIR" "$STAGE_DIR"; do
    [ -z "$dir" ] || rm -rf -- "$dir"
  done
}
trap cleanup EXIT

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

# -f first: -s and -x also hold for a searchable, non-empty directory.
binary_ok() {
  [ -f "$1/camoufox-bin" ] && [ -s "$1/camoufox-bin" ] && [ -x "$1/camoufox-bin" ]
}

download_asset() {
  if [ -n "${GH_TOKEN:-}" ]; then
    gh release download "${PINNED_TAG}" --repo daijro/camoufox --pattern "${ASSET}" --dir "$1" --clobber
  else
    curl -fsSL --retry 3 --connect-timeout 30 --max-time 1800 -o "$1/${ASSET}" "https://github.com/daijro/camoufox/releases/download/${PINNED_TAG}/${ASSET}"
  fi
}

# Streamed through node, which this script already needs, rather than
# sha256sum: macOS ships shasum instead, and streaming keeps the large asset
# out of memory.
sha256_of() {
  node -e 'const h = require("crypto").createHash("sha256");
    require("fs").createReadStream(process.argv[1])
      .on("data", d => h.update(d))
      .on("end", () => process.stdout.write(h.digest("hex")));' "$1"
}

# A cache key names what was saved; it does not prove what was restored.
use_kept_asset() {
  local kept="$ASSET_DIR/$ASSET" actual
  [ -n "$ASSET_DIR" ] && [ -f "$kept" ] || return 1
  actual=$(sha256_of "$kept") || return 1
  if [ "$actual" != "$PINNED_SHA256" ]; then
    echo "Kept ${ASSET} has sha256 ${actual}, not the pinned ${PINNED_SHA256}; downloading it again"
    return 1
  fi
  echo "Using the kept ${ASSET}, which hashes to the pin"
  ASSET_PATH="$kept"
}

verify_download() {
  local actual
  actual=$(sha256_of "$1") || fail "cannot hash ${ASSET}"
  [ "$actual" = "$PINNED_SHA256" ] ||
    fail "${ASSET} has sha256 ${actual}, but browser-stack.json pins ${PINNED_SHA256}"
}

# Only a regular file at the kept name, which failed the hash, gives way to
# the verified download; anything else a restored cache left there stays.
# The download sits in ASSET_DIR already, so keeping it is one rename(2).
keep_asset() {
  local kept="$ASSET_DIR/$ASSET"
  if [ -L "$kept" ] || { [ -e "$kept" ] && [ ! -f "$kept" ]; } ||
    ! rename_exact "$ASSET_PATH" "$kept"; then
    echo "WARNING: not keeping ${ASSET}: ${kept} is not a regular file" >&2
    return 0
  fi
  ASSET_PATH="$kept"
  DOWNLOADED=true
}

download_pinned_asset() {
  local dir="${TMPDIR:-/tmp}"
  echo "Downloading pinned daijro/camoufox release: ${PINNED_TAG}"
  if [ -n "$ASSET_DIR" ]; then
    mkdir -p -- "$ASSET_DIR"
    dir="$ASSET_DIR"
  fi
  TEMP_DIR=$(mktemp -d "${dir}/.camoufox-asset.XXXXXX")
  download_asset "$TEMP_DIR"
  verify_download "$TEMP_DIR/$ASSET"
  ASSET_PATH="$TEMP_DIR/$ASSET"
  [ -z "$ASSET_DIR" ] || keep_asset
}

report_download() {
  [ -z "${GITHUB_OUTPUT:-}" ] || echo "downloaded=${DOWNLOADED}" >> "$GITHUB_OUTPUT"
}

# Whatever is at INSTALL_DIR, even an older Camoufox install, an empty
# directory or a symlink, is left as it is: the run fails before the
# download. CAMOUFOX_INSTALL_DIR is caller input, so it must be absolute.
refuse_unless_absent() {
  case "$INSTALL_DIR" in
    /*) ;;
    *) fail "refusing to install into ${INSTALL_DIR}: CAMOUFOX_INSTALL_DIR must be an absolute path" ;;
  esac
  if [ -e "$INSTALL_DIR" ] || [ -L "$INSTALL_DIR" ]; then
    fail "refusing to install into ${INSTALL_DIR}: it already exists; set CAMOUFOX_INSTALL_DIR" \
      "to a path that does not, or remove an old Camoufox install there first"
  fi
}

# Info-ZIP exits 1 for warnings after a complete extract. Some release
# assets trigger it with entries whose local and central filenames differ,
# which unzip resolves to the central name. So 1 passes; 2 and up (format,
# I/O, unsupported method, missing archive) fail.
extract_asset() {
  local status=0
  unzip -o "$ASSET_PATH" -d "$1/" || status=$?
  [ "$status" -le 1 ] || fail "unzip exit ${status} extracting ${ASSET}"
}

# A sibling of INSTALL_DIR, so a failed run installs nothing and the move
# into place is a rename within one filesystem. version.json goes last,
# after the binary check, so no partial tree is ever recorded.
stage_install() {
  local parent
  parent=$(dirname -- "$INSTALL_DIR")
  mkdir -p -- "$parent"
  STAGE_DIR=$(mktemp -d "${parent}/.camoufox-stage.XXXXXX")
  extract_asset "$STAGE_DIR"
  chmod -R 755 "$STAGE_DIR"
  binary_ok "$STAGE_DIR" || fail "no usable camoufox-bin after extracting ${ASSET}"
  printf '{"version":"%s","release":"%s"}' "${EXPECTED%%-*}" "${EXPECTED#*-}" > "$STAGE_DIR/version.json"
}

# Minutes of download pass after the refusal check, so rename(2) is the
# final one: it fails, leaving INSTALL_DIR as it is, if anything but an
# empty directory appeared there meanwhile.
move_into_place() {
  rename_exact "$STAGE_DIR" "$INSTALL_DIR" ||
    fail "cannot rename the staged install to ${INSTALL_DIR}"
  STAGE_DIR=""
}

refuse_unless_absent
if ! use_kept_asset; then
  download_pinned_asset
fi
report_download
stage_install
move_into_place
echo "Installed Camoufox ${PINNED_TAG} into ${INSTALL_DIR}"
