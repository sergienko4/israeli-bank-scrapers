/**
 * Type declarations for `scripts/browser-stack/camoufox-releases.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that drive it need this to type their fixtures rather than import `any`.
 */

import type { IFetchIo } from './gate.mjs';

/** One release asset, as the GitHub releases API returns it. */
export interface IReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

/** One release, as the GitHub releases API returns it. */
export interface IRelease {
  readonly tag_name: string;
  readonly prerelease: boolean;
  readonly draft: boolean;
  readonly assets: readonly IReleaseAsset[];
}

/** One row of the candidate table. */
export interface ICandidateRelease {
  readonly tag: string;
  readonly prerelease: boolean;
}

/** camoufox-js's asset check for one platform. */
export interface IPlatformAssetCheck {
  readonly platform: string;
  readonly acceptsAsset: (asset: IReleaseAsset) => boolean;
}

/** The page camoufox-js reads. */
export declare const RELEASES_URL: string;

/**
 * GitHub API request headers, with the token as a bearer when one is set.
 *
 * @param token - `GITHUB_TOKEN`, if any.
 * @returns Headers.
 */
export function githubHeaders(token: string | undefined): Record<string, string>;

/**
 * The first page of releases, newest first.
 *
 * @param env - Environment; the token raises the rate limit.
 * @param io - Fetch I/O overrides.
 * @returns Releases as the API returns them.
 */
export function fetchReleases(
  env?: { readonly GITHUB_TOKEN?: string },
  io?: IFetchIo,
): Promise<IRelease[]>;

/**
 * The tag camoufox-js would install from `releases`, or `null` when it would fail.
 *
 * @param releases - The releases page, newest first.
 * @param acceptsAsset - camoufox-js's asset check for this platform.
 * @returns Release tag.
 */
export function selectRelease(
  releases: readonly IRelease[],
  acceptsAsset: (asset: IReleaseAsset) => boolean,
): string | null;

/**
 * The newest version-tagged releases, for the candidate table.
 *
 * @param releases - The releases page, newest first.
 * @returns Up to ten rows.
 */
export function candidateReleases(releases: readonly IRelease[]): ICandidateRelease[];

/**
 * camoufox-js's own asset check for this machine, and the platform it checks.
 *
 * @returns The check.
 */
export function platformAssetCheck(): Promise<IPlatformAssetCheck>;
