/**
 * AccountResolveActions.Classify — POST classification + helpers.
 * Extracted from the AccountResolveActions barrel so the per-file LoC
 * cap is honoured (phase-2e-residue split).
 */

import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import type { discoverAccountsInPool } from './AccountFromPool.js';
import { poolMaxContainer } from './AccountFromPool.js';

/** Discriminated outcome of the POST validation pass. */
type ResolveClassification =
  | { readonly kind: 'skip' }
  | { readonly kind: 'failEmpty'; readonly poolSize: number }
  | {
      readonly kind: 'failIncomplete';
      readonly resolved: number;
      readonly expected: number;
      readonly containers: Readonly<Record<string, readonly Record<string, unknown>[]>>;
    }
  | {
      readonly kind: 'commit';
      readonly pool: readonly IDiscoveredEndpoint[];
      readonly result: ReturnType<typeof discoverAccountsInPool>;
    };

/**
 * Build the `failIncomplete` classification carrying the picker shortfall counts.
 * @param result - Resolution outcome from `discoverAccountsInPool`.
 * @param expected - Maximum container size across the capture pool.
 * @returns `failIncomplete` classification ready for the dispatcher.
 */
function buildFailIncompleteClassification(
  result: ReturnType<typeof discoverAccountsInPool>,
  expected: number,
): ResolveClassification {
  const { ids, containers } = result;
  return { kind: 'failIncomplete', resolved: ids.length, expected, containers };
}

/**
 * Classify the `discoverAccountsInPool` outcome into a tagged union.
 * @param pool - Pre-nav capture pool (drives catalog detection).
 * @param result - Resolution outcome from `discoverAccountsInPool`.
 * @returns Discriminated classification used by the dispatcher.
 */
function classifyAccountResolveResult(
  pool: readonly IDiscoveredEndpoint[],
  result: ReturnType<typeof discoverAccountsInPool>,
): ResolveClassification {
  if (result.ids.length === 0) return { kind: 'failEmpty', poolSize: pool.length };
  const expected = poolMaxContainer(pool);
  if (result.ids.length < expected) return buildFailIncompleteClassification(result, expected);
  return { kind: 'commit', pool, result };
}

/**
 * Surface the captureIndex of the picker's chosen endpoint, with `0`
 * as the sentinel when no endpoint was picked.
 * @param endpoint - Picker output (endpoint or false).
 * @returns Capture index, or 0 sentinel.
 */
function resolveCaptureIndex(
  endpoint: ReturnType<typeof discoverAccountsInPool>['endpoint'],
): number {
  if (endpoint === false) return 0;
  return endpoint.captureIndex ?? 0;
}

export type { ResolveClassification };
export { classifyAccountResolveResult, resolveCaptureIndex };
