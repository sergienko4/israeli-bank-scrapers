/**
 * The playwright-core versions the weekly watch pairs with Camoufox releases.
 *
 * - the lockfile version — what CI runs;
 * - the highest stable patch of the minor after `testedMinor` — the next
 *   Dependabot bump;
 * - npm `latest` — what a consumer's `^` range resolves to.
 *
 * Duplicates collapse into one row that keeps every label. The registry does
 * not resolve ranges, so the patch comes from the abbreviated packument's
 * version list; prereleases (`-alpha`, `-beta`, `-next`) are never candidates.
 */
import { fetchBounded } from './fetch-protocol.mjs';
import { minorOf } from './gate-report.mjs';

/** The abbreviated packument: every version and the dist-tags. */
export const PACKUMENT_URL = 'https://registry.npmjs.org/playwright-core';

/** The abbreviated packument is about 8.5 MB and grows with every nightly. */
const PACKUMENT_POLICY = Object.freeze({
  hosts: Object.freeze(['registry.npmjs.org']),
  maxBodyBytes: 32 * 1024 * 1024,
  headers: Object.freeze({ accept: 'application/vnd.npm.install-v1+json' }),
});

/** Long enough for the packument body on a slow runner. */
const PACKUMENT_TIMEOUT_MS = 60_000;

/** A stable `x.y.z`, as the gate's `--playwright` accepts. */
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

/**
 * The abbreviated packument of playwright-core.
 *
 * @param {object} [io] - Fetch I/O overrides.
 * @returns {Promise<any>} The packument.
 * @throws {import('./fetch-protocol.mjs').FetchFailedError} When it cannot be read.
 */
export async function fetchPackument(io = {}) {
  const overrides = { timeoutMs: PACKUMENT_TIMEOUT_MS, ...io };
  const { text } = await fetchBounded(PACKUMENT_URL, PACKUMENT_POLICY, overrides);
  return JSON.parse(text);
}

/** @type {(minor: string) => string} The minor after `minor`: `1.63` → `1.64`. */
export const nextMinor = minor => {
  const [major, value] = minor.split('.');
  return `${major}.${Number(value) + 1}`;
};

/** @type {(version: string) => number} The patch number of a stable version. */
const patchOf = version => Number(version.split('.')[2]);

/**
 * The highest stable patch of `minor`, or `undefined` when none is published.
 *
 * @param {readonly string[]} versions - Every published version.
 * @param {string} minor - `major.minor`.
 * @returns {string | undefined} Version.
 */
export function highestPatch(versions, minor) {
  const line = versions.filter(v => STABLE.test(v) && minorOf(v) === minor);
  return line.reduce(
    (top, v) => (top === undefined || patchOf(v) > patchOf(top) ? v : top),
    undefined,
  );
}

/**
 * Candidate versions, deduplicated, each with every reason it is listed.
 *
 * @param {any} packument - The abbreviated packument.
 * @param {string} locked - The lockfile version.
 * @param {string} testedMinor - `playwrightCore.testedMinor` of the manifest.
 * @returns {{ version: string, labels: string[] }[]} Rows in lockfile, next-minor, latest order.
 */
export function playwrightCandidates(packument, locked, testedMinor) {
  const next = nextMinor(testedMinor);
  const listed = [
    [locked, 'lockfile'],
    [highestPatch(Object.keys(packument.versions ?? {}), next), `next minor ${next}`],
    [packument['dist-tags']?.latest, 'npm latest'],
  ];
  const rows = new Map();
  for (const [version, label] of listed.filter(([v]) => STABLE.test(String(v)))) {
    rows.set(version, [...(rows.get(version) ?? []), label]);
  }
  return [...rows].map(([version, labels]) => ({ version, labels }));
}
