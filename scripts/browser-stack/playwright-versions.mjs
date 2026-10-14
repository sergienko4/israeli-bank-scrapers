/**
 * The playwright-core versions the weekly watch pairs with Camoufox releases.
 *
 * - the lockfile version — what CI runs;
 * - the highest stable patch of the minor after `testedMinor` — the next
 *   Dependabot bump;
 * - what a consumer's install resolves from the library's own
 *   `dependencies['playwright-core']` range in package.json: `latest` when it
 *   satisfies the range, else the highest stable version that does, as npm picks.
 *
 * Duplicates collapse into one row that keeps every label. The registry does
 * not resolve ranges, so both come from the abbreviated packument's version
 * list; prereleases (`-alpha`, `-beta`, `-next`) are never candidates. Only a
 * caret range on a stable version (`^1.62.0`) is resolved: any other form is
 * RANGE-UNSUPPORTED, an input failure, rather than a guess.
 */
import { readFileSync } from 'node:fs';

import { fetchBounded } from './fetch-protocol.mjs';
import { GateInfraError } from './gate-inputs.mjs';
import { minorOf } from './gate-report.mjs';

/**
 * @typedef {import('./gate.d.mts').IFetchIo} IFetchIo
 * @typedef {import('./playwright-versions.d.mts').IPackument} IPackument
 * @typedef {import('./playwright-versions.d.mts').ICaretRange} ICaretRange
 * @typedef {import('./playwright-versions.d.mts').ICandidateSources} ICandidateSources
 * @typedef {import('./playwright-versions.d.mts').IPlaywrightCandidate} IPlaywrightCandidate
 * @typedef {[string | undefined, string]} Listed - A version, if any, and why it is listed.
 */

/** The abbreviated packument: every version and the dist-tags. */
export const PACKUMENT_URL = 'https://registry.npmjs.org/playwright-core';

/** The abbreviated packument is about 8.5 MB and grows with every nightly. */
const PACKUMENT_POLICY = Object.freeze({
  hosts: Object.freeze(['registry.npmjs.org']),
  maxBodyBytes: 32 * 1024 * 1024,
  headers: Object.freeze({ accept: 'application/vnd.npm.install-v1+json' }),
});

/** Long enough for the packument body on a slow runner. */
export const PACKUMENT_TIMEOUT_MS = 60_000;

/** A stable `x.y.z`, as the gate's `--playwright` accepts. */
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

