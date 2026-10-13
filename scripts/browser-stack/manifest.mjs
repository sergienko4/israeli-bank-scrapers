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
 *   node scripts/browser-stack/manifest.mjs tag [manifest-path]
 *
 * Exit codes:
 *   0 — manifest valid; the Camoufox tag is printed on stdout
 *   2 — `MANIFEST-INVALID <json-pointer> <reason>` on stderr, or a usage
 *       error. Fails closed: no tag is printed unless the whole file is valid.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CAMOUFOX_TAG = /^v\d+\.\d+\.\d+-(alpha|beta)\.\d+$/u;
const SEMVER_MINOR = /^\d+\.\d+$/u;
const DELTA_PATH = /^[A-Z][A-Za-z]+\.[A-Za-z]+(\.[A-Za-z]+|\[\])*(=[^=\s]+)?$/u;
const DELTA_SIGNATURE = /^src:.+\|dst:.+$/u;
const DEFAULT_MANIFEST = fileURLToPath(new URL('../../browser-stack.json', import.meta.url));
const USAGE = 'usage: node scripts/browser-stack/manifest.mjs tag [manifest-path]';

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
  '/camoufox': ['tag'],
  '/playwrightCore': ['testedMinor'],
});
const DELTA_KEYS = Object.freeze(['channel', 'kind', 'path', 'signature', 'reason']);

/** @type {readonly FieldRule[]} */
const ROOT_RULES = [
  ['/$comment', text(1, Infinity), 'must be a non-blank string'],
  ['/camoufox/tag', matching(CAMOUFOX_TAG), `must match ${CAMOUFOX_TAG.source}`],
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

/** @returns {ManifestIssue[]} Non-object, missing-key and extra-key findings. */
function shapeIssues(/** @type {unknown} */ node, /** @type {string} */ pointer, /** @type {readonly string[]} */ keys) {
  if (node === undefined) return [];
  if (!isRecord(node)) return [{ pointer, reason: 'must be an object' }];
  const missing = keys.filter(key => !Object.hasOwn(node, key));
  const extra = Object.keys(node).filter(key => !keys.includes(key));
  const tag = (/** @type {string} */ reason) => (/** @type {string} */ key) => ({ pointer: `${pointer}/${token(key)}`, reason });
  return [...missing.map(tag('is required')), ...extra.map(tag('is not allowed'))];
}

/** @returns {ManifestIssue[]} Every present value under `base` that breaks its rule. */
function ruleIssues(/** @type {unknown} */ doc, /** @type {string} */ base, /** @type {readonly FieldRule[]} */ rules) {
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

/** @returns {ManifestIssue[]} One finding per accepted delta repeating an earlier identity. */
function duplicateIssues(/** @type {readonly unknown[]} */ deltas) {
  const identities = deltas.map(d => (isRecord(d) ? JSON.stringify([d.channel, d.kind, d.path, d.signature]) : ''));
  return identities.flatMap((identity, index) => {
    const first = identities.indexOf(identity);
    if (identity === '' || first === index) return [];
    return [{ pointer: `/acceptedDeltas/${index}`, reason: `duplicates the identity of /acceptedDeltas/${first}` }];
  });
}

/**
 * Every way a parsed document breaks the manifest contract.
 *
 * @param {unknown} doc - Parsed `browser-stack.json`.
 * @returns {ManifestIssue[]} Shape, then field, then per-delta findings; empty when valid.
 */
export function validateManifest(doc) {
  if (!isRecord(doc)) return [{ pointer: '', reason: 'must be an object' }];
  const shapes = Object.entries(SHAPES).flatMap(([pointer, keys]) => shapeIssues(at(doc, pointer), pointer, keys));
  const deltas = doc.acceptedDeltas;
  if (deltas !== undefined && !Array.isArray(deltas)) shapes.push({ pointer: '/acceptedDeltas', reason: 'must be an array' });
  const list = Array.isArray(deltas) ? deltas : [];
  const perDelta = list.flatMap((_, index) => deltaIssues(doc, index));
  return [...shapes, ...ruleIssues(doc, '', ROOT_RULES), ...perDelta, ...duplicateIssues(list)];
}

/**
 * Read and validate a manifest file.
 *
 * @param {string} file - Path to `browser-stack.json`.
 * @returns {{ manifest?: { camoufox: { tag: string } }, issues: ManifestIssue[] }}
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
const COMMANDS = Object.freeze({ tag: (/** @type {{ camoufox: { tag: string } }} */ m) => m.camoufox.tag });

/** CLI entry: print the selected field of a valid manifest, else fail closed. */
function main() {
  const [command = '', file = DEFAULT_MANIFEST] = argv.slice(2);
  if (!Object.hasOwn(COMMANDS, command)) {
    stderr.write(`${USAGE}\n`);
    exit(2);
  }
  const { manifest, issues } = loadManifest(file);
  for (const { pointer, reason } of issues) stderr.write(`MANIFEST-INVALID ${pointer || '(root)'} ${reason}\n`);
  if (manifest === undefined) exit(2);
  stdout.write(`${COMMANDS[/** @type {'tag'} */ (command)](manifest)}\n`);
}

/** Canonical file URL, so a symlinked entry still matches `import.meta.url`. */
const canonicalHref = (/** @type {string} */ path) => pathToFileURL(realpathSync(path)).href;

if (argv[1] !== undefined && canonicalHref(argv[1]) === canonicalHref(fileURLToPath(import.meta.url))) main();
