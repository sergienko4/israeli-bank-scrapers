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
# need a second pin per release for the ~1.3 GB extracted tree, so the
# script checks the ~663 MB asset instead and extracts it on every run.
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
# It never runs `camoufox-js fetch`: that resolves the newest release inside
# camoufox-js's own range (`>=alpha.1, <1`), not an exact tag, so it matches
# the pin only when the pin is the newest release. Do NOT track LATEST:
# v150.0.2-beta.25's locale regression (navigator.language he-IL to en-US)
# broke AntiDetection.e2e-mocked.test.ts.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../../.." && pwd)
PINNED_TAG=$(node "${REPO_ROOT}/scripts/browser-stack/manifest.mjs" tag)
PINNED_SHA256=$(node "${REPO_ROOT}/scripts/browser-stack/manifest.mjs" sha256)
# The directory camoufox-js installs to and launches from on Linux: the
# CAMOUFOX_INSTALL_DIR override, else the per-user cache. Pinning any other
# directory would leave the runtime on whatever camoufox-js put there.
# Trailing slashes go: on a symlink they would make mv act on its target.
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
OLD_DIR=""
BACKUP=""
STAGE_ID=""

# rename(2) through node: unlike mv, it never moves into an existing
# directory, and it fails rather than replace a non-empty one.
rename_exact() {
  node -e 'try { require("fs").renameSync(process.argv[1], process.argv[2]); }
    catch (e) { console.error(e.message); process.exit(1); }' "$1" "$2"
}

# The device and inode of an entry itself (not a symlink's target); a rename
# keeps both, so they show where the staged tree went.
entry_id() {
  node -e 'const s = require("fs").lstatSync(process.argv[1], { bigint: true });
    process.stdout.write(s.dev + ":" + s.ino);' "$1" 2>/dev/null
}

# Renaming the checked staging dir into place is the commit. Before it, an
# exit puts the previous install back, or leaves it set aside when something
# else now holds INSTALL_DIR; once INSTALL_DIR is the staged tree itself, the
# previous install is dropped, even if the run is stopped right after.
restore_backup() {
  [ -n "$BACKUP" ] || return 0
  [ -e "$BACKUP" ] || [ -L "$BACKUP" ] || return 0
  if [ -n "$STAGE_ID" ] && [ "$(entry_id "$INSTALL_DIR")" = "$STAGE_ID" ]; then
    return 0
  fi
  rename_exact "$BACKUP" "$INSTALL_DIR" && return 0
  echo "WARNING: the previous install is left at ${BACKUP}" >&2
  OLD_DIR=""
}

