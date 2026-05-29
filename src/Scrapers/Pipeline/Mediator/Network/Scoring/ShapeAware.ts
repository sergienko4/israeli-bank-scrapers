/**
 * Network Scoring / ShapeAware — staged tier picker that walks the
 * candidate pool by shape (postWithShape → replayablePost →
 * shapePassing) with two rescue tiers (`urlOnlyMatch`,
 * `windowParamsMatch`). Extracted from `Scoring.ts` per PR #276
 * review-fix so Scoring stays under the Section 11 150 eff-LoC cap.
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../../Types/Debug.js';
import { redactUrlFull } from '../../../Types/PiiRedactor.js';
import { hasTxnArray, isTxnWidgetUrl } from '../../Scrape/TxnShape.js';
import { isReplayablePost } from '../Indexing/Indexing.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import safeParseWindowUrl from './SafeUrl.js';

const LOG = getDebug(import.meta.url);

/** Tier label emitted on the canonical `discover.shapeAware` event. */
type ShapeAwareTier =
  | 'none'
  | 'postWithShape'
  | 'replayablePost'
  | 'shapePassing'
  | 'preClickFallback'
  | 'urlOnlyMatch'
  | 'windowParamsMatch';

/** WK-aliased date-window param keys for the `windowParamsMatch` tier. */
const WINDOW_FROM_KEYS = new Set<string>(PIPELINE_WELL_KNOWN_TXN_FIELDS.fromDate);
const WINDOW_TO_KEYS = new Set<string>(PIPELINE_WELL_KNOWN_TXN_FIELDS.toDate);

/**
 * True when the URL's searchParams carry both a fromDate alias AND a
 * toDate alias — signals that the captured endpoint is date-window
 * aware even when its body fails the txn-shape gate. Pass-through on
 * URL parse error.
 * @param url - Captured URL.
 * @returns True when both aliases are present in the query string.
 */
function hasWindowParams(url: string): boolean {
  const parsed = safeParseWindowUrl(url);
  if (parsed === false) return false;
  const searchParams = parsed.searchParams;
  const paramKeys = searchParams.keys();
  const keys = Array.from(paramKeys);
  const hasFrom = keys.some((key): boolean => WINDOW_FROM_KEYS.has(key));
  if (!hasFrom) return false;
  return keys.some((key): boolean => WINDOW_TO_KEYS.has(key));
}

/**
 * Emit one canonical structured event per `discoverShapeAware` call.
 * Named fields keep the log queryable; PII-safe via `redactUrlFull`;
 * `captureIndex` bridges the log line to the on-disk capture file.
 * @param tier - Which match tier produced the pick.
 * @param picked - Endpoint chosen (or `false` for the no-match tier).
 * @param matches - URL-pattern match count.
 * @returns True (placeholder for chaining).
 */
function logShapeAwarePick(
  tier: ShapeAwareTier,
  picked: IDiscoveredEndpoint | false,
  matches: number,
): true {
  if (!picked) {
    LOG.debug({ event: 'discover.shapeAware', tier, matches });
    return true;
  }
  LOG.debug({
    event: 'discover.shapeAware',
    tier,
    picked: redactUrlFull(picked.url),
    method: picked.method,
    captureIndex: picked.captureIndex ?? 0,
    matches,
  });
  return true;
}

/** Bundled outcome of one tier-priority pass over a candidate pool. */
interface ITierPickOutcome {
  readonly endpoint: IDiscoveredEndpoint | false;
  readonly tier: ShapeAwareTier;
  readonly matches: number;
}

/** Bundled input for the staged tier picker. */
interface IPickerInput {
  readonly urlMatches: readonly IDiscoveredEndpoint[];
  readonly shapePassing: readonly IDiscoveredEndpoint[];
  readonly matches: number;
}

/**
 * Picker tail — try `urlOnlyMatch` and `windowParamsMatch` rescue
 * tiers after the shape-based tiers all miss.
 * @param urlMatches - All URL-matching endpoints.
 * @param matches - URL-match count for telemetry.
 * @returns Final tier outcome.
 */
function pickFallbackTiers(
  urlMatches: readonly IDiscoveredEndpoint[],
  matches: number,
): ITierPickOutcome {
  const emptyBodyMatch = urlMatches.find((ep): boolean => ep.responseBody === null);
  if (emptyBodyMatch) return { endpoint: emptyBodyMatch, tier: 'urlOnlyMatch', matches };
  const windowParamsHit = urlMatches.find((ep): boolean => hasWindowParams(ep.url));
  if (windowParamsHit) return { endpoint: windowParamsHit, tier: 'windowParamsMatch', matches };
  return { endpoint: false, tier: 'none', matches };
}

