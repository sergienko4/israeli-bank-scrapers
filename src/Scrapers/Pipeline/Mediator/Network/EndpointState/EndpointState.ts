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

/** Minimum parts produced when splitting a captured URL on its account-id segment. */
const MIN_SPLIT_PARTS = 2;

/** WellKnown transaction URL query params for full history. */
const FULL_TXN_PARAMS = [
  'IsCategoryDescCode=True',
  'IsTransactionDetails=True',
  'IsEventNames=True',
  'IsFutureTransactionFlag=True',
];

/**
 * CodeRabbit PR #276 #4 — account-ID detection regex. Numeric path
 * segments of 5+ digits are treated as the account-id slot in
 * balance URLs (e.g. `/.../balance/123456789`), to be substituted
 * with the caller-supplied account number.
 */
const ACCOUNT_ID_SEGMENT_PATTERN = /^\d{5,}$/;

/**
 * Match a captured endpoint against an account-id-plus-txn-pattern.
 * @param accountId - Account ID to match in URL.
 * @param txnPatterns - WK transactions URL patterns.
 * @param ep - Captured endpoint to test.
 * @returns True when both the account ID and a txn pattern match.
 */
function txnUrlPredicate(
  accountId: string,
  txnPatterns: readonly RegExp[],
  ep: IDiscoveredEndpoint,
): boolean {
  if (!ep.url.includes(accountId)) return false;
  return txnPatterns.some((p): boolean => p.test(ep.url));
}

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
  const predicate = txnUrlPredicate.bind(null, accountId, txnPatterns);
  const hit = captured.find(predicate);
  return hit ?? false;
}

/**
 * Stitch a full transaction URL from a captured hit's URL prefix.
 * @param hitUrl - Captured endpoint URL containing the account ID.
 * @param accountId - Account number used as the split anchor.
 * @param startDate - Formatted start date.
 * @returns Assembled txn URL or false when the split has no prefix.
 */
function assembleTxnUrl(hitUrl: string, accountId: string, startDate: string): string | false {
  const parts = hitUrl.split(accountId);
  if (parts.length < MIN_SPLIT_PARTS) return false;
  const prefix = parts[0];
  const params = [...FULL_TXN_PARAMS, `FromDate=${startDate}`].join('&');
  return `${prefix}${accountId}/Date?${params}`;
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
  return assembleTxnUrl(hit.url, accountId, startDate);
}

/**
 * Find the first captured endpoint matching a WK balance pattern.
 * @param captured - Captured endpoints.
 * @returns First balance-URL hit or false.
 */
function findBalanceHit(captured: readonly IDiscoveredEndpoint[]): IDiscoveredEndpoint | false {
  const hit = captured.find((ep): boolean =>
    PIPELINE_WELL_KNOWN_API.balance.some((p): boolean => p.test(ep.url)),
  );
  return hit ?? false;
}

/**
 * Substitute the caller-supplied account ID into the captured
 * balance-URL path. When the final path segment is a numeric
 * account-id slot (5+ digits), replace it; otherwise append.
 * @param pathOnly - Captured balance URL minus any query string.
 * @param accountId - Account ID to substitute.
 * @returns Final balance URL.
 */
function substituteAccountInPath(pathOnly: string, accountId: string): string {
  const segments = pathOnly.split('/');
  const lastSegMaybe = segments.at(-1);
  if (lastSegMaybe !== undefined && ACCOUNT_ID_SEGMENT_PATTERN.test(lastSegMaybe)) {
    segments[segments.length - 1] = accountId;
    return segments.join('/');
  }
  return `${pathOnly}/${accountId}`;
}

/**
 * Split a URL into path and query parts. Preserves the leading '?' on
 * the query so callers can re-concatenate without further branching.
 * @param url - Full URL to split.
 * @returns `{ path, query }` — query is the empty string when absent.
 */
function splitUrlAtQuery(url: string): { path: string; query: string } {
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return { path: url, query: '' };
  return { path: url.slice(0, qIdx), query: url.slice(qIdx) };
}

/**
 * Build a balance URL from discovered traffic pattern. Preserves any
 * query string after the account-id substitution (CR PR #280 #123 fix).
 * @param captured - Captured endpoints.
 * @param accountId - Account number.
 * @returns Balance URL or false.
 */
function buildBalUrlFromTraffic(
  captured: readonly IDiscoveredEndpoint[],
  accountId: string,
): string | false {
  const hit = findBalanceHit(captured);
  if (!hit) return false;
  const { path, query } = splitUrlAtQuery(hit.url);
  return `${substituteAccountInPath(path, accountId)}${query}`;
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
