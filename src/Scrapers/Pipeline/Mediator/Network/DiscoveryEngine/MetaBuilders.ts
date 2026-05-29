/**
 * DiscoveryEngine / MetaBuilders — Origin / X-Site-Id discovery, URL
 * builders, traffic waiters, post-click txn picker, and api-origin
 * lookup. Extracted from `DiscoveryEngine.ts` per PR #276 review-fix
 * so the composer fits the Section 11 150 eff-LoC file cap.
 */

import type { Page } from 'playwright-core';

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import { buildBalUrlFromTraffic, buildTxnUrlFromTraffic } from '../EndpointState/EndpointState.js';
import { ORIGIN_HEADERS, SITE_ID_HEADERS } from '../Indexing/Indexing.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../NetworkDiscoveryTypes.js';
import { awaitFirstId, awaitTraffic, type FirstIdPredicate } from '../Polling/NetworkPolling.js';
import {
  discoverApiOriginFromTraffic,
  discoverHeaderValue,
  discoverShapeAware,
} from '../Scoring/Scoring.js';

/**
 * Build the Origin / X-Site-Id discovery pair.
 * @param captured - Captured endpoint pool.
 * @returns Discovery methods returning the header value or false.
 */
function buildOriginDiscoverMethods(
  captured: readonly IDiscoveredEndpoint[],
): Pick<INetworkDiscovery, 'discoverOrigin' | 'discoverSiteId'> {
  return {
    /** @inheritdoc */
    discoverOrigin: (): string | false => discoverHeaderValue(captured, ORIGIN_HEADERS),
    /** @inheritdoc */
    discoverSiteId: (): string | false => discoverHeaderValue(captured, SITE_ID_HEADERS),
  };
}

/**
 * Build the URL builders that synthesise txn / balance URLs from
 * captured traffic.
 * @param captured - Captured endpoint pool.
 * @returns URL-builder methods for txn + balance URLs.
 */
function buildUrlBuilders(
  captured: readonly IDiscoveredEndpoint[],
): Pick<INetworkDiscovery, 'buildTransactionUrl' | 'buildBalanceUrl'> {
  return {
    /** @inheritdoc */
    buildTransactionUrl: (accountId: string, startDate: string): string | false =>
      buildTxnUrlFromTraffic(captured, accountId, startDate),
    /** @inheritdoc */
    buildBalanceUrl: (accountId: string): string | false =>
      buildBalUrlFromTraffic(captured, accountId),
  };
}

/**
 * Build the live-traffic waiter trio (waitForTraffic /
 * waitForTransactionsTraffic / waitForFirstId).
 * @param page - Playwright page used by `awaitTraffic`.
 * @param captured - Captured endpoint pool.
 * @returns Live-traffic waiter method bundle.
 */
function buildTrafficMethods(
  page: Page,
  captured: IDiscoveredEndpoint[],
): Pick<INetworkDiscovery, 'waitForTraffic' | 'waitForTransactionsTraffic' | 'waitForFirstId'> {
  return {
    /** @inheritdoc */
    waitForTraffic: (
      patterns: readonly RegExp[],
      timeoutMs: number,
    ): Promise<IDiscoveredEndpoint | false> =>
      awaitTraffic({ page, captured, patterns }, timeoutMs),
    /** @inheritdoc */
    waitForTransactionsTraffic: (timeoutMs: number): Promise<IDiscoveredEndpoint | false> =>
      awaitTraffic({ page, captured, patterns: PIPELINE_WELL_KNOWN_API.transactions }, timeoutMs),
    /** @inheritdoc */
    waitForFirstId: (
      timeoutMs: number,
      predicate: FirstIdPredicate,
    ): Promise<IDiscoveredEndpoint | false> => awaitFirstId(captured, timeoutMs, predicate),
  };
}

/**
 * Phase 7f — pick the txn endpoint from the post-click pool first,
 * then fall back to the full captured pool when the post-click pool
 * is empty.
 * @param captured - Full captured endpoint pool (fall-back side).
 * @param getPostNavCaptures - Lazy accessor for the post-click pool.
 * @returns Txn discovery method bundle.
 */
function buildTxnDiscovery(
  captured: readonly IDiscoveredEndpoint[],
  getPostNavCaptures: () => readonly IDiscoveredEndpoint[],
): Pick<INetworkDiscovery, 'discoverTransactionsEndpoint'> {
  return {
    /** @inheritdoc */
    discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false => {
      const postNav = getPostNavCaptures();
      return discoverShapeAware(postNav, captured, PIPELINE_WELL_KNOWN_API.transactions);
    },
  };
}

/**
 * Build the api-origin discovery method.
 * @param captured - Captured endpoint pool.
 * @returns Discovery method returning the discovered API origin.
 */
function buildApiOriginMethods(
  captured: readonly IDiscoveredEndpoint[],
): Pick<INetworkDiscovery, 'discoverApiOrigin'> {
  return {
    /** @inheritdoc */
    discoverApiOrigin: (): string | false => discoverApiOriginFromTraffic(captured),
  };
}

export {
  buildApiOriginMethods,
  buildOriginDiscoverMethods,
  buildTrafficMethods,
  buildTxnDiscovery,
  buildUrlBuilders,
};
