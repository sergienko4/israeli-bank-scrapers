/**
 * Network EndpointState — endpoint URL builders and mutable closure
 * cells (dashboard-click marker, collection on/off gate).
 *
 *   • `FULL_TXN_PARAMS` + `findTxnUrlWithAccountId` +
 *     `buildTxnUrlFromTraffic` + `buildBalUrlFromTraffic` —
 *     reconstruct endpoint URLs from captured traffic, bank-agnostic.
 *   • `IDashboardClickState` + `buildDashboardClickState` — the
 *     click timestamp slot shared between DASHBOARD.ACTION (writer)
 *     and SCRAPE.PRE (reader).
 *   • `ICollectionState` + `buildCollectionState` — the live
 *     recording-gate accessors consulted on every captured response.
 *
 * Extracted from NetworkDiscovery.ts (Phase 4 commit 5/9).
 */

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';

/** WellKnown transaction URL query params for full history. */
const FULL_TXN_PARAMS = [
  'IsCategoryDescCode=True',
  'IsTransactionDetails=True',
  'IsEventNames=True',
  'IsFutureTransactionFlag=True',
];

/**
 * Find the first captured endpoint that BOTH contains the account ID
 * AND matches a WK transactions URL pattern. Filters out unrelated
 * endpoints (e.g. `general/getUserPilotInfo/<accountId>`) that share
 * the account ID by coincidence but are not transaction fetchers —
 * picking such a URL produced malformed reconstructed URLs in the
 * earlier implementation.
 * @param captured - Captured endpoints.
 * @param accountId - Account ID to search for in URLs.
 * @returns First matching txn-pattern endpoint or false.
 */
function findTxnUrlWithAccountId(
  captured: readonly IDiscoveredEndpoint[],
  accountId: string,
): IDiscoveredEndpoint | false {
  const txnPatterns = PIPELINE_WELL_KNOWN_API.transactions;
  const hit = captured.find((ep): boolean => {
    if (!ep.url.includes(accountId)) return false;
    return txnPatterns.some((p): boolean => p.test(ep.url));
  });
  return hit ?? false;
}

/**
 * Build a full transaction URL from a captured txn endpoint that
 * already contains the account ID. Preserves the captured path
 * structure verbatim — everything up to the first occurrence of the
 * accountId becomes the URL prefix, and `<accountId>/Date?<params>`
 * is appended. PURE GENERIC across banks regardless of how many path
 * segments sit between the API root and the account ID. Replaces an
 * earlier greedy `lastTransactions` regex strip that assumed
 * `/lastTransactions/<accountId>` was the canonical shape and lost
 * intermediate path segments such as Discount's new
 * `/lastTransactions/transactions/<accountId>/forHomePage`.
 *
 * @param captured - Captured endpoints.
 * @param accountId - Account number.
 * @param startDate - Formatted start date.
 * @returns Full transaction URL or false.
 */
function buildTxnUrlFromTraffic(
  captured: readonly IDiscoveredEndpoint[],
  accountId: string,
  startDate: string,
): string | false {
  const hit = findTxnUrlWithAccountId(captured, accountId);
  if (!hit) return false;
  const parts = hit.url.split(accountId);
  if (parts.length < 2) return false;
  const prefix = parts[0];
  const params = [...FULL_TXN_PARAMS, `FromDate=${startDate}`].join('&');
  return `${prefix}${accountId}/Date?${params}`;
}

/**
 * Build a balance URL from discovered traffic pattern.
 * @param captured - Captured endpoints.
 * @param accountId - Account number.
 * @returns Balance URL or false.
 */
function buildBalUrlFromTraffic(
  captured: readonly IDiscoveredEndpoint[],
  accountId: string,
): string | false {
  const balanceHits = captured.filter((ep): boolean =>
    PIPELINE_WELL_KNOWN_API.balance.some((p): boolean => p.test(ep.url)),
  );
  if (balanceHits.length === 0) return false;
  const templateUrl = balanceHits[0].url;
  const pathOnly = templateUrl.split('?')[0];
  const segments = pathOnly.split('/');
  const lastSegMaybe = segments.at(-1);
  if (lastSegMaybe === undefined) return false;
  const isAccountInUrl = /^\d{5,}$/.test(lastSegMaybe);
  if (isAccountInUrl) {
    segments[segments.length - 1] = accountId;
    return segments.join('/');
  }
  return `${pathOnly}/${accountId}`;
}

/**
 * Mutable click-at slot — the only piece of state shared between
 * DASHBOARD.ACTION (writes) and DASHBOARD.FINAL / SCRAPE.PRE
 * (reads). Encapsulated in an interface so the closure that owns
 * it can hand the same handle to multiple builders.
 */
interface IDashboardClickState {
  readonly mark: (timestampMs: number) => true;
  readonly read: () => number | false;
}

/**
 * Build the dashboard-click marker + reader pair backed by a single
 * mutable cell. Bank-agnostic — the timestamp is just a number.
 * @param initial - Initial value (false means "no click yet").
 * @returns Mark + read accessors.
 */
function buildDashboardClickState(initial: number | false): IDashboardClickState {
  let value: number | false = initial;
  /**
   * Set the dashboard-click timestamp on the closure cell.
   * @param timestampMs - Click timestamp.
   * @returns True after writing.
   */
  const mark = (timestampMs: number): true => {
    value = timestampMs;
    return true;
  };
  /**
   * Read the dashboard-click timestamp from the closure cell.
   * @returns Click timestamp or false when not yet set.
   */
  const read = (): number | false => value;
  return { mark, read };
}

/**
 * Mutable state pair for the live recording gate — the writer
 * (`flip`) is what the lifecycle interceptor calls between phases;
 * the reader (`read`) is consulted on every captured response so the
 * page listener can short-circuit during pre-auth phases without
 * tearing the listener down.
 */
interface ICollectionState {
  readonly flip: (active: boolean) => true;
  readonly read: () => boolean;
}

/**
 * Build the recording-gate accessors backed by a single mutable cell.
 * Default `true` preserves legacy behaviour for any caller that never
 * gates the network (API-direct banks, tests).
 * @param initial - Initial recording state.
 * @returns Flip + read accessors.
 */
function buildCollectionState(initial: boolean): ICollectionState {
  let isActive = initial;
  /**
   * Apply the recording state to the closure cell.
   * @param active - True to record captures.
   * @returns True after writing.
   */
  const flip = (active: boolean): true => {
    isActive = active;
    return true;
  };
  /**
   * Read the recording state from the closure cell.
   * @returns True when captures should be stored.
   */
  const read = (): boolean => isActive;
  return { flip, read };
}

export {
  buildBalUrlFromTraffic,
  buildCollectionState,
  buildDashboardClickState,
  buildTxnUrlFromTraffic,
};
export type { ICollectionState, IDashboardClickState };
