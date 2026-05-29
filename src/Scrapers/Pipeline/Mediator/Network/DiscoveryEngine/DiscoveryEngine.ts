/**
 * Network DiscoveryEngine — the live INetworkDiscovery facade bound
 * to a Playwright `Page`. Wires the captured response pool into the
 * core / endpoint / header / bucketing / lifecycle / traffic /
 * auth-cache / api-origin / failure-gate method bundles, and listens
 * for responses on both the main frame and cross-origin iframes.
 *
 * Extracted from NetworkDiscovery.ts (Phase 4 commit 6/9).
 */

import type { Page, Response } from 'playwright-core';

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import type { IFetchOpts } from '../../../Strategy/Fetch/FetchStrategy.js';
import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { NETWORK_POST_INTERCEPT_TIMEOUT_MS } from '../../Timing/TimingConfig.js';
import { discoverAuthThreeTier } from '../AuthDiscovery.js';
import { createAuthFailureWatcher } from '../AuthFailureWatcher.js';
import {
  buildBalUrlFromTraffic,
  buildCollectionState,
  buildDashboardClickState,
  buildTxnUrlFromTraffic,
  type IDashboardClickState,
} from '../EndpointState/EndpointState.js';
import {
  handleResponse,
  ORIGIN_HEADERS,
  parseResponse,
  REFERER_HEADERS,
  SITE_ID_HEADERS,
} from '../Indexing/Indexing.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../NetworkDiscoveryTypes.js';
import { awaitFirstId, awaitTraffic, type FirstIdPredicate } from '../Polling/NetworkPolling.js';
import {
  discoverApiOriginFromTraffic,
  discoverByWellKnown,
  discoverHeaderValue,
  discoverShapeAware,
  discoverSpaUrlFromTraffic,
  extractSpaHeaders,
  findCommonServicesUrl,
  spaHasAny,
} from '../Scoring/Scoring.js';

const LOG = getDebug(import.meta.url);

/**
 * Build the low-level discovery methods bound to captured data.
 * @param captured - Mutable captured endpoints array.
 * @returns Low-level discovery methods.
 */
function buildCoreMethods(
  captured: IDiscoveredEndpoint[],
): Pick<
  INetworkDiscovery,
  | 'findEndpoints'
  | 'getServicesUrl'
  | 'getAllEndpoints'
  | 'discoverByPatterns'
  | 'discoverSpaUrl'
  | 'countSuccessfulResponses'
> {
  return {
    /** @inheritdoc */
    findEndpoints: (pattern: RegExp): readonly IDiscoveredEndpoint[] =>
      captured.filter((ep): boolean => pattern.test(ep.url)),
    /** @inheritdoc */
    getServicesUrl: (): string | false => findCommonServicesUrl(captured),
    /** @inheritdoc */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [...captured],
    /** @inheritdoc */
    discoverByPatterns: (patterns: readonly RegExp[]): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, patterns),
    /** @inheritdoc */
    discoverSpaUrl: (currentOrigin?: string): string | false =>
      discoverSpaUrlFromTraffic(captured, currentOrigin),
    /** @inheritdoc */
    countSuccessfulResponses: (): number =>
      captured.filter((ep): boolean => {
        const status = ep.status ?? 0;
        return status >= 200 && status < 300;
      }).length,
  };
}

/** Type alias for endpoint discovery methods (txn + balance only). */
type EndpointMethods = Pick<
  INetworkDiscovery,
  'discoverTransactionsEndpoint' | 'discoverBalanceEndpoint'
>;

/** Type alias for header discovery methods. */
type HeaderMethods = Pick<
  INetworkDiscovery,
  'discoverAuthToken' | 'discoverOrigin' | 'discoverSiteId' | 'buildDiscoveredHeaders'
>;

/**
 * Build endpoint discovery methods via WellKnown patterns.
 * @param captured - Captured endpoints array.
 * @returns Endpoint discovery methods.
 */
