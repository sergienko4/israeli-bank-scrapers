/**
 * Type declarations for `scripts/browser-stack/playwright-versions.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that drive it need this to type their fixtures rather than import `any`.
 */

import type { IFetchIo } from './gate.mjs';

/** The fields of the abbreviated packument the watch reads. */
export interface IPackument {
  readonly 'dist-tags'?: Readonly<Record<string, string>>;
  readonly versions?: Readonly<Record<string, unknown>>;
}

/** One candidate version and every reason it is listed. */
export interface IPlaywrightCandidate {
  readonly version: string;
  readonly labels: readonly string[];
}

/** The abbreviated packument URL. */
export declare const PACKUMENT_URL: string;

/**
 * The abbreviated packument of playwright-core.
 *
 * @param io - Fetch I/O overrides.
 * @returns The packument.
 */
export function fetchPackument(io?: IFetchIo): Promise<IPackument>;

/**
 * The minor after `minor`: `1.63` → `1.64`.
 *
 * @param minor - `major.minor`.
 * @returns `major.minor`.
 */
export function nextMinor(minor: string): string;

/**
 * The highest stable patch of `minor`, or `undefined` when none is published.
 *
 * @param versions - Every published version.
 * @param minor - `major.minor`.
 * @returns Version.
 */
export function highestPatch(versions: readonly string[], minor: string): string | undefined;

/**
 * Candidate versions, deduplicated, each with every reason it is listed.
 *
 * @param packument - The abbreviated packument.
 * @param locked - The lockfile version.
 * @param testedMinor - `playwrightCore.testedMinor` of the manifest.
 * @returns Rows in lockfile, next-minor, latest order.
 */
export function playwrightCandidates(
  packument: IPackument,
  locked: string,
  testedMinor: string,
): IPlaywrightCandidate[];
