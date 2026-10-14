#!/usr/bin/env node
/**
 * Validate `browser-stack.json`, the single source of the tested browser
 * stack: Camoufox tag, playwright-core minor and accepted Juggler deltas.
 *
 * Contract: every field
 * required, no extra keys, accepted-delta identity
 * `(channel, kind, path, signature)` unique. Dependency-free on purpose: the
 * install action and the Docker mirror run it before `npm ci`.
 *
 * Usage:
 *   node scripts/browser-stack/manifest.mjs <tag|sha256> [manifest-path]
 *
 * Exit codes:
 *   0 — manifest valid; the Camoufox tag (`tag`) or the SHA-256 of its
 *       Linux x86_64 release asset (`sha256`) is printed on stdout
 *   2 — `MANIFEST-INVALID <json-pointer> <reason>` on stderr, or a usage
 *       error. Fails closed: nothing is printed unless the whole file is
 *       valid.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Numeric identifiers follow SemVer §2/§9: `0` or no leading zero, so
// `v01.0.0-beta.02` fails here as MANIFEST-INVALID, not later as a
// missing release.
const CAMOUFOX_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-(alpha|beta)\.(0|[1-9]\d*)$/u;
const SEMVER_MINOR = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
// Bare lowercase hex, as `sha256sum` prints it; GitHub's asset `digest`
// carries a `sha256:` prefix that must be dropped.
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const DELTA_PATH = /^[A-Z][A-Za-z]+\.[A-Za-z]+(\.[A-Za-z]+|\[\])*(=[^=\s]+)?$/u;
const DELTA_SIGNATURE = /^src:.+\|dst:.+$/u;
const DEFAULT_MANIFEST = fileURLToPath(new URL('../../browser-stack.json', import.meta.url));
const USAGE = 'usage: node scripts/browser-stack/manifest.mjs <tag|sha256> [manifest-path]';

/** Juggler message direction a delta was found on. */
export const DELTA_CHANNELS = Object.freeze(['request', 'return', 'event']);

/** Every delta kind the directional differ reports. */
export const DELTA_KINDS = Object.freeze([
  'MISSING-METHOD',
  'MISSING-EVENT',
  'UNKNOWN-FIELD',
  'MISSING-REQUIRED-FIELD',
  'ENUM-VALUE',
  'NULLABLE',
  'TYPE-MISMATCH',
]);

/** @typedef {{ readonly pointer: string, readonly reason: string }} ManifestIssue */
/** @typedef {readonly [string, (value: unknown) => boolean, string]} FieldRule */
/** @typedef {{ readonly tag: string, readonly linuxX64Sha256: string }} Camoufox */

/** @type {(value: unknown) => value is Record<string, unknown>} */
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @type {(re: RegExp) => (value: unknown) => boolean} */
const matching = re => value => typeof value === 'string' && re.test(value);
/** @type {(set: readonly string[]) => (value: unknown) => boolean} */
const oneOf = set => value => typeof value === 'string' && set.includes(value);
/** @type {(min: number, max: number) => (value: unknown) => boolean} */
const text = (min, max) => value =>
  typeof value === 'string' && value.trim().length >= min && value.length <= max;

/** Exact key set of every fixed object, by JSON pointer. */
const SHAPES = Object.freeze({
  '': ['$comment', 'camoufox', 'playwrightCore', 'acceptedDeltas'],
  '/camoufox': ['tag', 'linuxX64Sha256'],
  '/playwrightCore': ['testedMinor'],
});
const DELTA_KEYS = Object.freeze(['channel', 'kind', 'path', 'signature', 'reason']);

/** @type {readonly FieldRule[]} */
const ROOT_RULES = [
  ['/$comment', text(1, Infinity), 'must be a non-blank string'],
  ['/camoufox/tag', matching(CAMOUFOX_TAG), `must match ${CAMOUFOX_TAG.source}`],
  ['/camoufox/linuxX64Sha256', matching(SHA256_HEX), `must match ${SHA256_HEX.source}`],
  ['/playwrightCore/testedMinor', matching(SEMVER_MINOR), `must match ${SEMVER_MINOR.source}`],
];

/** @type {readonly FieldRule[]} */
const DELTA_RULES = [
  ['/channel', oneOf(DELTA_CHANNELS), `must be one of ${DELTA_CHANNELS.join(', ')}`],
  ['/kind', oneOf(DELTA_KINDS), `must be one of ${DELTA_KINDS.join(', ')}`],
  ['/path', matching(DELTA_PATH), `must match ${DELTA_PATH.source}`],
  ['/signature', matching(DELTA_SIGNATURE), 'must be "src:<sig>|dst:<sig>"'],
  ['/reason', text(10, 240), 'must be 10..240 characters and not blank'],
];

/** Value at a pointer of plain keys (array indices included), or undefined. */
function at(/** @type {unknown} */ doc, /** @type {string} */ pointer) {
  const keys = pointer.split('/').slice(1);
  /** @type {(node: unknown, key: string) => unknown} */
  const step = (node, key) => (typeof node === 'object' && node !== null ? node[key] : undefined);
  return keys.reduce(step, doc);
}

/** RFC 6901 escape of one reference token. */
const token = (/** @type {string} */ key) => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** @type {(pointer: string) => (reason: string) => (key: string) => ManifestIssue} */
const keyIssue = pointer => reason => key => ({ pointer: `${pointer}/${token(key)}`, reason });

/**
 * @param {unknown} node - Value at `pointer`.
 * @param {string} pointer - JSON pointer of `node`.
 * @param {readonly string[]} keys - Exact key set `node` must have.
 * @returns {ManifestIssue[]} Non-object, missing-key and extra-key findings.
 */