/**
 * Tier-precedence walker — shape-based tiers first, then delegate to
 * {@link pickFallbackTiers}. Split out of `tierPick` to satisfy the
 * per-function 20-line cap.
 * @param input - Bundled URL matches, shape-passing subset, count.
 * @returns Tier outcome (or `none`).
 */
function pickFromMatches(input: IPickerInput): ITierPickOutcome {
  const { urlMatches, shapePassing, matches } = input;
  const postWithShape = shapePassing.find(isReplayablePost);
  if (postWithShape) return { endpoint: postWithShape, tier: 'postWithShape', matches };
  const anyReplayablePost = urlMatches.find(isReplayablePost);
  if (anyReplayablePost) {
    return { endpoint: anyReplayablePost, tier: 'replayablePost', matches };
  }
  if (shapePassing.length > 0) {
    return { endpoint: shapePassing[0], tier: 'shapePassing', matches };
  }
  return pickFallbackTiers(urlMatches, matches);
}

/**
 * Run the shape-aware tier preference over a single candidate pool.
 * Rejects dashboard-widget URLs via {@link isTxnWidgetUrl} before
 * scoring so widgets never reach SCRAPE.
 *
 * @param pool - Candidate captured endpoints to consider.
 * @param patterns - WellKnown URL patterns to match.
 * @returns Tiered pick outcome — endpoint and tier label.
 */
function tierPick(
  pool: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): ITierPickOutcome {
  const urlMatches = pool.filter(
    (ep): boolean => patterns.some((p): boolean => p.test(ep.url)) && !isTxnWidgetUrl(ep.url),
  );
  if (urlMatches.length === 0) return { endpoint: false, tier: 'none', matches: 0 };
  const matches = urlMatches.length;
  const shapePassing = urlMatches.filter((ep): boolean => hasTxnArray(ep.responseBody));
  return pickFromMatches({ urlMatches, shapePassing, matches });
}

/**
 * Stamp the picker tier label and pre-click flag onto the chosen
 * endpoint so DASHBOARD.FINAL's resolver can carry them onto
 * `ITxnEndpointInternal`.
 * @param endpoint - Picked endpoint.
 * @param tier - Tier label producing the pick.
 * @param capturedPreClick - True when the pick came from the pre-click pool.
 * @returns Endpoint with `pickerTier` + `capturedPreClick` populated.
 */
function stampTierMeta(
  endpoint: IDiscoveredEndpoint,
  tier: ShapeAwareTier,
  capturedPreClick: boolean,
): IDiscoveredEndpoint {
  return { ...endpoint, pickerTier: tier, capturedPreClick };
}

/**
 * Apply the tier outcome to the captured pool: stamp meta, log,
 * return the picked endpoint.
 * @param outcome - Tier outcome from {@link tierPick}.
 * @param isFallback - True when this is the preClickFallback pass.
 * @returns Stamped endpoint or false.
 */
function applyTierOutcome(
  outcome: ITierPickOutcome,
  isFallback: boolean,
): IDiscoveredEndpoint | false {
  if (outcome.endpoint === false) return false;
  const tier: ShapeAwareTier = isFallback ? 'preClickFallback' : outcome.tier;
  const stamped = stampTierMeta(outcome.endpoint, tier, isFallback);
  logShapeAwarePick(tier, stamped, outcome.matches);
  return stamped;
}

/**
 * Phase 7f — pick the txn endpoint from the post-click pool first,
 * then fall back to the full captured pool with a `preClickFallback`
 * tier label. Emits one canonical `discover.shapeAware` event per
 * call so the picker's tier choice and selected URL are traceable
 * from `pipeline.log` alone.
 *
 * @param postNav - Post-click captured endpoints (preferred pool).
 * @param fullPool - All captured endpoints (pre-click fallback).
 * @param patterns - WellKnown regex patterns.
 * @returns Best endpoint stamped with tier metadata, or false.
 */
function discoverShapeAware(
  postNav: readonly IDiscoveredEndpoint[],
  fullPool: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): IDiscoveredEndpoint | false {
  const postOutcome = tierPick(postNav, patterns);
  const postPicked = applyTierOutcome(postOutcome, false);
  if (postPicked !== false) return postPicked;
  const fullOutcome = tierPick(fullPool, patterns);
  const fullPicked = applyTierOutcome(fullOutcome, true);
  if (fullPicked !== false) return fullPicked;
  logShapeAwarePick('none', false, fullOutcome.matches);
  return false;
}

export default discoverShapeAware;
export type { ShapeAwareTier };
