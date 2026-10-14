/**
 * Inputs of the browser-stack gate: CLI options, `browser-stack.json` and the
 * playwright-core version `package-lock.json` resolves. Anything invalid is a
 * {@link GateInfraError} (exit 2), never a verdict.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { MODE_NAMES } from './gate-report.mjs';
import { CAMOUFOX_TAG, issueLine, loadManifest } from './manifest.mjs';

/**
 * Valid CLI options.
 *
 * @typedef {object} CliOptions
 * @property {string} [playwright] - playwright-core version `x.y.z`.
 * @property {string} [camoufox] - Camoufox release tag.
 * @property {string} mode - One of {@link MODE_NAMES}.
 * @property {boolean} json - Whether `--json` was given.
 */

/**
 * A `browser-stack.json` that passed `validateManifest`.
 *
 * @typedef {object} Manifest
 * @property {string} $comment - Free-text note.
 * @property {{ tag: string }} camoufox - Camoufox release tag the stack is tested with.
 * @property {{ testedMinor: string }} playwrightCore - playwright-core minor it is tested with.
 * @property {AcceptedDelta[]} acceptedDeltas - Reviewed deltas.
 */

/**
 * An accepted delta: its identity, and why it is harmless.
 *
 * @typedef {import('./juggler-diff.d.mts').IJugglerDelta & { reason: string }} AcceptedDelta
 */

/**
 * Value rule of one string option: name, pattern, what it must be.
 *
 * @typedef {readonly [name: 'playwright' | 'camoufox' | 'mode', re: RegExp, what: string]} ArgRule
 */

/** A stable `x.y.z` version; prereleases have no upstream `Protocol.js` tag. */
const PLAYWRIGHT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const LOCK_KEY = 'node_modules/playwright-core';
const USAGE =
  'usage: node scripts/check-browser-stack.mjs [--playwright <x.y.z>] [--camoufox <tag>]' +
  ' [--mode gate|candidate] [--json]';

/** @type {import('node:util').ParseArgsConfig['options']} */
const OPTIONS = {
  playwright: { type: 'string' },
  camoufox: { type: 'string' },
  mode: { type: 'string', default: 'gate' },
  json: { type: 'boolean', default: false },
};

/**
 * Value rule of each string option: name, pattern, what it must be.
 *
 * @type {readonly ArgRule[]}
 */
const ARG_RULES = Object.freeze([
  ['playwright', PLAYWRIGHT_VERSION, 'a stable playwright-core version x.y.z'],
  ['camoufox', CAMOUFOX_TAG, 'a Camoufox release tag such as v135.0.1-beta.24'],
  ['mode', new RegExp(`^(${MODE_NAMES.join('|')})$`, 'u'), MODE_NAMES.join(' or ')],
]);

/** The gate cannot decide: exit 2 with one line per cause. */
export class GateInfraError extends Error {
  /** @param {string[]} lines - Report lines, each `<LABEL> <detail>`. */
  constructor(lines) {
    super(lines.join('\n'));
    this.name = 'GateInfraError';
    this.lines = lines;
  }
}

/** @type {(details: string[]) => GateInfraError} USAGE lines, then the synopsis. */
const usageError = details => new GateInfraError([...details.map(d => `USAGE ${d}`), USAGE]);

/** Option values; a syntax error (unknown flag, missing value) is USAGE. */
function parsedArgs(/** @type {readonly string[]} */ args) {
  try {
    return parseArgs({ args: [...args], options: OPTIONS, strict: true }).values;
  } catch (error) {
    throw usageError([String(/** @type {Partial<Error> | undefined} */ (error)?.message ?? error)]);
  }
}

/** @type {(values: CliOptions) => string[]} One line per value its rule rejects. */
const ruleViolations = values =>
  ARG_RULES.filter(([name, re]) => values[name] !== undefined && !re.test(values[name])).map(
    ([name, , what]) => `--${name} must be ${what}`,
  );

/**
 * Option values that pass every {@link ARG_RULES} entry.
 *
 * @param {readonly string[]} args - CLI arguments after the script path.
 * @returns {CliOptions} `playwright`, `camoufox`, `mode`, `json`.
 */
export function parseCli(args) {
  const values = /** @type {CliOptions} */ (parsedArgs(args));
  const violations = ruleViolations(values);
  if (violations.length === 0) return values;
  throw usageError(violations);
}

/**
 * The fully valid manifest, or MANIFEST-INVALID with every finding.
 *
 * @param {string} path - Path to `browser-stack.json`.
 * @returns {Manifest} The manifest.
 */
export function readManifest(path) {
  const { manifest, issues } = loadManifest(path);
  if (manifest !== undefined) return /** @type {Manifest} */ (manifest);
  throw new GateInfraError(issues.map(issueLine));
}

/** @type {(path: string, detail: string) => GateInfraError} */
const lockfileError = (path, detail) => new GateInfraError([`LOCKFILE-INVALID ${path} ${detail}`]);

/** Parsed lockfile, or LOCKFILE-INVALID. */
function lockJson(/** @type {string} */ path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw lockfileError(path, `cannot be read as JSON (${String(error)})`);
  }
}

/**
 * playwright-core version the lockfile resolves, or LOCKFILE-INVALID.
 *
 * @param {string} path - Path to `package-lock.json`.
 * @returns {string} Stable `x.y.z` version.
 */
export function lockedPlaywright(path) {
  const version = lockJson(path)?.packages?.[LOCK_KEY]?.version;
  if (typeof version === 'string' && PLAYWRIGHT_VERSION.test(version)) return version;
  throw lockfileError(path, `packages["${LOCK_KEY}"].version is not x.y.z`);
}
