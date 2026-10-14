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

/** A caret range on a stable version: `^1.62.0` is >=1.62.0 <2.0.0. */
export interface ICaretRange {
  readonly text: string;
  /** Inclusive lower bound, `[major, minor, patch]`. */
  readonly low: readonly number[];
  /** Exclusive upper bound, `[major, minor, patch]`. */
  readonly high: readonly number[];
}

/** Where the candidate versions come from besides the packument. */
export interface ICandidateSources {
  /** The lockfile version. */
  readonly locked: string;
  /** `playwrightCore.testedMinor` of the manifest. */
  readonly testedMinor: string;
  /** The library's own playwright-core range. */
  readonly range: ICaretRange;
}

/** One candidate version and every reason it is listed. */
export interface IPlaywrightCandidate {
  readonly version: string;
  readonly labels: readonly string[];
}

/** The abbreviated packument URL. */
export declare const PACKUMENT_URL: string;

/** Timeout of one packument attempt. */
export declare const PACKUMENT_TIMEOUT_MS: number;

/**
 * The abbreviated packument of playwright-core.
 *
 * @param io - Fetch I/O overrides.
 * @returns The packument.
 */
export function fetchPackument(io?: IFetchIo): Promise<IPackument>;

/**
 * The library's own playwright-core range, or PACKAGE-INVALID.
 *
 * @param path - Path to `package.json`.
 * @returns The range as written, e.g. `^1.62.0`.
 * @throws {GateInfraError} When it cannot be read or is not a string.
 */
export function dependencyRange(path: string): string;

/**
 * The bounds of a caret range, or RANGE-UNSUPPORTED for any other form.
 *
 * @param text - The range as written.
 * @returns The text, the inclusive low and the exclusive high bound.
 * @throws {GateInfraError} When `text` is not `^x.y.z` on a stable version.
 */
export function caretRange(text: string): ICaretRange;

/**
 * What npm installs for `range`: `latest` when it satisfies the range, else the
 * highest stable version that does; `undefined` when none does.
 *
 * @param packument - The abbreviated packument.
 * @param range - The consumer's range.
 * @returns Version.
 */
export function resolveRange(packument: IPackument, range: ICaretRange): string | undefined;

/**
 * The row label of the version a range resolves to.
 *
 * @param range - The range as written.
 * @returns `range <range>`.
 */
export function rangeLabel(range: string): string;

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
 * @param sources - Lockfile version, `testedMinor`, consumer range.
 * @returns Rows in lockfile, next-minor, range order.
 */
export function playwrightCandidates(
  packument: IPackument,
  sources: ICandidateSources,
): IPlaywrightCandidate[];