function buildEndpointMethods(captured: readonly IDiscoveredEndpoint[]): EndpointMethods {
  return {
    /** @inheritdoc */
    discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false =>
      // Phase 7f: this base-table fallback is overridden by the live
      // network's post-click-first picker; it stays here as a safe
      // default for surfaces that do not own the post/pre-click
      // bucket split (e.g. some test mocks). Walks the full pool with
      // the same tier rules; the post-click vs pre-click distinction
      // is irrelevant when only one pool is available.
      discoverShapeAware(captured, captured, PIPELINE_WELL_KNOWN_API.transactions),
    /** @inheritdoc */
    discoverBalanceEndpoint: (): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.balance),
  };
}

/**
 * Create a network discovery instance bound to a page.
 * Starts capturing immediately on creation.
 * @param page - Playwright page to observe.
 * @returns Network discovery interface.
 */
/**
 * Intercept POST responses matching WellKnown patterns from any frame.
 * `page.waitForResponse` captures cross-origin iframe traffic that
 * `page.on('response')` misses. Generic for all banks.
 * @param page - Playwright page.
 * @param captured - Mutable captured endpoints array.
 * @returns True (fire-and-forget).
 */
function interceptPostResponses(page: Page, captured: IDiscoveredEndpoint[]): boolean {
  const allPatterns = [
    ...PIPELINE_WELL_KNOWN_API.auth,
    ...PIPELINE_WELL_KNOWN_API.transactions,
    ...PIPELINE_WELL_KNOWN_API.accounts,
    ...PIPELINE_WELL_KNOWN_API.balance,
  ];
  /**
   * Match POST requests against WellKnown patterns.
   * @param r - Playwright response.
   * @returns True if POST + URL matches.
   */
  /**
   * Match POST/PUT requests against WellKnown patterns.
   * @param r - Playwright response.
   * @returns True if API method + URL matches.
   */
  const isWkApi = (r: Response): boolean => {
    const method = r.request().method();
    const isApiMethod = method === 'POST' || method === 'PUT';
    const url = r.url();
    return isApiMethod && allPatterns.some((p): boolean => p.test(url));
  };
  page
    .waitForResponse(isWkApi, { timeout: NETWORK_POST_INTERCEPT_TIMEOUT_MS })
    .then(async (resp): Promise<boolean> => {
      const endpoint = await parseResponse(resp);
      if (!endpoint) return false;
      const isDupe = captured.some((ep): boolean => ep.url === endpoint.url);
      if (isDupe) return false;
      captured.push(endpoint);
      LOG.trace({
        method: endpoint.method,
        url: maskVisibleText(endpoint.url),
      });
      return true;
    })
    .catch((): boolean => false);
  return true;
}

/**
 * Create a network discovery instance bound to a page.
 * Starts capturing immediately on creation.
 * @param page - Playwright page to observe.
 * @returns Network discovery interface.
 */

/**
 * Build the click-aware capture-bucketing helpers shared by live and
 * frozen networks. The split is timestamp-driven when a dashboard
 * click has been dispatched (`markDashboardClickAt`); when no click
 * was issued — Visacal-class banks where login-FINAL already lands
 * the dashboard data, no SPA navigation needed — both buckets fall
 * back to the full captured pool. The full-pool fallback restores
 * symmetry with `getPreNavCaptures` (which already widens to full
 * when no click) and lets {@link discoverShapeAware} see the txn
 * URLs the bank fired during login-FINAL.
 * @param captured - Captures array (live or frozen).
 * @param clickState - Shared click-at state.
 * @returns Bucketing accessors for the INetworkDiscovery contract.
 */
function buildBucketingMethods(
  captured: readonly IDiscoveredEndpoint[],
  clickState: IDashboardClickState,
): Pick<
  INetworkDiscovery,
  'markDashboardClickAt' | 'getDashboardClickAt' | 'getPreNavCaptures' | 'getPostNavCaptures'
> {
  return {
    /** @inheritdoc */
    markDashboardClickAt: clickState.mark,
    /** @inheritdoc */
    getDashboardClickAt: clickState.read,
    /** @inheritdoc */
    getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => {
      const clickAt = clickState.read();
      if (clickAt === false) return captured;
      return captured.filter((ep): boolean => ep.timestamp < clickAt);
    },
    /** @inheritdoc */
    getPostNavCaptures: (): readonly IDiscoveredEndpoint[] => {
      const clickAt = clickState.read();
      if (clickAt === false) return captured;
      return captured.filter((ep): boolean => ep.timestamp >= clickAt);
    },
  };
}

