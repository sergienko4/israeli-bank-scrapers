/**
 * Network FrozenReplay — synthesises an INetworkDiscovery from a
 * static endpoint snapshot. SCRAPE.ACTION uses this to replay the
 * captured pool without holding a Playwright `Page` open: discovery
 * methods walk the frozen array, auth methods return the pre-cached
 * token, traffic polling is a no-op, and the lifecycle gate accepts
 * calls so callers can stay live-vs-frozen agnostic.
 *
 * PR #276 review: header building now delegates to the shared
 * `buildDiscoveredHeadersFromCapture` so the LIVE and FROZEN code
 * paths cannot drift apart (CR #5). Per-function bodies fit the
 * Section 11 20-LoC cap via dedicated builders.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import type { IFetchOpts } from '../../../Strategy/Fetch/FetchStrategy.js';
import { createFrozenAuthFailureWatcher } from '../AuthFailureWatcher.js';
import {
  buildBucketingMethods,
  buildCoreMethods,
  buildEndpointMethods,
  type HeaderMethods,
} from '../DiscoveryEngine/DiscoveryEngine.js';
import buildDiscoveredHeadersFromCapture from '../DiscoveryHeaders/DiscoveryHeaders.js';
import {
  buildBalUrlFromTraffic,
  buildDashboardClickState,
  buildTxnUrlFromTraffic,
} from '../EndpointState/EndpointState.js';
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
 * Stubbed traffic waiters — `waitForFirstId` is the only working one.
 * @param frozen - Frozen captured endpoints (used by waitForFirstId).
 * @returns Traffic-waiter method bundle (no-op except waitForFirstId).
 */
function buildFrozenTraffic(
  frozen: readonly IDiscoveredEndpoint[],
): Pick<INetworkDiscovery, 'waitForTraffic' | 'waitForTransactionsTraffic' | 'waitForFirstId'> {
  return {
    /** @inheritdoc */
    waitForTraffic: (): Promise<IDiscoveredEndpoint | false> => Promise.resolve(false),
    /** @inheritdoc */
    waitForTransactionsTraffic: (): Promise<IDiscoveredEndpoint | false> => Promise.resolve(false),
    /** @inheritdoc */
    waitForFirstId: (
      _timeoutMs: number,
      predicate: FirstIdPredicate,
    ): Promise<IDiscoveredEndpoint | false> => {
      const hit = predicate(frozen);
      return Promise.resolve(hit);
    },
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
    /** @inheritdoc */
    discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false => {
      const postNav = getPostNavCaptures();
      return discoverShapeAware(postNav, frozen, PIPELINE_WELL_KNOWN_API.transactions);
    },
  };
}

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
): HeaderMethods & Pick<INetworkDiscovery, 'cacheAuthToken' | 'buildDiscoveredHeaders'> {
  /**
   * Wrap the cached token in a resolved Promise.
   * @returns Promise resolving to the cached token (or false).
   */
  const cached = (): Promise<string | false> => Promise.resolve(cachedAuth);
  return {
    /** @inheritdoc */
    discoverAuthToken: cached,
    /** @inheritdoc */
    discoverOrigin: (): string | false => discoverHeaderValue(captured, ORIGIN_HEADERS),
    /** @inheritdoc */
    discoverSiteId: (): string | false => discoverHeaderValue(captured, SITE_ID_HEADERS),
    /** @inheritdoc */
    cacheAuthToken: cached,
    /** @inheritdoc */
    buildDiscoveredHeaders: (): Promise<IFetchOpts> => {
      const headers = buildDiscoveredHeadersFromCapture(captured, cachedAuth);
      return Promise.resolve(headers);
    },
  };
}

/** Frozen replays have no listener — the lifecycle gate is a no-op. */
const FROZEN_LIFECYCLE = {
  /** @inheritdoc */
  setCollectionActive: (): true => true,
} as const;

