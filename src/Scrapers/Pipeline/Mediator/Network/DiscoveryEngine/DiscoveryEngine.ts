/**
 * Network DiscoveryEngine — the live INetworkDiscovery facade bound
 * to a Playwright `Page`. Wires the captured response pool into the
 * core / endpoint / header / bucketing / lifecycle / traffic /
 * auth-cache / api-origin / failure-gate method bundles, and listens
 * for responses on both the main frame and cross-origin iframes.
 *
 * PR #276 review: each builder is extracted into its own file under
 * `DiscoveryEngine/` (`AuthCache`, `Lifecycle`, `MethodBundles`,
 * `MetaBuilders`, `PostInterceptor`) so this composer stays well
 * under the Section 11 150 eff-LoC file cap and every function
 * stays under the 20-LoC per-function cap.
 */

import type { Page } from 'playwright-core';

import { createAuthFailureWatcher } from '../AuthFailureWatcher.js';
import { buildDashboardClickState } from '../EndpointState/EndpointState.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../NetworkDiscoveryTypes.js';
import buildAuthCache from './AuthCache.js';
import buildLifecycleState from './Lifecycle.js';
import {
  buildApiOriginMethods,
  buildOriginDiscoverMethods,
  buildTrafficMethods,
  buildTxnDiscovery,
  buildUrlBuilders,
} from './MetaBuilders.js';
import { buildBucketingMethods, buildCoreMethods, buildEndpointMethods } from './MethodBundles.js';

/**
 * Optional behaviour modifiers for {@link createNetworkDiscovery}.
 */
interface INetworkDiscoveryOpts {
  /**
   * When true, `page.on('response')` and `interceptPostResponses` are
   * NOT attached at construction. Listeners attach lazily on the first
   * `setCollectionActive(true)` from the trace-lifecycle interceptor.
   * Used by the production pipeline to keep the homepage / WAF-check
   * window listener-free (I-3 experiment 2026-05-13). Default: false
   * (eager attach — backwards-compatible with the 200+ unit tests).
   */
  readonly isDeferAttach?: boolean;
}

/** Discovery half of the live bundle (capture-pool only). */
interface IDiscoverySlice {
  readonly core: ReturnType<typeof buildCoreMethods>;
  readonly endpoints: ReturnType<typeof buildEndpointMethods>;
  readonly originDiscover: ReturnType<typeof buildOriginDiscoverMethods>;
  readonly urlBuilders: ReturnType<typeof buildUrlBuilders>;
  readonly apiOrigin: ReturnType<typeof buildApiOriginMethods>;
  readonly txnDiscovery: ReturnType<typeof buildTxnDiscovery>;
}

/** I/O half of the live bundle (Page-bound + auth). */
interface IIoSlice {
  readonly traffic: ReturnType<typeof buildTrafficMethods>;
  readonly authCache: ReturnType<typeof buildAuthCache>;
  readonly authFailureWatcher: ReturnType<typeof createAuthFailureWatcher>;
}

/** Bucketing-related slice of the bundle. */
interface IBucketingSlice {
  readonly clickState: ReturnType<typeof buildDashboardClickState>;
  readonly bucketing: ReturnType<typeof buildBucketingMethods>;
  readonly lifecycle: ReturnType<typeof buildLifecycleState>;
}

/**
 * Build the lifecycle + bucketing slice shared by every live
 * discovery instance.
 * @param page - Playwright page.
 * @param captured - Captured endpoints array.
 * @param isDeferAttach - True to defer listener attach.
 * @returns Bucketing + lifecycle handles.
 */
function buildBucketingSlice(
  page: Page,
  captured: IDiscoveredEndpoint[],
  isDeferAttach: boolean,
): IBucketingSlice {
  const lifecycle = buildLifecycleState(page, captured, isDeferAttach);
  const clickState = buildDashboardClickState(false);
  const bucketing = buildBucketingMethods(captured, clickState);
  return { clickState, bucketing, lifecycle };
}

/** Accessor lambda for the post-click capture pool. */
type CapturedAccessor = () => readonly IDiscoveredEndpoint[];

/** Discovery slice without the URL/api-origin/txn-discovery (derived) part. */
type CoreDiscoveryPart = Pick<IDiscoverySlice, 'core' | 'endpoints' | 'originDiscover'>;

/** Discovery slice URL/api-origin/txn-discovery (derived) part. */
type DerivedDiscoveryPart = Pick<IDiscoverySlice, 'apiOrigin' | 'txnDiscovery' | 'urlBuilders'>;

/**
 * Build the core discovery part of the discovery slice.
 * @param captured - Captured endpoints array.
 * @returns Core discovery part.
 */
function buildCoreDiscovery(captured: IDiscoveredEndpoint[]): CoreDiscoveryPart {
  return {
    core: buildCoreMethods(captured),
    endpoints: buildEndpointMethods(captured),
    originDiscover: buildOriginDiscoverMethods(captured),
  };
}

