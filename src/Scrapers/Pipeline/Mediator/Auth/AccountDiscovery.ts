/**
 * Account discovery — owned by the auth FINAL stage (LOGIN.FINAL for
 * non-OTP banks, OTP-FILL.FINAL for OTP banks). Operates on the
 * caller-supplied pool (always `getPreNavCaptures()`), so the
 * boundary between auth-side concerns and dashboard/scrape concerns
 * stays bright.
 *
 * Contract:
 * - Input is a list of captures the auth phase saw before any
 *   dashboard navigation click.
 * - Output is `{ endpoint, ids, records }`. `endpoint` is the capture
 *   we picked as the account source (kept for diagnostic logging);
 *   `ids` and `records` are populated via `extractAccountIds` /
 *   `extractAccountRecords` so SCRAPE.PRE consumes a stable shape
 *   regardless of which bank produced the data.
 *
 * Why a separate helper (not a method on `INetworkDiscovery`):
 * - The network surface stays a black box that returns raw captures.
 *   Account-extraction is a domain concern owned by the auth phase,
 *   not by the network primitive.
 * - Reused identically by `LoginSignalProbe` (LOGIN.FINAL) and
 *   `OtpFillPhaseActions.executeFillFinal` (OTP-FILL.FINAL).
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK_TXN } from '../../Registry/WK/ScrapeWK.js';
import type { ApiPayload } from '../../Strategy/Scrape/ScrapeTypes.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import {
  extractAccountIds,
  extractAccountRecords,
  findContainerArray,
  findFieldValue,
} from '../Scrape/ScrapeAutoMapper.js';

/**
 * Result of `discoverAccountsInPool`. `endpoint` is `false` when no
 * capture in the pool exposed an account container; `ids` and
 * `records` are then empty.
 */
interface IAccountDiscoveryResult {
  readonly endpoint: IDiscoveredEndpoint | false;
  readonly ids: readonly string[];
  readonly records: readonly Record<string, unknown>[];
}

/**
 * Returns true when the capture's response body holds a non-empty
 * `WK.accountContainers` array (`cardsList` / `cards` / `accounts` /
 * `bankAccounts`). Pure check, no extraction.
 * @param ep - Captured endpoint.
 * @returns True iff the body holds a named account container.
 */
function hasNamedContainer(ep: IDiscoveredEndpoint): boolean {
  const body = ep.responseBody;
  if (body === null) return false;
  if (typeof body !== 'object') return false;
  const records = findContainerArray(body as ApiPayload, [...WK_TXN.accountContainers]);
  return records.length > 0;
}

/**
 * Returns true when the FIRST element of a root-level array exposes
 * an account-id field (one of `WK_TXN.accountId`). Used as a strict
 * shape check for the Hapoalim `[{accountNumber,bankNumber,…}]`
 * pattern — DELIBERATELY ignores the loose `findFirstArray` tier so
 * a `{ transactions: [...] }` capture is NOT mistaken for an account
 * list.
 * @param ep - Captured endpoint.
 * @returns True iff body is a non-empty root array of account-shaped
 *   records.
 */
function hasRootAccountArray(ep: IDiscoveredEndpoint): boolean {
  const body = ep.responseBody;
  if (!Array.isArray(body)) return false;
  const arr = body as readonly unknown[];
  if (arr.length === 0) return false;
  const first = arr[0];
  if (first === null || typeof first !== 'object') return false;
  const fields = [...WK_TXN.accountId];
  const hit = findFieldValue(first as Record<string, unknown>, fields);
  return hit !== false;
}

/**
 * Pick the first capture whose response body exposes account-shaped
 * records — preferring named containers (tier 1) over the root-array
 * fallback (tier 3). The 2-pass walk preserves ordering: named
 * containers always win when both exist in the same pool.
 * @param pool - Pre-nav captures supplied by the auth FINAL.
 * @returns First matching endpoint, or false.
 */
function pickAccountEndpoint(pool: readonly IDiscoveredEndpoint[]): IDiscoveredEndpoint | false {
  const named = pool.find(hasNamedContainer);
  if (named) return named;
  const rootShape = pool.find(hasRootAccountArray);
  return rootShape ?? false;
}

/**
 * Pure helper — discovers accounts from the supplied capture pool.
 * No network I/O, no global pool access; the auth FINAL passes the
 * pre-nav bucket and gets back a stable result that SCRAPE.PRE can
 * consume directly.
 * @param pool - Pre-nav captures from `network.getPreNavCaptures()`.
 * @returns Endpoint pick + extracted ids + records (empties on miss).
 */
function discoverAccountsInPool(pool: readonly IDiscoveredEndpoint[]): IAccountDiscoveryResult {
  const endpoint = pickAccountEndpoint(pool);
  if (endpoint === false) return { endpoint: false, ids: [], records: [] };
  const body = endpoint.responseBody as ApiPayload;
  const ids = extractAccountIds(body);
  const records = extractAccountRecords(body);
  return { endpoint, ids: [...ids], records: [...records] };
}

export type { IAccountDiscoveryResult };
export { discoverAccountsInPool };