/**
 * Create a FROZEN INetworkDiscovery from a static endpoint snapshot.
 * All discovery methods operate on the frozen captured array — no
 * live Page. Auth methods return the pre-cached token. Traffic
 * polling returns false. Used by SCRAPE.ACTION to execute without
 * browser access.
 *
 * @param endpoints - Frozen copy of captured endpoints from PRE.
 * @param cachedAuth - Pre-cached auth token from DASHBOARD.
 * @param dashboardClickAt - Click timestamp inherited from the live
 *   network at freeze time. `false` for tests / synthetic frozen
 *   replays — bucketing methods then expose the full pool, which is
 *   the safe default when no nav-click occurred.
 * @returns Frozen INetworkDiscovery.
 */
/** Aggregated frozen bundle keyed by INetworkDiscovery slice. */
interface IFrozenBundle {
  readonly core: ReturnType<typeof buildCoreMethods>;
  readonly epMethods: ReturnType<typeof buildEndpointMethods>;
  readonly headers: ReturnType<typeof buildFrozenHeaders>;
  readonly urlBuilders: ReturnType<typeof buildFrozenUrlBuilders>;
  readonly bucketing: ReturnType<typeof buildBucketingMethods>;
  readonly traffic: ReturnType<typeof buildFrozenTraffic>;
  readonly apiOrigin: ReturnType<typeof buildFrozenApiOrigin>;
  readonly txnDiscovery: ReturnType<typeof buildFrozenTxnDiscovery>;
}

/**
 * Build every frozen method bundle. Split out of
 * `createFrozenNetwork` so each function stays under the Section 11
 * per-function 20-LoC cap.
 * @param frozen - Frozen endpoints array.
 * @param cachedAuth - Pre-cached auth token.
 * @param dashboardClickAt - Click timestamp inherited from live freeze.
 * @returns Aggregated bundle ready to be spread.
 */
function buildFrozenBundle(
  frozen: IDiscoveredEndpoint[],
  cachedAuth: string | false,
  dashboardClickAt: number | false,
): IFrozenBundle {
  const clickState = buildDashboardClickState(dashboardClickAt);
  const bucketing = buildBucketingMethods(frozen, clickState);
  const core = buildCoreMethods(frozen);
  const epMethods = buildEndpointMethods(frozen);
  const headers = buildFrozenHeaders(frozen, cachedAuth);
  const urlBuilders = buildFrozenUrlBuilders(frozen);
  const traffic = buildFrozenTraffic(frozen);
  const apiOrigin = buildFrozenApiOrigin(frozen);
  const txnDiscovery = buildFrozenTxnDiscovery(frozen, bucketing.getPostNavCaptures);
  return { core, epMethods, headers, urlBuilders, bucketing, traffic, apiOrigin, txnDiscovery };
}

/**
 * Synthesise an INetworkDiscovery from a captured endpoints snapshot.
 *
 * All discovery methods operate on the frozen captured array — no
 * live Page. Auth methods return the pre-cached token. Traffic
 * polling returns false. Used by SCRAPE.ACTION to execute without
 * browser access.
 *
 * @param endpoints - Frozen copy of captured endpoints from PRE.
 * @param cachedAuth - Pre-cached auth token from DASHBOARD.
 * @param dashboardClickAt - Click timestamp inherited from the live
 *   network at freeze time. `false` for tests / synthetic frozen
 *   replays — bucketing methods then expose the full pool.
 * @returns Frozen INetworkDiscovery.
 */
function createFrozenNetwork(
  endpoints: readonly IDiscoveredEndpoint[],
  cachedAuth: string | false,
  dashboardClickAt: number | false = false,
): INetworkDiscovery {
  const frozen = [...endpoints];
  const b = buildFrozenBundle(frozen, cachedAuth, dashboardClickAt);
  return {
    ...b.core,
    ...b.epMethods,
    ...b.headers,
    ...b.urlBuilders,
    ...b.bucketing,
    ...FROZEN_LIFECYCLE,
    ...b.txnDiscovery,
    ...b.traffic,
    ...b.apiOrigin,
    authFailureWatcher: createFrozenAuthFailureWatcher(),
  };
}

export default createFrozenNetwork;
