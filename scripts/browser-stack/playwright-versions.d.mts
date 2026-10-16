/**
 * Type declarations for `scripts/browser-stack/playwright-versions.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that drive it need this to type their fixtures rather than import `any`.
 */

import type { IFetchIo } from './gate.mjs';

/** The fields of the abbreviated packument the watch reads; `fetchPackument` checks both. */
export interface IPackument {
  /** `latest` is a key of `versions`. */
  readonly 'dist-tags': { readonly latest: string };
  readonly versions: Readonly<Record<string, unknown>>;
}

/** A caret range on a stable version: `^1.62.0` is >=1.62.0 <2.0.0. */
export interface ICaretRange {
  readonly text: string;
  /** Inclusive lower bound, `[major, minor, patch]`. */
  readonly low: readonly number[];
  /** Exclusive upper bound, `[major, minor, patch]`. */
  readonly high: readonly number[];
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
 * @throws {FetchFailedError} When it cannot be read, or is not a packument.
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
