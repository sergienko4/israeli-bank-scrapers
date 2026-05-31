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

/** Base context for the live-traffic waiters (Page + capture pool). */
interface IAwaitTrafficBase {
  readonly page: Page;
  readonly captured: IDiscoveredEndpoint[];
}

/**
 * Await the first traffic capture matching `patterns` (top-level
 * helper so {@link buildTrafficMethods} can use `.bind(null, ...)`).
 * @param base - Page + capture-pool bundle.
 * @param patterns - URL patterns to wait for.
 * @param timeoutMs - Wait timeout in milliseconds.
 * @returns First matching endpoint or false on timeout.
 */
function awaitForPatterns(
  base: IAwaitTrafficBase,
  patterns: readonly RegExp[],
  timeoutMs: number,
): Promise<IDiscoveredEndpoint | false> {
  const opts = { page: base.page, captured: base.captured, patterns };
  return awaitTraffic(opts, timeoutMs);
}

/**
 * Await the first transactions traffic capture.
 * @param base - Page + capture-pool bundle.
 * @param timeoutMs - Wait timeout in milliseconds.
 * @returns First matching endpoint or false on timeout.
 */
function awaitForTxns(
  base: IAwaitTrafficBase,
  timeoutMs: number,
): Promise<IDiscoveredEndpoint | false> {
  return awaitForPatterns(base, PIPELINE_WELL_KNOWN_API.transactions, timeoutMs);
}

/**
 * Await the first capture satisfying `predicate` (top-level so the
 * `waitForFirstId` field can be a `.bind` instead of an inline arrow).
 * @param captured - Captured endpoint pool.
 * @param timeoutMs - Wait timeout in milliseconds.
 * @param predicate - Discriminator predicate.
 * @returns First matching endpoint or false on timeout.
 */
function awaitFirstIdFn(
  captured: IDiscoveredEndpoint[],
  timeoutMs: number,
  predicate: FirstIdPredicate,
): Promise<IDiscoveredEndpoint | false> {
  return awaitFirstId(captured, timeoutMs, predicate);
}

/** Live-traffic waiter method bundle exposed to {@link INetworkDiscovery}. */
type TrafficMethods = Pick<
  INetworkDiscovery,
  'waitForTraffic' | 'waitForTransactionsTraffic' | 'waitForFirstId'
>;

/**
 * Build the live-traffic waiter trio (waitForTraffic /
 * waitForTransactionsTraffic / waitForFirstId).
 * @param base - Playwright page + captured-pool bundle.
 * @returns Live-traffic waiter method bundle.
 */
function buildTrafficMethods(base: IAwaitTrafficBase): TrafficMethods {
  return {
    waitForTraffic: awaitForPatterns.bind(null, base),
    waitForTransactionsTraffic: awaitForTxns.bind(null, base),
    waitForFirstId: awaitFirstIdFn.bind(null, base.captured),
  };
}

/**
 * Pick the txn endpoint from the post-click pool first, then fall
 * back to the full captured pool when the post-click pool is empty.
 * Hoisted to top-level so {@link buildTxnDiscovery} can `.bind`.
 * @param captured - Full captured endpoint pool.
 * @param getPostNavCaptures - Lazy accessor for the post-click pool.
 * @returns Discovered txn endpoint or false.
 */
function discoverTxn(
  captured: readonly IDiscoveredEndpoint[],
  getPostNavCaptures: () => readonly IDiscoveredEndpoint[],
): IDiscoveredEndpoint | false {
  const postNav = getPostNavCaptures();
  return discoverShapeAware(postNav, captured, PIPELINE_WELL_KNOWN_API.transactions);
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
  return { discoverTransactionsEndpoint: discoverTxn.bind(null, captured, getPostNavCaptures) };
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
