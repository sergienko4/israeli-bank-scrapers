/**
 * AccountFromPool.Types — discovery shape + empty-sentinel extracted
 * from the AccountFromPool barrel so the per-file LoC cap is honoured
 * (phase-2e-residue).
 */

import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';

/**
 * Result of the pool-walker discovery.
 *
 * <ul>
 *   <li>`endpoint` is `false` when no capture in the pool exposed an
 *       account container.</li>
 *   <li>`ids` and `records` are populated when the picker found a
 *       body container OR the request-side fallback fired.</li>
 *   <li>`containers` holds the per-WK-name split when the picked
 *       endpoint exposes named containers; empty otherwise.</li>
 * </ul>
 */
interface IAccountDiscoveryResult {
  readonly endpoint: IDiscoveredEndpoint | false;
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
  readonly containers: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}

/** Empty discovery sentinel — shared so callers stay allocation-free. */
const EMPTY_DISCOVERY: IAccountDiscoveryResult = {
  endpoint: false,
  ids: [],
  records: [],
  containers: {},
};

export type { IAccountDiscoveryResult };
export { EMPTY_DISCOVERY };
