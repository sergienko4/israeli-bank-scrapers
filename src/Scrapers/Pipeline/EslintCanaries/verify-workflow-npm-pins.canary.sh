#!/usr/bin/env bash
# Canary — closes spec.txt §1 RC-4 (PinnedDependenciesID for npm
# commands in workflow run blocks).
#
# Scans the supplied workflow YAML for `npm install -g npm@<version>`
# invocations and requires the two properties npm actually honours:
#
#   1. an exact version pin (`npm@11.11.0`, never `npm@latest` or a
#      range), which is what PinnedDependenciesID is about; and
#   2. `--ignore-scripts`, so a compromised tarball cannot execute
#      lifecycle scripts during the upgrade.
#
# This canary previously demanded `--audit-signatures`. `npm install`
# has no such flag: npm 12 rejects it outright with EUNKNOWNCONFIG, and
# older npm silently ignored it, so it verified nothing while reading
# like it did. Signature verification is the separate `npm audit
# signatures` command, which runs against an installed tree and so
# cannot guard the upgrade that installs the CLI itself.
#
# Exits 0 when every npm install is exactly pinned and script-free (or
# there is no npm install at all), non-zero otherwise. The harness runs
# this against both the accepted fixture (must pass) and the rejected
# fixture (must fail).
#
# Applicable guidelines (per spec.txt §1 RC-4):
#   - coding-principle-guidlines.md §11 — Dependency Security.
#   - dependency-updates-guidlines.md — version pinning policy.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <workflow.yml>" >&2
  exit 2
fi

FILE="$1"
if [[ ! -f "$FILE" ]]; then
  echo "fixture not found: $FILE" >&2
  exit 2
fi

# Match the alias forms (`install`, `i`) and both global flag variants
# (`-g`, `--global`) in any order so the canary catches the variants the
# strict prior regex missed.
# Pattern: `npm (install|i) ... (-g|--global) ... npm@`
#
# Shell quotes are removed first: a quoted spec such as `'npm@latest'`
# would otherwise not be preceded by whitespace, so the line would escape
# detection entirely and every rule below would be skipped for it.
UNQUOTED="$(<"$FILE")"
UNQUOTED="${UNQUOTED//[\'\"]/}"
NPM_LINES="$(printf '%s\n' "$UNQUOTED" | grep -E 'npm[[:space:]]+(install|i)[[:space:]]+([^[:space:]]+[[:space:]]+)*(-g|--global)([[:space:]]+[^[:space:]]+)*[[:space:]]+npm@' || true)"
if [[ -z "$NPM_LINES" ]]; then
  # No npm install line — nothing to pin.
  exit 0
fi

while IFS= read -r line; do
  # An exact three-part version ending at a word boundary. `npm@latest`,
  # `npm@^11.11.0`, `npm@11` and prereleases like `npm@11.11.0-rc.1` all
  # fail this, and all of them float.
  if [[ ! "$line" =~ npm@[0-9]+\.[0-9]+\.[0-9]+([[:space:]]|$) ]]; then
    exit 1
  fi
  # A semver hyphen range (`npm@11.11.0 - 12.0.0`) opens with an
  # exact-looking token, so it satisfies the check above yet still floats.
  if [[ "$line" =~ npm@[0-9]+\.[0-9]+\.[0-9]+[[:space:]]+-[[:space:]] ]]; then
    exit 1
  fi
  # npm honours the last value, so a disabling form anywhere on the line
  # wins even when an enabling one precedes it.
  if [[ "$line" =~ --ignore-scripts=false ]] || [[ "$line" =~ --no-ignore-scripts ]]; then
    exit 1
  fi
  # Enabled form only. `--ignore-scripts=false` contains the flag as a
  # substring while disabling it.
  if [[ ! "$line" =~ --ignore-scripts(=true)?([[:space:]]|$) ]]; then
    exit 1
  fi
  # Not merely unnecessary: npm 12 fails the install with
  # EUNKNOWNCONFIG, which would break publishing.
  if [[ "$line" =~ --audit-signatures ]]; then
    exit 1
  fi
done <<< "$NPM_LINES"

exit 0