function shapeIssues(node, pointer, keys) {
  if (node === undefined) return [];
  if (!isRecord(node)) return [{ pointer, reason: 'must be an object' }];
  const missing = keys.filter(key => !Object.hasOwn(node, key));
  const extra = Object.keys(node).filter(key => !keys.includes(key));
  const tag = keyIssue(pointer);
  return [...missing.map(tag('is required')), ...extra.map(tag('is not allowed'))];
}

/**
 * @param {unknown} doc - Parsed manifest.
 * @param {string} base - JSON pointer the rule paths are relative to.
 * @param {readonly FieldRule[]} rules - Field rules to apply under `base`.
 * @returns {ManifestIssue[]} Every present value under `base` that breaks its rule.
 */
function ruleIssues(doc, base, rules) {
  const node = at(doc, base);
  return rules
    .map(([path, ok, reason]) => ({ pointer: `${base}${path}`, value: at(node, path), ok, reason }))
    .filter(({ value, ok }) => value !== undefined && !ok(value))
    .map(({ pointer, reason }) => ({ pointer, reason }));
}

/** @returns {ManifestIssue[]} Shape and field findings of one accepted delta. */
function deltaIssues(/** @type {unknown} */ doc, /** @type {number} */ index) {
  const base = `/acceptedDeltas/${index}`;
  return [...shapeIssues(at(doc, base), base, DELTA_KEYS), ...ruleIssues(doc, base, DELTA_RULES)];
}

/** @type {(delta: unknown) => string} Identity of an object delta; '' for anything else. */
const identityOf = delta =>
  isRecord(delta) ? JSON.stringify([delta.channel, delta.kind, delta.path, delta.signature]) : '';

/** @type {(index: number, first: number) => ManifestIssue} */
const duplicateIssue = (index, first) => ({
  pointer: `/acceptedDeltas/${index}`,
  reason: `duplicates the identity of /acceptedDeltas/${first}`,
});

/** @returns {ManifestIssue[]} One finding per accepted delta repeating an earlier identity. */
function duplicateIssues(/** @type {readonly unknown[]} */ deltas) {
  const identities = deltas.map(identityOf);
  return identities.flatMap((identity, index) => {
    const first = identities.indexOf(identity);
    return identity === '' || first === index ? [] : [duplicateIssue(index, first)];
  });
}

/** @returns {ManifestIssue[]} Fixed-object shape findings, then a non-array `acceptedDeltas`. */
function structureIssues(/** @type {Record<string, unknown>} */ doc) {
  const shapes = Object.entries(SHAPES).flatMap(([pointer, keys]) =>
    shapeIssues(at(doc, pointer), pointer, keys),
  );
  const deltas = doc.acceptedDeltas;
  if (deltas === undefined || Array.isArray(deltas)) return shapes;
  return [...shapes, { pointer: '/acceptedDeltas', reason: 'must be an array' }];
}

/**
 * Every way a parsed document breaks the manifest contract.
 *
 * @param {unknown} doc - Parsed `browser-stack.json`.
 * @returns {ManifestIssue[]} Shape, then field, then per-delta findings; empty when valid.
 */
export function validateManifest(doc) {
  if (!isRecord(doc)) return [{ pointer: '', reason: 'must be an object' }];
  const list = Array.isArray(doc.acceptedDeltas) ? doc.acceptedDeltas : [];
  const perDelta = list.flatMap((_, index) => deltaIssues(doc, index));
  const fields = ruleIssues(doc, '', ROOT_RULES);
  return [...structureIssues(doc), ...fields, ...perDelta, ...duplicateIssues(list)];
}

/**
 * Read and validate a manifest file.
 *
 * @param {string} file - Path to `browser-stack.json`.
 * @returns {{ manifest?: { camoufox: Camoufox }, issues: ManifestIssue[] }}
 *   The manifest only when it is fully valid.
 */
export function loadManifest(file) {
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const issues = validateManifest(doc);
    return issues.length === 0 ? { manifest: doc, issues } : { issues };
  } catch (error) {
    return { issues: [{ pointer: '', reason: `cannot be read as JSON (${String(error)})` }] };
  }
}

/** Selectors a CLI command prints from a valid manifest. */
const COMMANDS = Object.freeze({
  tag: (/** @type {{ camoufox: Camoufox }} */ m) => m.camoufox.tag,
  sha256: (/** @type {{ camoufox: Camoufox }} */ m) => m.camoufox.linuxX64Sha256,
});

/** @type {(issue: ManifestIssue) => string} One stderr line per finding. */
const invalidLine = ({ pointer, reason }) => `MANIFEST-INVALID ${pointer || '(root)'} ${reason}\n`;

/** Print the usage line and exit 2. */
function usageError() {
  stderr.write(`${USAGE}\n`);
  exit(2);
}

/** CLI entry: print the selected field of a valid manifest, else fail closed. */
function main() {
  const [command = '', file = DEFAULT_MANIFEST] = argv.slice(2);
  if (!Object.hasOwn(COMMANDS, command)) usageError();
  const { manifest, issues } = loadManifest(file);
  for (const issue of issues) stderr.write(invalidLine(issue));
  if (manifest === undefined) exit(2);
  stdout.write(`${COMMANDS[/** @type {keyof typeof COMMANDS} */ (command)](manifest)}\n`);
}

/** Canonical file URL, so a symlinked entry still matches `import.meta.url`. */
const canonicalHref = (/** @type {string} */ path) => pathToFileURL(realpathSync(path)).href;

if (
  argv[1] !== undefined &&
  canonicalHref(argv[1]) === canonicalHref(fileURLToPath(import.meta.url))
)
  main();
