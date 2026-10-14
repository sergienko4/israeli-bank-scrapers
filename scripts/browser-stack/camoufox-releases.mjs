/**
 * The Camoufox releases camoufox-js chooses from, and the one it installs.
 *
 * camoufox-js (`dist/pkgman.js`, `GitHubDownloader.getAsset`) reads the first
 * page of `GET /repos/daijro/camoufox/releases` — no `per_page`, so the API
 * default of 30 — and installs the first release that is neither a prerelease
 * nor a draft and has an asset its `CamoufoxFetcher.checkAsset` accepts: a
 * `camoufox-<version>-<release>-<os>.<arch>.zip` for this platform, inside the
 * range camoufox-js supports. This module reads the same page and applies the
 * same rule with camoufox-js's own `checkAsset`, so the weekly watch reports
 * the release a consumer install picks today.
 */
import process from 'node:process';

import { FetchFailedError, fetchBounded } from './fetch-protocol.mjs';
import { CAMOUFOX_TAG } from './manifest.mjs';

/** The page camoufox-js reads. */
export const RELEASES_URL = 'https://api.github.com/repos/daijro/camoufox/releases';

/** How many of the newest version-tagged releases the candidate table lists. */
const CANDIDATE_COUNT = 10;

/** The page is about 0.5 MB and grows with release notes; leave room. */
const MAX_RELEASES_BYTES = 8 * 1024 * 1024;

/** camoufox-js's selection module; it has no `exports` map, so the path is reachable. */
const PKGMAN = '@hieutran094/camoufox-js/dist/pkgman.js';

/**
 * GitHub API request headers, with the token as a bearer when one is set.
 *
 * The policy reaches only api.github.com, so a redirect cannot carry the token elsewhere.
 *
 * @param {string | undefined} token - `GITHUB_TOKEN`, if any.
 * @returns {Record<string, string>} Headers.
 */
export function githubHeaders(token) {
  const base = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  return token ? { ...base, authorization: `Bearer ${token}` } : base;
}

/**
 * The first page of releases, newest first.
 *
 * @param {{ GITHUB_TOKEN?: string }} [env] - Environment; the token raises the rate limit.
 * @param {object} [io] - Fetch I/O overrides.
 * @returns {Promise<any[]>} Releases as the API returns them.
 * @throws {FetchFailedError} When the page cannot be read or is not a list.
 */
export async function fetchReleases(env = process.env, io = {}) {
  const headers = githubHeaders(env.GITHUB_TOKEN);
  const policy = { hosts: ['api.github.com'], maxBodyBytes: MAX_RELEASES_BYTES, headers };
  const { text } = await fetchBounded(RELEASES_URL, policy, io);
  const releases = JSON.parse(text);
  if (Array.isArray(releases)) return releases;
  throw new FetchFailedError(RELEASES_URL, 'is not a list of releases');
}

/** @type {(release: any) => boolean} Whether camoufox-js looks at the release at all. */
const eligible = release => !release.prerelease && !release.draft;

/**
 * The tag camoufox-js would install from `releases`, or `null` when it would fail.
 *
 * @param {readonly any[]} releases - The releases page, newest first.
 * @param {(asset: any) => boolean} acceptsAsset - camoufox-js's asset check for this platform.
 * @returns {string | null} Release tag.
 */
export function selectRelease(releases, acceptsAsset) {
  const chosen = releases.find(r => eligible(r) && (r.assets ?? []).some(acceptsAsset));
  return chosen?.tag_name ?? null;
}

/**
 * The newest version-tagged releases, for the candidate table.
 *
 * Tags such as `font-bundle-v1` are not browser versions the gate can compare, so they are left out.
 *
 * @param {readonly any[]} releases - The releases page, newest first.
 * @returns {{ tag: string, prerelease: boolean }[]} Up to {@link CANDIDATE_COUNT} rows.
 */
export function candidateReleases(releases) {
  const tagged = releases.filter(r => CAMOUFOX_TAG.test(String(r.tag_name)));
  const newest = tagged.slice(0, CANDIDATE_COUNT);
  return newest.map(r => ({ tag: r.tag_name, prerelease: Boolean(r.prerelease) }));
}

/**
 * camoufox-js's own asset check for this machine, and the platform it checks.
 *
 * @returns {Promise<{ platform: string, acceptsAsset: (asset: any) => boolean }>} The check.
 */
export async function platformAssetCheck() {
  const { CamoufoxFetcher, OS_NAME } = await import(PKGMAN);
  const fetcher = new CamoufoxFetcher();
  const acceptsAsset = (/** @type {any} */ asset) => fetcher.checkAsset(asset) !== null;
  return { platform: `${OS_NAME} ${fetcher.arch}`, acceptsAsset };
}
