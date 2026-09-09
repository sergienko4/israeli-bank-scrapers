#!/usr/bin/env bash
# Canary — closes spec.txt §1 RC-4 (PinnedDependenciesID for npm
# commands in workflow run blocks).
#
# Scans the supplied workflow YAML for commands that install the npm CLI
# globally, and requires the two properties npm actually honours:
#
#   1. an exact version pin (`npm@11.11.0`, never `npm@latest`, a range
#      or a prerelease), which is what PinnedDependenciesID is about; and
#   2. `--ignore-scripts`, so a compromised tarball cannot execute
#      lifecycle scripts during the upgrade.
#
# A `run:` block is shell, not one command per line, so scanning raw
# lines let a rule be satisfied by text belonging to a *different*
# command — or to a comment. Each block is therefore normalised into one
# command per line before any rule is applied.
#
# Scope, deliberately: this reads the command as written. A version
# supplied through a variable (`npm@$NPM_VERSION`), or a CLI obtained
# without naming it (`npx npm@latest`, `corepack prepare`, a tarball
# URL), is not evaluated — a linter cannot resolve those without
# executing the workflow.
#
# This canary previously demanded `--audit-signatures`. `npm install`
# has no such flag: npm 12 rejects it outright with EUNKNOWNCONFIG, and
# older npm silently ignored it, so it verified nothing while reading
# like it did. Signature verification is the separate `npm audit
# signatures` command, which runs against an installed tree and so
# cannot guard the upgrade that installs the CLI itself.
#
# Exits 0 when every global npm CLI install is exactly pinned and
# script-free (or there is none), non-zero otherwise. The harness runs
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

# Every alias npm itself resolves to `install`, so `npm add -g npm@latest`
# and `npm isntall -g npm@latest` are the same command as `npm install`.
# The typo-looking entries are npm's own shipped aliases, not a mistake
# here: `npm isntall --help` prints "Install a package". Deleting them
# reopens the bypass they close. Longest first, so the alternation cannot
# stop at a prefix.
readonly INSTALL_ALIAS='(install|instal|insta|inst|isntall|isntal|isnta|isnt|ins|in|add|i)'
# Every spelling of "install globally". npm reads any `--global` value
# except `false` as true (`--global=0` and `--global=no` both resolve
# global, verified with `npm root`), and `--location` takes its value
# either attached or as the next word.
readonly GLOBAL_FLAG='(-g|--global(=[^[:space:]]*)?|--location(=|[[:space:]]+)global)'
# The spellings that put the install back in the local tree, which the
# broad `--global=<value>` match above would otherwise catch.
readonly LOCAL_FLAG='(--global=false|--no-global|--location(=|[[:space:]]+)user)'
# The npm CLI as an install target, with or without a version.
readonly CLI_TARGET='(^|[[:space:]])npm(@[^[:space:]]*)?([[:space:]]|$)'

# Turn a shell fragment into one command per line:
#   1. join `\` continuations, so one command is one line;
#   2. walk each line tracking quote state, dropping quotes and
#      truncating at a `#` that starts a real comment;
#   3. split on `;`, `&&`, `||` and `|`, so each command stands alone.
#
# Step 2 must be quote-aware in a single pass. Stripping quotes first
# would turn the literal `#` in `echo "#" && npm install -g npm@latest`
# into a comment and delete the install behind it — the shell runs that
# install, so the canary would accept an unpinned upgrade. A `#` opens a
# comment when it is unquoted and starts a word; a word begins at the
# start of a line, after whitespace, or straight after a command
# separator, so `build;# npm install -g npm@latest` is a comment and the
# hidden text never runs. A `#` anywhere else is ordinary text, which is
# why a URL fragment survives.
#
# Step 3 splits on the single characters, so `&&` and `||` simply yield
# an extra blank line, which the loop ignores.
#
# @returns The normalised command list, one per line, on stdout.
normalise_commands() {
  printf '%s\n' "$1" |
    awk '
      BEGIN { SINGLE = sprintf("%c", 39); DOUBLE = sprintf("%c", 34) }
      function strip_quotes_and_comment(line,   i, ch, out, in_single, in_double, prev) {
        out = ""
        prev = " "
        for (i = 1; i <= length(line); i++) {
          ch = substr(line, i, 1)
          if (ch == SINGLE && !in_double) { in_single = !in_single; prev = ch; continue }
          if (ch == DOUBLE && !in_single) { in_double = !in_double; prev = ch; continue }
          if (ch == "#" && !in_single && !in_double && prev ~ /[[:space:];&|()]/) { break }
          out = out ch
          prev = ch
        }
        return out
      }
      {
        line = $0
        while (line ~ /\\$/) {
          sub(/\\$/, " ", line)
          if ((getline continuation) > 0) { line = line continuation } else { break }
        }
        print strip_quotes_and_comment(line)
      }
    ' |
    tr '&;|' '\n\n\n'
}

