/**
 * Network Scoring / ShapeAware — staged tier picker that walks the
 * candidate pool by shape (postWithShape → replayablePost →
 * shapePassing) with two rescue tiers (`urlOnlyMatch`,
 * `windowParamsMatch`). Extracted from `Scoring.ts` per PR #276
 * review-fix so Scoring stays under the Section 11 150 eff-LoC cap.
 *
 * Phase 8.5a commit 6: structured-log emitter + payload type moved
 * to {@link ./ShapeAwareLogs.js} so this file fits the cap.
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS } from '../../../Registry/WK/ScrapeWK.js';
import { hasTxnArray, isTxnWidgetUrl } from '../../Scrape/TxnShape.js';
import { isReplayablePost } from '../Indexing/Indexing.js';
import type { IDiscoveredEndpoint, PickerTier } from '../NetworkDiscoveryTypes.js';
import safeParseWindowUrl from './SafeUrl.js';
import { logShapeAwarePick, type ShapeAwareTier } from './ShapeAwareLogs.js';

/** WK-aliased date-window param keys for the `windowParamsMatch` tier. */
const WINDOW_FROM_KEYS = new Set<string>(PIPELINE_WELL_KNOWN_TXN_FIELDS.fromDate);
const WINDOW_TO_KEYS = new Set<string>(PIPELINE_WELL_KNOWN_TXN_FIELDS.toDate);

/** Body marker for a txn-pull POST template (vs. an account-list POST). */
const TXN_POSTDATA_MARKER = /transaction/i;

/**
 * True when a replayable POST's request body references the txn-pull
 * data entity — distinguishes a transaction template from a sibling
 * account-list POST sharing the same URL. Bank-agnostic.
 * @param ep - Candidate endpoint.
 * @returns True for a replayable POST carrying the txn marker.
 */
function isTxnReplayablePost(ep: IDiscoveredEndpoint): boolean {
  return isReplayablePost(ep) && TXN_POSTDATA_MARKER.test(ep.postData);
}

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
 * Promotion check for `replayablePost` and `shapePassing` tiers.
 * Pulled out of {@link pickFromMatches} so the orchestrator stays
 * within the 10-LoC cap.
 * @param input - Bundled URL matches, shape-passing subset, count.
 * @returns Tier outcome or `false` when no tier matched.
 */
function pickReplayableOrShape(input: IPickerInput): ITierPickOutcome | false {
  const { urlMatches, shapePassing, matches } = input;
  const txnPost = urlMatches.find(isTxnReplayablePost);
  if (txnPost) return { endpoint: txnPost, tier: 'replayablePostTxn', matches };
  const anyReplayablePost = urlMatches.find(isReplayablePost);
  if (anyReplayablePost) return { endpoint: anyReplayablePost, tier: 'replayablePost', matches };
  if (shapePassing.length > 0) return { endpoint: shapePassing[0], tier: 'shapePassing', matches };
  return false;
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
  const promoted = pickReplayableOrShape(input);
  if (promoted !== false) return promoted;
  return pickFallbackTiers(urlMatches, matches);
}

/**
 * Filter the candidate pool to URL-matching, non-widget endpoints.
 * Pulled out of {@link tierPick} so the orchestrator fits the cap.
 * @param pool - Candidate captured endpoints.
 * @param patterns - WellKnown URL patterns.
 * @returns URL-matching endpoints excluding widget URLs.
 */
function filterPoolMatches(
  pool: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): readonly IDiscoveredEndpoint[] {
  return pool.filter(
    (ep): boolean => patterns.some((p): boolean => p.test(ep.url)) && !isTxnWidgetUrl(ep.url),
  );
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
  const urlMatches = filterPoolMatches(pool, patterns);
  if (urlMatches.length === 0) return { endpoint: false, tier: 'none', matches: 0 };
  const matches = urlMatches.length;
  const shapePassing = urlMatches.filter((ep): boolean => hasTxnArray(ep.responseBody));
  return pickFromMatches({ urlMatches, shapePassing, matches });
}

/**
 * Narrow each granular {@link ShapeAwareTier} to the persisted
 * {@link PickerTier}. Only `replayablePostTxn` (a telemetry-only
 * refinement of `replayablePost`) collapses; every other tier maps to
 * its own identity, so adding a ShapeAwareTier forces a mapping decision.
 */
const SHAPE_TIER_TO_PICKER: Record<ShapeAwareTier, PickerTier> = {
  none: 'none',
  postWithShape: 'postWithShape',
  replayablePostTxn: 'replayablePost',
  replayablePost: 'replayablePost',
  shapePassing: 'shapePassing',
  preClickFallback: 'preClickFallback',
  urlOnlyMatch: 'urlOnlyMatch',
  windowParamsMatch: 'windowParamsMatch',
};

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
  return { ...endpoint, pickerTier: SHAPE_TIER_TO_PICKER[tier], capturedPreClick };
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
  logShapeAwarePick({ tier, picked: stamped, matches: outcome.matches });
  return stamped;
}

/**
 * Pick over the post-click pool, returning `false` to signal "try
 * the pre-click fallback next". Split out of
 * {@link discoverShapeAware} so the orchestrator stays within the
 * 10-LoC cap.
 * @param postNav - Post-click captured endpoints.
 * @param patterns - WellKnown patterns.
 * @returns Picked + stamped endpoint, or false.
 */
function pickPostClick(
  postNav: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): IDiscoveredEndpoint | false {
  const outcome = tierPick(postNav, patterns);
  return applyTierOutcome(outcome, false);
}

/**
 * Pre-click fallback: pick over the full pool with the
 * `preClickFallback` tier label. On no match, emits the canonical
 * `none` event.
 * @param fullPool - All captured endpoints.
 * @param patterns - WellKnown patterns.
 * @returns Picked + stamped endpoint, or false.
 */
function pickPreClickFallback(
  fullPool: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): IDiscoveredEndpoint | false {
  const outcome = tierPick(fullPool, patterns);
  const picked = applyTierOutcome(outcome, true);
  if (picked !== false) return picked;
  logShapeAwarePick({ tier: 'none', picked: false, matches: outcome.matches });
  return false;
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
  const postPicked = pickPostClick(postNav, patterns);
  if (postPicked !== false) return postPicked;
  return pickPreClickFallback(fullPool, patterns);
}

export default discoverShapeAware;
export type { ShapeAwareTier };
