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
 * Section 11 10-LoC cap via dedicated builders in
 * {@link ./FrozenSlices.js}.
 */

import { createFrozenAuthFailureWatcher } from '../AuthFailureWatcher.js';
import {
  buildBucketingMethods,
  buildCoreMethods,
  buildEndpointMethods,
} from '../DiscoveryEngine/DiscoveryEngine.js';
import { buildDashboardClickState } from '../EndpointState/EndpointState.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../NetworkDiscoveryTypes.js';
import {
  buildFrozenApiOrigin,
  buildFrozenHeaders,
  buildFrozenTraffic,
  buildFrozenTxnDiscovery,
  buildFrozenUrlBuilders,
} from './FrozenSlices.js';

/** Frozen replays have no listener — the lifecycle gate is a no-op. */
const FROZEN_LIFECYCLE = {
  /** @inheritdoc */
  setCollectionActive: (): true => true,
} as const;

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

/** Short alias for the frozen pool — keeps internal sigs ≤ 100 chars. */
type FrozenPool = IDiscoveredEndpoint[];

/** Short alias for the cached auth token shape. */
type CachedAuth = string | false;

/** Static slices of the frozen bundle (do not depend on click state). */
type FrozenStaticSlices = Pick<
  IFrozenBundle,
  'core' | 'epMethods' | 'headers' | 'urlBuilders' | 'traffic' | 'apiOrigin'
>;

/** Auth-agnostic half of the static slices (frozen-only builders). */
type AuthAgnosticSlices = Pick<
  IFrozenBundle,
  'core' | 'epMethods' | 'urlBuilders' | 'traffic' | 'apiOrigin'
>;

/**
 * Build the slices that do NOT consume the cached auth token —
 * isolates the auth-bound `headers` builder for line-budget reasons.
 * @param frozen - Frozen endpoints.
 * @returns Auth-agnostic static slices.
 */
function buildAuthAgnosticSlices(frozen: FrozenPool): AuthAgnosticSlices {
  return {
    core: buildCoreMethods(frozen),
    epMethods: buildEndpointMethods(frozen),
    urlBuilders: buildFrozenUrlBuilders(frozen),
    traffic: buildFrozenTraffic(frozen),
    apiOrigin: buildFrozenApiOrigin(frozen),
  };
}

/**
 * Build the click-state-independent slices of the frozen bundle.
 * @param frozen - Frozen endpoints.
 * @param cachedAuth - Pre-cached auth token.
 * @returns Static slices ready to spread into {@link IFrozenBundle}.
 */
function buildFrozenStaticSlices(frozen: FrozenPool, cachedAuth: CachedAuth): FrozenStaticSlices {
  const agnostic = buildAuthAgnosticSlices(frozen);
  const headers = buildFrozenHeaders(frozen, cachedAuth);
  return { ...agnostic, headers };
}

/** Click-state-dependent slices of the frozen bundle. */
type FrozenClickSlices = Pick<IFrozenBundle, 'bucketing' | 'txnDiscovery'>;

/**
 * Build the bucketing + txn-discovery slices, which both depend on
 * the dashboard click-state.
 * @param frozen - Frozen endpoints.
 * @param dashboardClickAt - Click timestamp inherited from live.
 * @returns Click-dependent slices ready to spread.
 */
function buildFrozenClickSlices(
  frozen: IDiscoveredEndpoint[],
  dashboardClickAt: number | false,
): FrozenClickSlices {
  const clickState = buildDashboardClickState(dashboardClickAt);
  const bucketing = buildBucketingMethods(frozen, clickState);
  const txnDiscovery = buildFrozenTxnDiscovery(frozen, bucketing.getPostNavCaptures);
  return { bucketing, txnDiscovery };
}

/**
 * Build every frozen method bundle. Split out of
 * `createFrozenNetwork` so each function stays under the Section 11
 * per-function 10-LoC cap.
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
  const staticSlices = buildFrozenStaticSlices(frozen, cachedAuth);
  const clickSlices = buildFrozenClickSlices(frozen, dashboardClickAt);
  return { ...staticSlices, ...clickSlices };
}

/**
 * Spread the click-state-independent half of the frozen bundle into
 * the partial INetworkDiscovery shape.
 * @param b - Frozen bundle.
 * @returns Partial discovery composed from static slices.
 */
function assembleFrozenStaticHalf(b: IFrozenBundle): Partial<INetworkDiscovery> {
  return { ...b.core, ...b.epMethods, ...b.headers, ...b.urlBuilders, ...b.bucketing };
}

/**
 * Spread the click-state-dependent half of the frozen bundle plus
 * lifecycle + auth-failure watcher.
 * @param b - Frozen bundle.
 * @returns Partial discovery composed from dynamic slices.
 */
function assembleFrozenDynamicHalf(b: IFrozenBundle): Partial<INetworkDiscovery> {
  return {
    ...FROZEN_LIFECYCLE,
    ...b.txnDiscovery,
    ...b.traffic,
    ...b.apiOrigin,
    authFailureWatcher: createFrozenAuthFailureWatcher(),
  };
}

/**
 * Compose the full INetworkDiscovery from the two halves. Cast is
 * intentional — TS cannot prove spread completeness.
 * @param b - Frozen bundle.
 * @returns Full INetworkDiscovery for frozen replay.
 */
function assembleFrozenNetwork(b: IFrozenBundle): INetworkDiscovery {
  const staticHalf = assembleFrozenStaticHalf(b);
  const dynamicHalf = assembleFrozenDynamicHalf(b);
  return { ...staticHalf, ...dynamicHalf } as INetworkDiscovery;
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
  const bundle = buildFrozenBundle(frozen, cachedAuth, dashboardClickAt);
  return assembleFrozenNetwork(bundle);
}

export default createFrozenNetwork;
