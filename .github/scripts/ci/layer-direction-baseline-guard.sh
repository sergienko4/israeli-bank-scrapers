#!/usr/bin/env bash
# Layer-direction baseline tamper-guard
# =====================================
# The policy test trusts the working-tree baseline, so a PR could add a
# forbidden layer edge AND widen `layer-direction.baseline.json` in one diff.
# This guard asserts every baseline list only shrinks relative to the PR base.
#
# Inputs:
#   BASE_SHA — the pull request's base commit.
#   BASE_REF — the base branch name, used when the SHA is not local yet.
#
# An absent baseline on the base branch is an establishment PR: allow it.

set -euo pipefail

BASE_SHA="${BASE_SHA:?BASE_SHA must be set}"
BASE_REF="${BASE_REF:-main}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASELINE_REL="src/Tests/Tools/layer-direction.baseline.json"
BASELINE="${REPO_ROOT}/${BASELINE_REL}"
BASE_FILE="$(mktemp "${TMPDIR:-/tmp}/layer-direction-base.XXXXXX.json")"
trap 'rm -f "${BASE_FILE}"' EXIT

if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  git fetch --no-tags origin "${BASE_REF}" >/dev/null 2>&1 || true
fi

# A missing commit is a retrieval failure, not an establishment PR: failing
# open here would let a widened baseline pass whenever the fetch fails.
if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  echo "[layer-direction-guard] FAIL — cannot resolve base commit ${BASE_SHA}." >&2
  exit 1
fi

if ! git show "${BASE_SHA}:${BASELINE_REL}" > "${BASE_FILE}" 2>/dev/null; then
  echo "[layer-direction-guard] baseline absent on base — establishment allowed."
  exit 0
fi

node - "${BASE_FILE}" "${BASELINE}" <<'NODE'
const fs = require('node:fs');

/** Baseline lists the ratchet compares. */
const LISTS = ['layerViolations', 'bankNamedFiles', 'companyTypesReferences'];

/**
 * Read one baseline file.
 * @param {string} file - JSON path.
 * @returns {Record<string, unknown>} Parsed baseline.
 */
function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Read one list from a baseline.
 * @param {Record<string, unknown>} baseline - Parsed baseline.
 * @param {string} name - List name.
 * @returns {string[]} Entries.
 */
function listOf(baseline, name) {
  const value = baseline[name];
  if (!Array.isArray(value)) throw new TypeError(`missing baseline list: ${name}`);
  return value.map(String);
}

const base = read(process.argv[2]);
const head = read(process.argv[3]);
const additions = [];

for (const name of LISTS) {
  const baseSet = new Set(listOf(base, name));
  for (const entry of listOf(head, name)) {
    if (!baseSet.has(entry)) additions.push(`${name}: ${entry}`);
  }
}

if (additions.length > 0) {
  console.error('[layer-direction-guard] FAIL — the baseline may only shrink:');
  for (const entry of additions) console.error(`  + ${entry}`);
  process.exit(1);
}

console.log('[layer-direction-guard] baseline only shrank (or is unchanged). PASS');
NODE