/** A caret range on a stable version, the only form resolved: `^1.62.0`. */
const CARET = /^\^((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u;

/** The dependency whose range a consumer install resolves. */
const DEPENDENCY = 'playwright-core';

/**
 * The abbreviated packument of playwright-core.
 *
 * @param {IFetchIo} [io] - Fetch I/O overrides.
 * @returns {Promise<IPackument>} The packument.
 * @throws {import('./fetch-protocol.mjs').FetchFailedError} When it cannot be read.
 */
export async function fetchPackument(io = {}) {
  const overrides = { timeoutMs: PACKUMENT_TIMEOUT_MS, ...io };
  const { text } = await fetchBounded(PACKUMENT_URL, PACKUMENT_POLICY, overrides);
  return JSON.parse(text);
}

/** @type {(path: string, detail: string) => GateInfraError} */
const packageError = (path, detail) => new GateInfraError([`PACKAGE-INVALID ${path} ${detail}`]);

/** Parsed package.json, or PACKAGE-INVALID. */
function packageJson(/** @type {string} */ path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw packageError(path, `cannot be read as JSON (${String(error)})`);
  }
}

/**
 * The library's own playwright-core range, or PACKAGE-INVALID.
 *
 * @param {string} path - Path to `package.json`.
 * @returns {string} The range as written, e.g. `^1.62.0`.
 */
export function dependencyRange(path) {
  const range = packageJson(path)?.dependencies?.[DEPENDENCY];
  if (typeof range === 'string') return range;
  throw packageError(path, `dependencies["${DEPENDENCY}"] is not a string`);
}

/** @type {(version: string) => number[]} `x.y.z` as three numbers. */
const partsOf = version => version.split('.').map(Number);

/** @type {(a: readonly number[], b: readonly number[]) => number} Negative when `a` is lower. */
const compareParts = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Exclusive upper bound of a caret range: its leftmost non-zero part bumped, as npm does. */
function caretCeiling(/** @type {readonly number[]} */ low) {
  const nonZero = low.findIndex(part => part > 0);
  const at = nonZero === -1 ? low.length - 1 : nonZero;
  const zeros = low.slice(at + 1).map(() => 0);
  return [...low.slice(0, at), low[at] + 1, ...zeros];
}

/**
 * The bounds of a caret range, or RANGE-UNSUPPORTED for any other form.
 *
 * `^1.62.0` is >=1.62.0 <2.0.0; `^0.4.1` is >=0.4.1 <0.5.0; `^0.0.3` is >=0.0.3 <0.0.4.
 *
 * @param {string} text - The range as written.
 * @returns {ICaretRange} The text, the inclusive low and the exclusive high bound.
 */
export function caretRange(text) {
  const match = CARET.exec(text);
  if (match === null) throw new GateInfraError([`RANGE-UNSUPPORTED ${text}`]);
  const low = partsOf(match[1]);
  return { text, low, high: caretCeiling(low) };
}

/** @type {(range: ICaretRange) => (version: string) => boolean} Whether a version satisfies it. */
const satisfies = range => version => {
  if (!STABLE.test(version)) return false;
  const parts = partsOf(version);
  return compareParts(parts, range.low) >= 0 && compareParts(parts, range.high) < 0;
};

/**
 * The highest stable version `keep` accepts, or `undefined` when there is none.
 *
 * @param {readonly string[]} versions - Every published version.
 * @param {(version: string) => boolean} keep - Which versions count.
 * @returns {string | undefined} Version.
 */
function highest(versions, keep) {
  const kept = versions.filter(v => STABLE.test(v) && keep(v)).map(partsOf);
  return kept.sort(compareParts).at(-1)?.join('.');
}

/** @type {(minor: string) => string} The minor after `minor`: `1.63` → `1.64`. */
export const nextMinor = minor => {
  const [major, value] = minor.split('.');
  return `${major}.${Number(value) + 1}`;
};

/**
 * The highest stable patch of `minor`, or `undefined` when none is published.
 *
 * @param {readonly string[]} versions - Every published version.
 * @param {string} minor - `major.minor`.
 * @returns {string | undefined} Version.
 */
export function highestPatch(versions, minor) {
  return highest(versions, v => minorOf(v) === minor);
}

/**
 * What npm installs for `range`, or `undefined` when no stable version satisfies it.
 *
 * `latest` when it satisfies the range, else the highest stable version that does.
 *
 * @param {IPackument} packument - The abbreviated packument.
 * @param {ICaretRange} range - The consumer's range.
 * @returns {string | undefined} Version.
 */
export function resolveRange(packument, range) {
  const inRange = satisfies(range);
  const latest = packument['dist-tags']?.latest;
  if (latest !== undefined && inRange(latest)) return latest;
  return highest(Object.keys(packument.versions ?? {}), inRange);
}

/** @type {(range: string) => string} The row label of the version a range resolves to. */
export const rangeLabel = range => `range ${range}`;

/** Listed versions as rows: each version once, with every label, unlisted ones dropped. */
function collapse(/** @type {readonly Listed[]} */ listed) {
  /** @type {Map<string, string[]>} */
  const rows = new Map();
  for (const [version, label] of listed.filter(([v]) => STABLE.test(String(v)))) {
    rows.set(String(version), [...(rows.get(String(version)) ?? []), label]);
  }
  return [...rows].map(([version, labels]) => ({ version, labels }));
}

/**
 * Candidate versions, deduplicated, each with every reason it is listed.
 *
 * @param {IPackument} packument - The abbreviated packument.
 * @param {ICandidateSources} sources - Lockfile version, `testedMinor`, consumer range.
 * @returns {IPlaywrightCandidate[]} Rows in lockfile, next-minor, range order.
 */
export function playwrightCandidates(packument, sources) {
  const next = nextMinor(sources.testedMinor);
  const versions = Object.keys(packument.versions ?? {});
  return collapse([
    [sources.locked, 'lockfile'],
    [highestPatch(versions, next), `next minor ${next}`],
    [resolveRange(packument, sources.range), rangeLabel(sources.range.text)],
  ]);
}