# Whether a single command installs the npm CLI globally. Flags may
# precede the subcommand (`npm --global install`), and the target may
# sit either side of the global flag.
#
# @returns 0 when the command is a global npm CLI install.
is_global_cli_install() {
  local cmd="$1"
  [[ $cmd =~ (^|[[:space:]])npm([[:space:]]+-[^[:space:]]+)*[[:space:]]+$INSTALL_ALIAS([[:space:]]|$) ]] || return 1
  [[ $cmd =~ (^|[[:space:]])$GLOBAL_FLAG([[:space:]]|$) ]] || return 1
  if [[ $cmd =~ (^|[[:space:]])$LOCAL_FLAG([[:space:]]|$) ]]; then
    return 1
  fi
  # Look past the `npm` naming the executable, so the match is the
  # package being installed rather than the command running.
  [[ ${cmd#*npm} =~ $CLI_TARGET ]]
}

# @returns 0 when the install is exactly pinned and runs no scripts.
is_pinned_and_script_free() {
  local cmd="$1"
  # An exact three-part version, as its own token. A bare `npm` target
  # carries no version at all and fails here, as it must: it floats.
  # Deliberately stable releases only: a prerelease or build-metadata
  # suffix (`npm@11.11.0-rc.1`, `npm@11.11.0+build.5`) is pinned but is
  # not a released CLI, and this gate guards a publish pipeline.
  if [[ ! $cmd =~ (^|[[:space:]])npm@[0-9]+\.[0-9]+\.[0-9]+([[:space:]]|$) ]]; then
    return 1
  fi
  # A semver hyphen range (`npm@11.11.0 - 12.0.0`) opens with an
  # exact-looking token, so it satisfies the check above yet still floats.
  if [[ $cmd =~ npm@[0-9]+\.[0-9]+\.[0-9]+[[:space:]]+-[[:space:]] ]]; then
    return 1
  fi
  # npm honours the last value, so a disabling form anywhere on the
  # command wins even when an enabling one precedes it.
  if [[ $cmd =~ (^|[[:space:]])--ignore-scripts=false([[:space:]]|$) ]] ||
    [[ $cmd =~ (^|[[:space:]])--no-ignore-scripts([[:space:]]|$) ]]; then
    return 1
  fi
  # Enabled form only, and as a whole token: `--ignore-scripts=false`
  # contains the flag as a substring while disabling it, and an unrelated
  # `--foo--ignore-scripts` ends in it while never enabling it at all.
  # Deliberately the canonical spellings only — npm also reads `=1` and
  # `=yes` as true, but rejecting those can only ask for a clearer
  # command, never let a script-running install through.
  if [[ ! $cmd =~ (^|[[:space:]])--ignore-scripts(=true)?([[:space:]]|$) ]]; then
    return 1
  fi
  # Not merely unnecessary: npm 12 fails the install with
  # EUNKNOWNCONFIG, which would break publishing.
  if [[ $cmd =~ --audit-signatures ]]; then
    return 1
  fi
  return 0
}

# A normaliser failure must not read as "no commands found": this is a
# security gate, so it fails closed.
if ! COMMANDS="$(normalise_commands "$(<"$FILE")")"; then
  echo "failed to normalise $FILE" >&2
  exit 2
fi

while IFS= read -r command; do
  if is_global_cli_install "$command"; then
    is_pinned_and_script_free "$command" || exit 1
  fi
done <<<"$COMMANDS"

exit 0
