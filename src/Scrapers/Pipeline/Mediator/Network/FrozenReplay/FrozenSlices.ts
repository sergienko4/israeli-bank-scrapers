/**
 * Network FrozenReplay / slice builders — synthesises each
 * INetworkDiscovery slice from a static endpoint snapshot. Split out
 * of `FrozenReplay.ts` per Phase 8.5a commit 5 to keep the host file
 * under the Section 11 150-LoC cap.
 *
 *   • URL builders (txn / balance)
 *   • Traffic waiters (no-op pair + first-id predicate)
 *   • API-origin discovery
 *   • Txn-discovery (post-click-first, same as live)
 *   • Header bundle (auth half + header half)
 *
 * Each helper is intentionally tiny — the per-function cap is 10
 * effective LoC. Compose them in {@link ./FrozenReplay.js}.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import type { IFetchOpts } from '../../../Strategy/Fetch/FetchStrategy.js';
import { type HeaderMethods } from '../DiscoveryEngine/DiscoveryEngine.js';
import buildDiscoveredHeadersFromCapture from '../DiscoveryHeaders/DiscoveryHeaders.js';
import { buildBalUrlFromTraffic, buildTxnUrlFromTraffic } from '../EndpointState/EndpointState.js';
import { ORIGIN_HEADERS, SITE_ID_HEADERS } from '../Indexing/Indexing.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../NetworkDiscoveryTypes.js';
import type { FirstIdPredicate } from '../Polling/NetworkPolling.js';
import {
  discoverApiOriginFromTraffic,
  discoverHeaderValue,
  discoverShapeAware,
} from '../Scoring/Scoring.js';

/**
 * Build the txn / balance URL builders for the frozen pool.
 * @param frozen - Frozen captured endpoints.
 * @returns URL-builder method bundle.
 */
function buildFrozenUrlBuilders(
  frozen: readonly IDiscoveredEndpoint[],
): Pick<INetworkDiscovery, 'buildTransactionUrl' | 'buildBalanceUrl'> {
  return {
    /** @inheritdoc */
    buildTransactionUrl: (accountId: string, startDate: string): string | false =>
      buildTxnUrlFromTraffic(frozen, accountId, startDate),
    /** @inheritdoc */
    buildBalanceUrl: (accountId: string): string | false =>
      buildBalUrlFromTraffic(frozen, accountId),
  };
}

/**
 * Stubbed waiter that resolves immediately to `false`. Used as
 * `waitForTraffic` / `waitForTransactionsTraffic` in frozen replays
 * where there is no live `Page` to listen on.
 * @returns Promise resolving to `false`.
 */
function frozenWaitNoop(): Promise<IDiscoveredEndpoint | false> {
  return Promise.resolve(false);
}

/**
 * Apply the caller predicate to the frozen pool and resolve with
 * the first match (or false). Bound by {@link buildFrozenTraffic}.
 * @param frozen - Frozen captured endpoints.
 * @param _timeoutMs - Ignored (no live page to await).
 * @param predicate - First-id predicate from the caller.
 * @returns Promise resolving to predicate hit or false.
 */
function frozenWaitFirstId(
  frozen: readonly IDiscoveredEndpoint[],
  _timeoutMs: number,
  predicate: FirstIdPredicate,
): Promise<IDiscoveredEndpoint | false> {
  const hit = predicate(frozen);
  return Promise.resolve(hit);
}

/** Traffic waiter slice keys exposed by frozen replays. */
type FrozenTrafficSlice = Pick<
  INetworkDiscovery,
  'waitForTraffic' | 'waitForTransactionsTraffic' | 'waitForFirstId'
>;

/**
 * Stubbed traffic waiters — `waitForFirstId` is the only working one.
 * @param frozen - Frozen captured endpoints (used by waitForFirstId).
 * @returns Traffic-waiter method bundle (no-op except waitForFirstId).
 */
function buildFrozenTraffic(frozen: readonly IDiscoveredEndpoint[]): FrozenTrafficSlice {
  return {
    waitForTraffic: frozenWaitNoop,
    waitForTransactionsTraffic: frozenWaitNoop,
    waitForFirstId: frozenWaitFirstId.bind(null, frozen),
  };
}

/**
 * Build the api-origin discovery for the frozen pool.
 * @param frozen - Frozen captured endpoints.
 * @returns Discovery method returning the discovered API origin.
 */
function buildFrozenApiOrigin(
  frozen: readonly IDiscoveredEndpoint[],
): Pick<INetworkDiscovery, 'discoverApiOrigin'> {
  return {
    /** @inheritdoc */
    discoverApiOrigin: (): string | false => discoverApiOriginFromTraffic(frozen),
  };
}

/**
 * Run the txn shape-aware discovery against the frozen post-nav and
 * fall-back pools. Bound by {@link buildFrozenTxnDiscovery}.
 * @param frozen - Frozen pool (fall-back side).
 * @param getPostNavCaptures - Lazy accessor for the post-click pool.
 * @returns Discovered txn endpoint or false.
 */
function frozenDiscoverTxn(
  frozen: readonly IDiscoveredEndpoint[],
  getPostNavCaptures: () => readonly IDiscoveredEndpoint[],
): IDiscoveredEndpoint | false {
  const postNav = getPostNavCaptures();
  return discoverShapeAware(postNav, frozen, PIPELINE_WELL_KNOWN_API.transactions);
}