/**
 * Build the URL builders + api-origin + txn-discovery (derived) part
 * of the discovery slice.
 * @param captured - Captured endpoints array.
 * @param getPostNav - Post-click pool accessor.
 * @returns Derived part of the discovery slice.
 */
function buildDerivedDiscovery(
  captured: IDiscoveredEndpoint[],
  getPostNav: CapturedAccessor,
): DerivedDiscoveryPart {
  return {
    urlBuilders: buildUrlBuilders(captured),
    apiOrigin: buildApiOriginMethods(captured),
    txnDiscovery: buildTxnDiscovery(captured, getPostNav),
  };
}

/**
 * Build the pool-only discovery slice (core, endpoints, headers,
 * URL builders, api-origin, txn-discovery).
 * @param captured - Captured endpoints array.
 * @param getPostNav - Post-click pool accessor.
 * @returns Discovery slice.
 */
function buildDiscoverySlice(
  captured: IDiscoveredEndpoint[],
  getPostNav: CapturedAccessor,
): IDiscoverySlice {
  return { ...buildCoreDiscovery(captured), ...buildDerivedDiscovery(captured, getPostNav) };
}

/**
 * Build the Page-bound I/O slice (traffic waiters, auth cache,
 * failure watcher).
 * @param page - Playwright page.
 * @param captured - Captured endpoints array.
 * @returns I/O slice.
 */
function buildIoSlice(page: Page, captured: IDiscoveredEndpoint[]): IIoSlice {
  const traffic = buildTrafficMethods({ page, captured });
  const authCache = buildAuthCache(page, captured);
  const authFailureWatcher = createAuthFailureWatcher(page);
  return { traffic, authCache, authFailureWatcher };
}

/**
 * Build the discovery-side property bag used by
 * {@link assembleLiveDiscovery}. Extracted so the assembler fits
 * the 10-line cap.
 *
 * CR PR #276 post-review-fix #3 — `d.endpoints` carries a pre-click-
 * aware `discoverTransactionsEndpoint`, but the live facade must use
 * the post-click-aware one from `d.txnDiscovery`. Spreading
 * `d.endpoints` here would let a future reorder silently regress txn
 * discovery — so destructure only `discoverBalanceEndpoint` and let
 * `d.txnDiscovery` provide the txn implementation explicitly.
 * @param d - Discovery slice.
 * @returns Discovery-side property bag.
 */
function buildDiscoveryBag(d: IDiscoverySlice): Partial<INetworkDiscovery> {
  return {
    ...d.core,
    discoverBalanceEndpoint: d.endpoints.discoverBalanceEndpoint,
    ...d.originDiscover,
    ...d.urlBuilders,
    ...d.txnDiscovery,
    ...d.apiOrigin,
  };
}

/**
 * Build the I/O + bucketing property bag used by
 * {@link assembleLiveDiscovery}.
 * @param buckets - Bucketing + lifecycle slice.
 * @param io - I/O slice.
 * @returns I/O + bucketing property bag.
 */
function buildIoBag(buckets: IBucketingSlice, io: IIoSlice): Partial<INetworkDiscovery> {
  return {
    ...buckets.bucketing,
    setCollectionActive: buckets.lifecycle.setCollectionActive,
    ...io.traffic,
    ...io.authCache,
    authFailureWatcher: io.authFailureWatcher,
  };
}

/**
 * Assemble the final INetworkDiscovery instance from sub-slices.
 * @param buckets - Bucketing + lifecycle slice.
 * @param d - Discovery slice.
 * @param io - I/O slice.
 * @returns Live INetworkDiscovery facade.
 */
function assembleLiveDiscovery(
  buckets: IBucketingSlice,
  d: IDiscoverySlice,
  io: IIoSlice,
): INetworkDiscovery {
  return { ...buildDiscoveryBag(d), ...buildIoBag(buckets, io) } as INetworkDiscovery;
}

/**
 * Build the live INetworkDiscovery instance bound to a Playwright Page.
 * Captures responses, exposes WK-pattern discovery, and tracks the
 * dashboard-click moment so DASHBOARD.FINAL / SCRAPE.PRE can split
 * captures into pre-nav and post-nav buckets.
 *
 * @param page - Playwright page to capture responses from.
 * @param opts - Optional behaviour modifiers.
 * @returns The live network-discovery instance.
 */
function createNetworkDiscovery(page: Page, opts: INetworkDiscoveryOpts = {}): INetworkDiscovery {
  const captured: IDiscoveredEndpoint[] = [];
  const isDeferAttach = opts.isDeferAttach === true;
  const buckets = buildBucketingSlice(page, captured, isDeferAttach);
  const d = buildDiscoverySlice(captured, buckets.bucketing.getPostNavCaptures);
  const io = buildIoSlice(page, captured);
  return assembleLiveDiscovery(buckets, d, io);
}

export { buildBucketingMethods, buildCoreMethods, buildEndpointMethods, createNetworkDiscovery };
export type { HeaderMethods } from './MethodBundles.js';
export type { INetworkDiscoveryOpts };