/**
 * Optional behaviour modifiers for {@link createNetworkDiscovery}.
 */
interface INetworkDiscoveryOpts {
  /**
   * When true, `page.on('response')` and `interceptPostResponses`
   * are NOT attached at construction. Listeners attach lazily on
   * the first `setCollectionActive(true)` call from the trace-
   * lifecycle interceptor. Used by the production pipeline to
   * keep the homepage / WAF-check window listener-free (I-3
   * experiment 2026-05-13 — hCaptcha may observe pre-attached
   * Playwright `page.on(...)` via the browser's CDP-mode signals).
   * Default: false (eager attach — backwards-compatible with the
   * 200+ unit tests that exercise `createNetworkDiscovery`
   * directly without going through the interceptor).
   */
  readonly isDeferAttach?: boolean;
}

/**
 * Build the live INetworkDiscovery instance bound to a Playwright Page.
 * Captures responses, exposes WK-pattern discovery, and tracks the
 * dashboard-click moment so DASHBOARD.FINAL / SCRAPE.PRE can split
 * captures into pre-nav and post-nav buckets.
 *
 * @param page - Playwright page to capture responses from.
 * @param opts - Optional behaviour modifiers (see
 *   {@link INetworkDiscoveryOpts}). Defaults preserve eager attach
 *   so existing tests stay green.
 * @returns The live network-discovery instance.
 */
