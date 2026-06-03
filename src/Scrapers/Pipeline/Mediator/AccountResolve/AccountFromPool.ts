/**
 * AccountFromPool — pure account-discovery helper over the captured
 * network pool. Barrel that composes the three responsibility
 * siblings (Types / Picker / Request) into the single import surface
 * consumed by ACCOUNT-RESOLVE.POST.
 *
 * <p>Contract:
 * <ul>
 *   <li>Input: pre-nav captures (`network.getPreNavCaptures()`).</li>
 *   <li>Output: `{ endpoint, ids, records, containers }`.</li>
 * </ul>
 *
 * <p>Two phases, each independent:
 * <ol>
 *   <li>Response body — named container or root-array (handled by the
 *       Picker sibling).</li>
 *   <li>Request data — method-strict: GET → URL, POST → postData
 *       (handled by the Request sibling).</li>
 * </ol>
 */

import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import {
  buildDiscoveryFromEndpoint,
  pickAccountEndpoint,
  poolMaxContainer,
} from './AccountFromPool.Picker.js';
import { discoverAccountFromRequest } from './AccountFromPool.Request.js';
import type { IAccountDiscoveryResult } from './AccountFromPool.Types.js';

/**
 * Pure helper — discovers accounts from the supplied capture pool.
 * Response check first so banks that publish full account metadata
 * keep their rich records. Request-side extraction is the fallback.
 * @param pool - Pre-nav captures from `network.getPreNavCaptures()`.
 * @returns Endpoint pick + extracted ids + records (empties on miss).
 */
function discoverAccountsInPool(pool: readonly IDiscoveredEndpoint[]): IAccountDiscoveryResult {
  const endpoint = pickAccountEndpoint(pool);
  if (endpoint === false) return discoverAccountFromRequest(pool);
  return buildDiscoveryFromEndpoint(endpoint);
}

export type { IAccountDiscoveryResult };
export { discoverAccountsInPool, poolMaxContainer };
