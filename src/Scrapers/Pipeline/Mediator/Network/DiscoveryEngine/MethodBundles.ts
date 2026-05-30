/**
 * DiscoveryEngine / MethodBundles — the core, endpoint and
 * click-bucketing method bundles bound to a captured-endpoint pool.
 * Extracted from `DiscoveryEngine.ts` per PR #276 review-fix so the
 * composer fits the Section 11 150 eff-LoC file cap.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import type { IDashboardClickState } from '../EndpointState/EndpointState.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from '../NetworkDiscoveryTypes.js';
import {
  discoverByWellKnown,
  discoverShapeAware,
  discoverSpaUrlFromTraffic,
  findCommonServicesUrl,
} from '../Scoring/Scoring.js';

/** Type alias for the core discovery method bundle. */
type CoreMethods = Pick<
  INetworkDiscovery,
  | 'findEndpoints'
  | 'getServicesUrl'
  | 'getAllEndpoints'
  | 'discoverByPatterns'
  | 'discoverSpaUrl'
  | 'countSuccessfulResponses'
>;

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

/** Type alias for the bucketing method bundle. */
type BucketingMethods = Pick<
  INetworkDiscovery,
  'markDashboardClickAt' | 'getDashboardClickAt' | 'getPreNavCaptures' | 'getPostNavCaptures'
>;

/**
 * True for HTTP 2xx success responses.
 * @param ep - Captured endpoint.
 * @returns True when the response status is 2xx.
 */
function isSuccessStatus(ep: IDiscoveredEndpoint): boolean {
  const status = ep.status ?? 0;
  return status >= 200 && status < 300;
}

/**
 * Filter the captured pool by URL pattern (top-level so
 * {@link buildCoreMethods} can `.bind`).
 * @param captured - Captured endpoints.
 * @param pattern - URL pattern.
 * @returns Matching subset.
 */
function findEndpointsFn(
  captured: IDiscoveredEndpoint[],
  pattern: RegExp,
): readonly IDiscoveredEndpoint[] {
  return captured.filter((ep): boolean => pattern.test(ep.url));
}

/**
 * Snapshot of the captured pool.
 * @param captured - Captured endpoints.
 * @returns Shallow copy.
 */
function getAllEndpointsFn(captured: IDiscoveredEndpoint[]): readonly IDiscoveredEndpoint[] {
  return [...captured];
}

/**
 * Count 2xx responses in the captured pool.
 * @param captured - Captured endpoints.
 * @returns Number of successful responses.
 */
function countSuccessfulFn(captured: IDiscoveredEndpoint[]): number {
  return captured.filter(isSuccessStatus).length;
}

/**
 * Build the low-level discovery methods bound to captured data.
 * @param captured - Mutable captured endpoints array.
 * @returns Low-level discovery methods.
 */
function buildCoreMethods(captured: IDiscoveredEndpoint[]): CoreMethods {
  return {
    findEndpoints: findEndpointsFn.bind(null, captured),
    getServicesUrl: findCommonServicesUrl.bind(null, captured),
    getAllEndpoints: getAllEndpointsFn.bind(null, captured),
    discoverByPatterns: discoverByWellKnown.bind(null, captured),
    discoverSpaUrl: discoverSpaUrlFromTraffic.bind(null, captured),
    countSuccessfulResponses: countSuccessfulFn.bind(null, captured),
  };
}

/**
 * Build endpoint discovery methods via WellKnown patterns.
 * @param captured - Captured endpoints array.
 * @returns Endpoint discovery methods.
 */
function buildEndpointMethods(captured: readonly IDiscoveredEndpoint[]): EndpointMethods {
  return {
    /** @inheritdoc */
    discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false =>
      discoverShapeAware(captured, captured, PIPELINE_WELL_KNOWN_API.transactions),
    /** @inheritdoc */
    discoverBalanceEndpoint: (): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.balance),
  };
}

/**
 * Filter the capture pool by the dashboard-click timestamp.
 * @param captured - Captured endpoints.
 * @param clickAt - Click timestamp (false when unset).
 * @param after - True for post-click, false for pre-click.
 * @returns Subset (or full pool when no click was issued).
 */
function pickBucket(
  captured: readonly IDiscoveredEndpoint[],
  clickAt: number | false,
  after: boolean,
): readonly IDiscoveredEndpoint[] {
  if (clickAt === false) return captured;
  /**
   * Predicate selecting post-click captures.
   * @param ep - Captured endpoint.
   * @returns True when the endpoint was recorded at or after the click.
   */
  const inPost = (ep: IDiscoveredEndpoint): boolean => ep.timestamp >= clickAt;
  /**
   * Predicate selecting pre-click captures.
   * @param ep - Captured endpoint.
   * @returns True when the endpoint was recorded before the click.
   */
  const inPre = (ep: IDiscoveredEndpoint): boolean => ep.timestamp < clickAt;
  return captured.filter(after ? inPost : inPre);
}

/**
 * Filter the captured pool by post-/pre-click split (top-level so
 * {@link buildBucketingMethods} can `.bind`).
 * @param captured - Captured endpoints.
 * @param clickState - Shared click-at state.
 * @param after - True for post-click, false for pre-click.
 * @returns Captured subset (or full pool when no click was issued).
 */
function splitByClick(
  captured: readonly IDiscoveredEndpoint[],
  clickState: IDashboardClickState,
  after: boolean,
): readonly IDiscoveredEndpoint[] {
  const clickAt = clickState.read();
  return pickBucket(captured, clickAt, after);
}

/**
 * Build the pre/post nav bucketing slice (extracted so
 * {@link buildBucketingMethods} fits the 10-line cap).
 * @param captured - Captures array.
 * @param clickState - Shared click-at state.
 * @returns Pre/post bucketing methods.
 */
function buildNavSplit(
  captured: readonly IDiscoveredEndpoint[],
  clickState: IDashboardClickState,
): Pick<BucketingMethods, 'getPreNavCaptures' | 'getPostNavCaptures'> {
  return {
    getPreNavCaptures: splitByClick.bind(null, captured, clickState, false),
    getPostNavCaptures: splitByClick.bind(null, captured, clickState, true),
  };
}

/**
 * Build the click-aware capture-bucketing helpers shared by live and
 * frozen networks.
 * @param captured - Captures array (live or frozen).
 * @param clickState - Shared click-at state.
 * @returns Bucketing accessors for the INetworkDiscovery contract.
 */
function buildBucketingMethods(
  captured: readonly IDiscoveredEndpoint[],
  clickState: IDashboardClickState,
): BucketingMethods {
  return {
    markDashboardClickAt: clickState.mark,
    getDashboardClickAt: clickState.read,
    ...buildNavSplit(captured, clickState),
  };
}

export { buildBucketingMethods, buildCoreMethods, buildEndpointMethods };
export type { BucketingMethods, CoreMethods, EndpointMethods, HeaderMethods };