function createNetworkDiscovery(page: Page, opts: INetworkDiscoveryOpts = {}): INetworkDiscovery {
  const captured: IDiscoveredEndpoint[] = [];
  const isDeferAttach = opts.isDeferAttach === true;
  // Initial collection state: false when deferring (no listeners
  // yet, no captures), true when eager (legacy test-friendly path).
  const collectionState = buildCollectionState(!isDeferAttach);
  let isAttached = false;
  /**
   * Idempotent listener attachment. Eager mode calls this once
   * synchronously; deferred mode invokes it from the first
   * `setCollectionActive(true)` triggered by the trace-lifecycle
   * interceptor at the post-AUTH phase boundary.
   *
   * @returns True when THIS call attached the listeners; false on
   *   the repeat-call no-op (so the two branches differ — satisfies
   *   sonarjs/no-invariant-returns).
   */
  const attachListenersOnce = (): boolean => {
    if (isAttached) return false;
    page.on('response', (r: Response): boolean =>
      handleResponse(captured, r, collectionState.read),
    );
    interceptPostResponses(page, captured);
    isAttached = true;
    return true;
  };
  if (!isDeferAttach) attachListenersOnce();
  /**
   * Wrap collectionState.flip so deferred-mode lazy-attaches on
   * first flip-to-active. Eager mode is a thin pass-through.
   *
   * @param active - True to record captures.
   * @returns True after the flag is set.
   */
  const flipAndMaybeAttach = (active: boolean): true => {
    if (active) attachListenersOnce();
    return collectionState.flip(active);
  };
  const clickState = buildDashboardClickState(false);
  const bucketing = buildBucketingMethods(captured, clickState);
  const lifecycle = {
    /** @inheritdoc */
    setCollectionActive: flipAndMaybeAttach,
  };
  const core = buildCoreMethods(captured);
  const endpoints = buildEndpointMethods(captured);
  const originDiscover = {
    /** @inheritdoc */
    discoverOrigin: (): string | false => discoverHeaderValue(captured, ORIGIN_HEADERS),
    /** @inheritdoc */
    discoverSiteId: (): string | false => discoverHeaderValue(captured, SITE_ID_HEADERS),
  };
  const urlBuilders = {
    /** @inheritdoc */
    buildTransactionUrl: (accountId: string, startDate: string): string | false =>
      buildTxnUrlFromTraffic(captured, accountId, startDate),
    /** @inheritdoc */
    buildBalanceUrl: (accountId: string): string | false =>
      buildBalUrlFromTraffic(captured, accountId),
  };
  const traffic = {
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
  const authState = { cached: false as string | false, discovered: false };
  /**
   * Discover auth with cache support. Caches BOTH positive and negative
   * results so banks whose auth lives in cookies (not sessionStorage) don't
   * pay `pollForAuthModule`'s 10 s timeout on every scrape iteration.
   * @returns Token or false.
   */
  const cachedDiscoverAuth = async (): Promise<string | false> => {
    if (authState.discovered) return authState.cached;
    authState.cached = await discoverAuthThreeTier(captured, page);
    authState.discovered = true;
    return authState.cached;
  };
  const authCache = {
    /** @inheritdoc */
    cacheAuthToken: async (): Promise<string | false> => {
      const token = await discoverAuthThreeTier(captured, page);
      authState.cached = token;
      authState.discovered = true;
      if (token) {
        const truncated = token.slice(0, 20);
        const preview = maskVisibleText(truncated);
        LOG.trace({ message: preview });
      }
      return authState.cached;
    },
    /** @inheritdoc */
    discoverAuthToken: cachedDiscoverAuth,
    /**
     * Build headers with cached auth.
     * @returns Fetch options with auth + origin + site-id.
     */
    buildDiscoveredHeaders: async (): Promise<IFetchOpts> => {
      // Captured SPA headers are the SINGLE source of truth — no
      // hardcoded Content-Type, no defaults. extractSpaHeaders now
      // preserves the captured `content-type` and `referer` so the
      // request shape replays exactly as the SPA sent it. The bank-
      // specific Origin / Site-Id / authorization layers stack on
      // top only when the SPA didn't capture an equivalent value.
      const spaBase = extractSpaHeaders(captured);
      const extraHeaders: Record<string, string> = { ...spaBase };
      const auth = await cachedDiscoverAuth();
      if (auth) extraHeaders.authorization = auth;
      const origin = originDiscover.discoverOrigin();
      if (origin) extraHeaders.Origin = origin;
      if (origin && !spaHasAny(spaBase, REFERER_HEADERS)) extraHeaders.Referer = origin;
      const siteId = originDiscover.discoverSiteId();
      if (siteId && !spaHasAny(spaBase, SITE_ID_HEADERS)) extraHeaders['X-Site-Id'] = siteId;
      return { extraHeaders };
    },
  };
  const apiOrigin = {
    /** @inheritdoc */
    discoverApiOrigin: (): string | false => discoverApiOriginFromTraffic(captured),
  };
  // Generic auth-failure watcher attached to the live page. The LoginPhase
  // owns the lifecycle: it consumes the watcher in POST and disposes it
  // before later phases run. See AuthFailureWatcher.ts for layer details.
  const authFailureWatcher = createAuthFailureWatcher(page);
  const failureGate = { authFailureWatcher };
  /**
   * Phase 7f — pick the txn endpoint from the post-click pool first,
   * then fall back to the full captured pool when the post-click pool
   * is empty. Discount-class banks click "All Transactions" and the
   * real txn URL fires after the click — strict post-click discipline
   * keeps preview-widget URLs (Discount's `/forHomePage`) out of the
   * picker. Visacal-class banks fire `/getFilteredTransactions` at
   * login-FINAL (before any click); the fall-back tier
   * `preClickFallback` recovers those without compromising the
   * discipline elsewhere.
   * @returns Discovered txn endpoint stamped with `pickerTier` +
   *   `capturedPreClick`, or false.
   */
  const discoverTxnPostClickFirst = (): IDiscoveredEndpoint | false => {
    const postNav = bucketing.getPostNavCaptures();
    return discoverShapeAware(postNav, captured, PIPELINE_WELL_KNOWN_API.transactions);
  };
  const txnDiscovery = {
    /** @inheritdoc */
    discoverTransactionsEndpoint: discoverTxnPostClickFirst,
  };
  const base = { ...core, ...endpoints, ...originDiscover, ...urlBuilders };
  return {
    ...base,
    ...bucketing,
    ...lifecycle,
    ...txnDiscovery,
    ...traffic,
    ...authCache,
    ...apiOrigin,
    ...failureGate,
  };
}

export { buildBucketingMethods, buildCoreMethods, buildEndpointMethods, createNetworkDiscovery };
export type { EndpointMethods, HeaderMethods, INetworkDiscoveryOpts };
