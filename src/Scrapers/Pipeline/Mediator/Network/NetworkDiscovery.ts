/**
 * Network Discovery — captures API traffic from browser page.
 * Black box: observes what the page's JavaScript does, stores endpoints.
 * SCRAPE phase can replay discovered patterns with different params.
 *
 * Generic for ALL banks — no bank-specific logic.
 * Captures JSON responses from page.on('response'), ignores HTML/images/fonts.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { IFetchOpts } from '../../Strategy/Fetch/FetchStrategy.js';
import { createFrozenAuthFailureWatcher } from './AuthFailureWatcher.js';
import {
  buildBucketingMethods,
  buildCoreMethods,
  buildEndpointMethods,
  type HeaderMethods,
} from './DiscoveryEngine/DiscoveryEngine.js';
import {
  buildBalUrlFromTraffic,
  buildDashboardClickState,
  buildTxnUrlFromTraffic,
} from './EndpointState/EndpointState.js';
import { ORIGIN_HEADERS, REFERER_HEADERS, SITE_ID_HEADERS } from './Indexing/Indexing.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from './NetworkDiscoveryTypes.js';
import type { FirstIdPredicate } from './Polling/NetworkPolling.js';
import {
  discoverApiOriginFromTraffic,
  discoverHeaderValue,
  discoverShapeAware,
  extractSpaHeaders,
  spaHasAny,
} from './Scoring/Scoring.js';

/**
 * Create a FROZEN INetworkDiscovery from a static endpoint snapshot.
 * All discovery methods operate on the frozen captured array — no live Page.
 * Auth methods return the pre-cached token. Traffic polling returns false.
 * Used by SCRAPE.ACTION to execute without browser access.
 *
 * @param endpoints - Frozen copy of captured endpoints from PRE.
 * @param cachedAuth - Pre-cached auth token from DASHBOARD.
 * @param dashboardClickAt - Click timestamp inherited from the live
 *   network at freeze time. `false` for tests / synthetic frozen
 *   replays — bucketing methods then expose the full pool, which is
 *   the safe default when no nav-click occurred. SCRAPE.PRE callers
 *   should always pass the real value through `IScrapeDiscovery`.
 * @returns Frozen INetworkDiscovery.
 */
function createFrozenNetwork(
  endpoints: readonly IDiscoveredEndpoint[],
  cachedAuth: string | false,
  dashboardClickAt: number | false = false,
): INetworkDiscovery {
  const frozen = [...endpoints];
  const clickState = buildDashboardClickState(dashboardClickAt);
  const bucketing = buildBucketingMethods(frozen, clickState);
  const core = buildCoreMethods(frozen);
  const epMethods = buildEndpointMethods(frozen);
  const frozenHeaders = buildFrozenHeaders(frozen, cachedAuth);
  const urlBuilders = {
    /** @inheritdoc */
    buildTransactionUrl: (accountId: string, startDate: string): string | false =>
      buildTxnUrlFromTraffic(frozen, accountId, startDate),
    /** @inheritdoc */
    buildBalanceUrl: (accountId: string): string | false =>
      buildBalUrlFromTraffic(frozen, accountId),
  };
  const frozenTraffic = {
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
  const apiOrigin = {
    /** @inheritdoc */
    discoverApiOrigin: (): string | false => discoverApiOriginFromTraffic(frozen),
  };
  // Frozen-network has no live Page, so the watcher is a no-op stub.
  const failureGate = { authFailureWatcher: createFrozenAuthFailureWatcher() };
  /**
   * Phase 7f — frozen replay applies the same post-click-first
   * discipline as the live network. The frozen bucketing surface
   * exposes `getPostNavCaptures()` filtered by the `dashboardClickAt`
   * timestamp captured at freeze time; the picker walks that pool
   * first and falls back to the FULL frozen pool when post-click
   * yields nothing. Visacal-class banks recover via the
   * `preClickFallback` tier, just as in the live picker.
   * @returns Discovered txn endpoint or false.
   */
  const discoverTxnFromFrozenPool = (): IDiscoveredEndpoint | false => {
    const postNav = bucketing.getPostNavCaptures();
    return discoverShapeAware(postNav, frozen, PIPELINE_WELL_KNOWN_API.transactions);
  };
  const txnDiscovery = {
    /** @inheritdoc */
    discoverTransactionsEndpoint: discoverTxnFromFrozenPool,
  };
  // Frozen replays have no listener, so the lifecycle gate is a
  // no-op — accepting the call lets callers stay live-vs-frozen
  // agnostic without runtime branching.
  const lifecycle = {
    /** @inheritdoc */
    setCollectionActive: (): true => true,
  };
  const base = { ...core, ...epMethods, ...frozenHeaders, ...urlBuilders };
  return {
    ...base,
    ...bucketing,
    ...lifecycle,
    ...txnDiscovery,
    ...frozenTraffic,
    ...apiOrigin,
    ...failureGate,
  };
}

/**
 * Build frozen header methods — no Page, uses cached auth.
 * @param captured - Frozen endpoints.
 * @param cachedAuth - Pre-cached auth token.
 * @returns Header discovery methods with cached auth.
 */
function buildFrozenHeaders(
  captured: readonly IDiscoveredEndpoint[],
  cachedAuth: string | false,
): HeaderMethods & Pick<INetworkDiscovery, 'cacheAuthToken' | 'buildDiscoveredHeaders'> {
  return {
    /** @inheritdoc */
    discoverAuthToken: (): Promise<string | false> => Promise.resolve(cachedAuth),
    /** @inheritdoc */
    discoverOrigin: (): string | false => discoverHeaderValue(captured, ORIGIN_HEADERS),
    /** @inheritdoc */
    discoverSiteId: (): string | false => discoverHeaderValue(captured, SITE_ID_HEADERS),
    /** @inheritdoc */
    cacheAuthToken: (): Promise<string | false> => Promise.resolve(cachedAuth),
    /** @inheritdoc */
    buildDiscoveredHeaders: (): Promise<IFetchOpts> => {
      // Captured SPA headers are the SINGLE source of truth — see
      // LIVE counterpart for rationale. No hardcoded Content-Type:
      // the captured `content-type` (Hapoalim:
      // `application/json;charset=UTF-8`) and `referer` (full SPA
      // path) survive extractSpaHeaders and replay exactly.
      const spaBase = extractSpaHeaders(captured);
      const extraHeaders: Record<string, string> = { ...spaBase };
      if (cachedAuth) extraHeaders.authorization = cachedAuth;
      const origin = discoverHeaderValue(captured, ORIGIN_HEADERS);
      if (origin) extraHeaders.Origin = origin;
      if (origin && !spaHasAny(spaBase, REFERER_HEADERS)) extraHeaders.Referer = origin;
      const siteId = discoverHeaderValue(captured, SITE_ID_HEADERS);
      if (siteId && !spaHasAny(spaBase, SITE_ID_HEADERS)) extraHeaders['X-Site-Id'] = siteId;
      return Promise.resolve({ extraHeaders });
    },
  };
}

export { distillHeaders } from '../Elements/HeaderDistillation.js';
export { createNetworkDiscovery } from './DiscoveryEngine/DiscoveryEngine.js';
export type {
  IParsedBody,
  IsUnsupportedUrlSignal,
  ShouldRecordResponseSignal,
} from './Indexing/Indexing.js';
export {
  isUnsupportedUrl,
  parseResponse,
  parseTextOrNull,
  shouldRecordResponse,
} from './Indexing/Indexing.js';
export type { IDiscoveredEndpoint, INetworkDiscovery } from './NetworkDiscoveryTypes.js';
export { createFrozenNetwork };