cleanup() {
  local dir
  restore_backup
  for dir in "$TEMP_DIR" "$STAGE_DIR" "$OLD_DIR"; do
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

installed_version() {
  [ -f "$1/version.json" ] || return 1
  node -e 'const fs = require("fs");
    const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(v.version + "-" + v.release);' "$1/version.json"
}

download_asset() {
  if [ -n "${GH_TOKEN:-}" ]; then
    gh release download "${PINNED_TAG}" --repo daijro/camoufox --pattern "${ASSET}" --dir "$1" --clobber
  else
    curl -fsSL --retry 3 -o "$1/${ASSET}" "https://github.com/daijro/camoufox/releases/download/${PINNED_TAG}/${ASSET}"
  fi
}

# Streamed through node, which this script already needs, rather than
# sha256sum: macOS ships shasum instead, and the asset is over 600 MB.
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

download_pinned_asset() {
  echo "Downloading pinned daijro/camoufox release: ${PINNED_TAG}"
  TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/camoufox-asset.XXXXXX")
  download_asset "$TEMP_DIR"
  verify_download "$TEMP_DIR/$ASSET"
  ASSET_PATH="$TEMP_DIR/$ASSET"
  [ -n "$ASSET_DIR" ] || return 0
  # Whatever sits at the kept path failed the hash, and mv would move the
  # asset into a directory a restored cache left there, so it goes first.
  mkdir -p -- "$ASSET_DIR"
  rm -rf -- "${ASSET_DIR:?}/$ASSET"
  mv -f -- "$ASSET_PATH" "$ASSET_DIR/$ASSET"
  ASSET_PATH="$ASSET_DIR/$ASSET"
  DOWNLOADED=true
}

report_download() {
  [ -z "${GITHUB_OUTPUT:-}" ] || echo "downloaded=${DOWNLOADED}" >> "$GITHUB_OUTPUT"
}

# Installing replaces INSTALL_DIR, and CAMOUFOX_INSTALL_DIR is caller input,
# so a mistyped override must fail rather than erase unrelated files. Only
# an absolute path other than $HOME that is absent, empty, or already a
# Camoufox install (a camoufox-bin entry or a tag-shaped version.json) may
# be replaced. A populated / is none of those.
TAG_SHAPE='^[0-9]+\.[0-9]+\.[0-9]+-(alpha|beta)\.[0-9]+$'

camoufox_install() {
  [ -e "$1/camoufox-bin" ] || [ -L "$1/camoufox-bin" ] ||
    [[ "$(installed_version "$1" 2>/dev/null || true)" =~ $TAG_SHAPE ]]
}

# `ls` failing (an unreadable directory) must refuse, not read as empty.
replaceable_dir() {
  local dir="$1" real home entries
  case "$dir" in /*) ;; *) return 1 ;; esac
  [ -e "$dir" ] || [ -L "$dir" ] || return 0
  real=$(cd -P -- "$dir" 2>/dev/null && pwd -P) || return 1
  home=$(cd -P -- "${HOME:-/}" 2>/dev/null && pwd -P) || home=/
  [ "$real" != "$home" ] || return 1
  entries=$(ls -A -- "$real") || return 1
  [ -z "$entries" ] || camoufox_install "$dir"
}

refuse_unless_replaceable() {
  replaceable_dir "$INSTALL_DIR" || fail "refusing to replace ${INSTALL_DIR}: CAMOUFOX_INSTALL_DIR must be" \
    "an absolute path, not \$HOME, that is absent, empty or a Camoufox install"
}

# A sibling of INSTALL_DIR, so a failed extract leaves the current install
# untouched and the swap is a rename within one filesystem. version.json
# goes last, after the binary check, so no partial tree is ever recorded.
stage_install() {
  local parent
  parent=$(dirname -- "$INSTALL_DIR")
  mkdir -p -- "$parent"
  STAGE_DIR=$(mktemp -d "${parent}/.camoufox-stage.XXXXXX")
  unzip -o "$ASSET_PATH" -d "$STAGE_DIR/"
  chmod -R 755 "$STAGE_DIR"
  binary_ok "$STAGE_DIR" || fail "no usable camoufox-bin after extracting ${ASSET}"
  printf '{"version":"%s","release":"%s"}' "${EXPECTED%%-*}" "${EXPECTED#*-}" > "$STAGE_DIR/version.json"
}

# The guard runs again here, not only before the download: the directory
# can change while minutes of download pass. The old install is set aside
# under a name made just now, so mv cannot nest it, and what was set aside
# is checked once more, since it can change between the guard and the mv.
# The staged tree passed its checks, and rename(2) moves that same
# directory, so it is not checked again once in place.
swap_in_stage() {
  refuse_unless_replaceable
  STAGE_ID=$(entry_id "$STAGE_DIR") || fail "cannot stat ${STAGE_DIR}"
  if [ -e "$INSTALL_DIR" ] || [ -L "$INSTALL_DIR" ]; then
    OLD_DIR=$(mktemp -d "$(dirname -- "$INSTALL_DIR")/.camoufox-old.XXXXXX")
    BACKUP="$OLD_DIR/install"
    mv -- "$INSTALL_DIR" "$BACKUP"
    replaceable_dir "$BACKUP" ||
      fail "refusing to replace ${INSTALL_DIR}: it changed as it was set aside"
  fi
  rename_exact "$STAGE_DIR" "$INSTALL_DIR" ||
    fail "cannot move the staged install into ${INSTALL_DIR}"
  STAGE_DIR=""
  BACKUP=""
}

refuse_unless_replaceable
if ! use_kept_asset; then
  download_pinned_asset
fi
report_download
stage_install
swap_in_stage
echo "Installed Camoufox ${PINNED_TAG} into ${INSTALL_DIR}"