/**
 * Phase 7f — frozen replay applies the same post-click-first
 * discipline as the live network.
 * @param frozen - Frozen captured endpoints (fall-back side).
 * @param getPostNavCaptures - Lazy accessor for the post-click pool.
 * @returns Txn discovery method bundle.
 */
function buildFrozenTxnDiscovery(
  frozen: readonly IDiscoveredEndpoint[],
  getPostNavCaptures: () => readonly IDiscoveredEndpoint[],
): Pick<INetworkDiscovery, 'discoverTransactionsEndpoint'> {
  return {
    discoverTransactionsEndpoint: frozenDiscoverTxn.bind(null, frozen, getPostNavCaptures),
  };
}

/**
 * Resolve the cached auth token (bound by {@link buildFrozenHeaders}).
 * @param cachedAuth - Pre-cached auth token (or false).
 * @returns Promise resolving to the cached token.
 */
function frozenCachedToken(cachedAuth: string | false): Promise<string | false> {
  return Promise.resolve(cachedAuth);
}

/**
 * Discover the Origin header value from the frozen pool.
 * @param captured - Frozen endpoints.
 * @returns Discovered Origin or false.
 */
function frozenDiscoverOrigin(captured: readonly IDiscoveredEndpoint[]): string | false {
  return discoverHeaderValue(captured, ORIGIN_HEADERS);
}

/**
 * Discover the X-Site-Id header value from the frozen pool.
 * @param captured - Frozen endpoints.
 * @returns Discovered X-Site-Id or false.
 */
function frozenDiscoverSiteId(captured: readonly IDiscoveredEndpoint[]): string | false {
  return discoverHeaderValue(captured, SITE_ID_HEADERS);
}

/**
 * Build the discovered-headers fetch options from the frozen pool +
 * pre-cached auth, delegating to the shared LIVE builder so the two
 * paths cannot drift.
 * @param captured - Frozen endpoints.
 * @param cachedAuth - Pre-cached auth token.
 * @returns Promise resolving to fetch options.
 */
function frozenBuildDiscoveredHeaders(
  captured: readonly IDiscoveredEndpoint[],
  cachedAuth: string | false,
): Promise<IFetchOpts> {
  const headers = buildDiscoveredHeadersFromCapture(captured, cachedAuth);
  return Promise.resolve(headers);
}

/** Auth half of the frozen header bundle. */
type FrozenAuthSlice = Pick<INetworkDiscovery, 'discoverAuthToken' | 'cacheAuthToken'>;

/**
 * Build the auth half (discoverAuthToken + cacheAuthToken) of the
 * frozen header bundle. Both methods resolve to the pre-cached token.
 * @param cachedAuth - Pre-cached auth token.
 * @returns Auth slice with shared resolver.
 */
function buildFrozenAuthSlice(cachedAuth: string | false): FrozenAuthSlice {
  const cached = frozenCachedToken.bind(null, cachedAuth);
  return { discoverAuthToken: cached, cacheAuthToken: cached };
}

/** Header half of the frozen header bundle. */
type FrozenHeaderSlice = Pick<HeaderMethods, 'discoverOrigin' | 'discoverSiteId'> &
  Pick<INetworkDiscovery, 'buildDiscoveredHeaders'>;

/**
 * Build the header half (discoverOrigin/SiteId + buildDiscoveredHeaders)
 * of the frozen header bundle.
 * @param captured - Frozen endpoints.
 * @param cachedAuth - Pre-cached auth token.
 * @returns Header slice with bound discovery + assembly methods.
 */
function buildFrozenHeaderSlice(
  captured: readonly IDiscoveredEndpoint[],
  cachedAuth: string | false,
): FrozenHeaderSlice {
  return {
    discoverOrigin: frozenDiscoverOrigin.bind(null, captured),
    discoverSiteId: frozenDiscoverSiteId.bind(null, captured),
    buildDiscoveredHeaders: frozenBuildDiscoveredHeaders.bind(null, captured, cachedAuth),
  };
}

/** Combined header bundle exposed to the live INetworkDiscovery shape. */
type FrozenHeaderBundle = HeaderMethods &
  Pick<INetworkDiscovery, 'cacheAuthToken' | 'buildDiscoveredHeaders'>;

/**
 * Build frozen header methods — no Page, uses cached auth. The actual
 * `buildDiscoveredHeaders` body delegates to the shared
 * `buildDiscoveredHeadersFromCapture` so the LIVE and FROZEN headers
 * cannot drift apart (CR PR #276 #5).
 *
 * @param captured - Frozen endpoints.
 * @param cachedAuth - Pre-cached auth token.
 * @returns Header discovery methods with cached auth.
 */
function buildFrozenHeaders(
  captured: readonly IDiscoveredEndpoint[],
  cachedAuth: string | false,
): FrozenHeaderBundle {
  const auth = buildFrozenAuthSlice(cachedAuth);
  const header = buildFrozenHeaderSlice(captured, cachedAuth);
  return { ...auth, ...header };
}

export type { FrozenHeaderBundle, FrozenTrafficSlice };
export {
  buildFrozenApiOrigin,
  buildFrozenHeaders,
  buildFrozenTraffic,
  buildFrozenTxnDiscovery,
  buildFrozenUrlBuilders,
};
