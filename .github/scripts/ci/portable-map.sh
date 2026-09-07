#!/usr/bin/env bash
# Portable string-keyed maps
# ==========================
# macOS ships bash 3.2 (the last GPLv2 release) and has done since
# 2007. bash 3.2 has no associative arrays — `declare -A` is bash 4+.
# Our gate scripts run in three places with three different shells:
#
#   - GitHub Actions (ubuntu-latest) ....... bash 5.x
#   - a contributor's macOS husky hook ..... bash 3.2
#   - a contributor's Git-Bash on Windows .. bash 4.4/5.x
#
# A gate that only runs on one of them is not a gate. These helpers
# provide the `declare -A` behaviour the scripts need using nothing
# newer than bash 3.1, so the same code path executes everywhere.
#
# Representation: a plain string variable holding one "key<TAB>value"
# record per line. Lookups use awk's `$1 == k` — a literal, whole-field
# comparison, so keys are never treated as regexes and never match as
# substrings of a longer key.
#
# Constraint: keys and values must contain no TAB and no newline. Every
# caller uses repo-relative paths or TypeScript identifiers, neither of
# which can contain either character.
#
# Tested by `.github/scripts/ci/tests/portable-map.test.sh`, run by
# `npm run lint:shell-tests` and by the "Docs coverage extractor unit
# test" job in `.github/workflows/pr.yml`. On macOS that test executes
# under the system bash 3.2 and BSD awk, which is the oldest
# combination we support — if it passes there it passes everywhere.

# map_put <map-var-name> <key> <value>
#
# Appends a record. Putting the same key twice keeps BOTH records, so a
# map can bind one key to many values; `map_get` then reports the first
# and `map_get_all` reports every one, in insertion order.
map_put() {
    local __map_var="$1"
    printf -v "$__map_var" '%s%s\t%s\n' "${!__map_var:-}" "$2" "$3"
}

# map_get <map-var-name> <key>
#
# Prints the FIRST value bound to the key, or nothing when the key is
# absent. Callers that need an "or default" apply it themselves, e.g.
#   v="$(map_get M "$k")"; [ -n "$v" ] || v="$fallback"
map_get() {
    local __map_var="$1"
    printf '%s' "${!__map_var:-}" \
        | awk -F'\t' -v k="$2" '$1 == k { print $2; exit }'
}

# map_get_all <map-var-name> <key>
#
# Prints EVERY value bound to the key, one per line, in insertion order.
map_get_all() {
    local __map_var="$1"
    printf '%s' "${!__map_var:-}" \
        | awk -F'\t' -v k="$2" '$1 == k { print $2 }'
}

# map_has <map-var-name> <key>
#
# Exits 0 when the key is present, 1 when absent. Distinguishes "key
# bound to an empty value" from "key absent", which `map_get` cannot —
# that difference is what lets a map model a set.
map_has() {
    local __map_var="$1"
    printf '%s' "${!__map_var:-}" \
        | awk -F'\t' -v k="$2" '$1 == k { found = 1; exit } END { exit !found }'
}
