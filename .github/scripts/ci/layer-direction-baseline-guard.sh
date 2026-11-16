#!/usr/bin/env bash
# Layer-direction policy tamper-guard
# ==================================
# The policy test trusts the working-tree policy and baseline, so a PR could
# relax an allowed edge (or add a forbidden one) AND widen the baseline in one
# diff. This guard asserts both files only shrink relative to the PR base.
#
# Inputs:
#   BASE_SHA — the pull request's base commit.
#   BASE_REF — the base branch name, used when the SHA is not local yet.
#
# An absent policy or baseline on the base branch is an establishment PR.

set -euo pipefail

BASE_SHA="${BASE_SHA:?BASE_SHA must be set}"
BASE_REF="${BASE_REF:-main}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
POLICY_REL="src/Tests/Tools/layer-direction.policy.json"
BASELINE_REL="src/Tests/Tools/layer-direction.baseline.json"
POLICY="${REPO_ROOT}/${POLICY_REL}"
BASELINE="${REPO_ROOT}/${BASELINE_REL}"
BASE_POLICY="$(mktemp "${TMPDIR:-/tmp}/layer-direction-policy.XXXXXX.json")"
BASE_FILE="$(mktemp "${TMPDIR:-/tmp}/layer-direction-base.XXXXXX.json")"
trap 'rm -f "${BASE_POLICY}" "${BASE_FILE}"' EXIT

if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  git fetch --no-tags origin "${BASE_REF}" >/dev/null 2>&1 || true
fi

# A missing commit is a retrieval failure, not an establishment PR: failing
# open here would let a relaxed policy pass whenever the fetch fails.
if ! git cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null; then
  echo "[layer-direction-guard] FAIL — cannot resolve base commit ${BASE_SHA}." >&2
  exit 1
fi

if ! git show "${BASE_SHA}:${POLICY_REL}" > "${BASE_POLICY}" 2>/dev/null; then
  echo "[layer-direction-guard] policy absent on base — establishment allowed."
  exit 0
fi
if ! git show "${BASE_SHA}:${BASELINE_REL}" > "${BASE_FILE}" 2>/dev/null; then
  echo "[layer-direction-guard] baseline absent on base — establishment allowed."
  exit 0
fi

node - "${BASE_POLICY}" "${POLICY}" "${BASE_FILE}" "${BASELINE}" <<'NODE'
const fs = require('node:fs');

/** Baseline lists the ratchet compares. */
const LISTS = ['layerViolations', 'bankNamedFiles', 'companyTypesReferences'];

/**
 * Read one JSON document.
 * @param {string} file - JSON path.
 * @returns {Record<string, unknown>} Parsed document.
 */
function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Read one array field.
 * @param {Record<string, unknown>} document - Parsed document.
 * @param {string} name - Field name.
 * @returns {string[]} Entries.
 */
function listOf(document, name) {
  const value = document[name];
  if (!Array.isArray(value)) throw new TypeError(`missing list: ${name}`);
  return value.map(String);
}

/**
 * Read one layer's allowed targets.
 * @param {Record<string, unknown>} policy - Parsed policy.
 * @param {string} layer - Source layer.
 * @returns {string[]} Allowed target layers.
 */
function allowedOf(policy, layer) {
  const allowed = policy.allowed;
  if (allowed === null || typeof allowed !== 'object') throw new TypeError('missing allowed map');
  const targets = allowed[layer];
  if (!Array.isArray(targets)) throw new TypeError(`missing allowed targets: ${layer}`);
  return targets.map(String);
}

const basePolicy = read(process.argv[2]);
const headPolicy = read(process.argv[3]);
const base = read(process.argv[4]);
const head = read(process.argv[5]);
const additions = [];

const baseLayers = listOf(basePolicy, 'layers');
const headLayers = listOf(headPolicy, 'layers');
if (JSON.stringify(baseLayers) !== JSON.stringify(headLayers)) {
  additions.push(`policy layers: ${headLayers.join(',')}`);
}

for (const layer of baseLayers) {
  const baseTargets = new Set(allowedOf(basePolicy, layer));
  for (const target of allowedOf(headPolicy, layer)) {
    if (!baseTargets.has(target)) additions.push(`policy: ${layer} -> ${target}`);
  }
}

for (const name of LISTS) {
  const baseSet = new Set(listOf(base, name));
  for (const entry of listOf(head, name)) {
    if (!baseSet.has(entry)) additions.push(`${name}: ${entry}`);
  }
}

if (additions.length > 0) {
  console.error('[layer-direction-guard] FAIL — the policy and baseline may only shrink:');
  for (const entry of additions) console.error(`  + ${entry}`);
  process.exit(1);
}

console.log('[layer-direction-guard] policy and baseline only shrank (or are unchanged). PASS');
NODE
