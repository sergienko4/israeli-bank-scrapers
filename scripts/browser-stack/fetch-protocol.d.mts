/**
 * Type declarations for `scripts/browser-stack/fetch-protocol.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that drive it need this to type its policy and results rather than import `any`.
 */

import type { IFetchIo } from './gate.mjs';

/** Where a fetch may go, how much it may read, and what it sends. */
export interface IFetchPolicy {
  readonly hosts: readonly string[];
  readonly maxBodyBytes: number;
  readonly headers: Readonly<Record<string, string>>;
}

/** A fetched body and the sha256 of its bytes. */
export interface IFetchedBody {
  readonly text: string;
  readonly sha256: string;
}

/** The only host the gate's policy reaches. */
export const ALLOWED_HOST: string;

/** The gate policy's body cap. */
export const MAX_BODY_BYTES: number;

/** A fetch that cannot yield a trustworthy body. */
export class FetchFailedError extends Error {
  public readonly status: number;
  public constructor(url: string, reason: string, status?: number);
}

/**
 * Fetch one body under `policy`.
 *
 * @param href - Absolute HTTPS URL on a policy host.
 * @param policy - Reachable hosts, body cap and request headers.
 * @param overrides - Test I/O.
 * @returns The body and its sha256.
 * @throws {FetchFailedError} When no attempt yields a body.
 */
export function fetchBounded(
  href: string,
  policy: IFetchPolicy,
  overrides?: IFetchIo,
): Promise<IFetchedBody>;

/**
 * Fetch one schema under the gate's policy.
 *
 * @param href - Absolute URL on {@link ALLOWED_HOST}.
 * @param overrides - Test I/O.
 * @returns The body and its sha256.
 * @throws {FetchFailedError} When no attempt yields a body.
 */
export function fetchProtocol(href: string, overrides?: IFetchIo): Promise<IFetchedBody>;
