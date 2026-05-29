/**
 * Network Scoring — endpoint-pool scorers, pickers, and discovery
 * probes. Pure functions over a captured pool; no side effects on
 * Playwright `Page` and no cross-talk with the discovery facade.
 *
 *   • Shape-aware tier picker (`tierPick` / `discoverShapeAware`).
 *   • Header probes (`findByReferer`, `findByCorsOrigin`,
 *     `discoverHeaderValue`).
 *   • SPA URL discovery (`scanConfigBody`, `findByConfigBody`,
 *     `discoverSpaUrlFromTraffic`).
 *   • API origin discovery (`extractApiFromBody`,
 *     `discoverApiFromConfig` / `Subdomain` / `Path` /
 *     `discoverApiOriginFromTraffic`).
 *   • SPA-header carry-over (`extractSpaHeaders` / `spaHasAny`).
 *   • `findCommonServicesUrl` — base-URL frequency picker.
 *
 * Extracted from NetworkDiscovery.ts (Phase 4 commit 4/9).
 */

import {
  PIPELINE_WELL_KNOWN_API,
  PIPELINE_WELL_KNOWN_TXN_FIELDS,
} from '../../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { redactUrlFull } from '../../../Types/PiiRedactor.js';
import { hasTxnArray, isTxnWidgetUrl } from '../../Scrape/TxnShape.js';
import {
  BROWSER_STANDARD_HEADERS,
  extractBaseUrl,
  isReplayablePost,
} from '../Indexing/Indexing.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';

const LOG = getDebug(import.meta.url);

/**
 * Find the most common base URL from captured endpoints.
 * @param endpoints - All captured endpoints.
 * @returns Most common base URL or false.
 */
function findCommonServicesUrl(endpoints: readonly IDiscoveredEndpoint[]): string | false {
  if (endpoints.length === 0) return false;
  const counts = new Map<string, number>();
  for (const ep of endpoints) {
    const base = extractBaseUrl(ep.url);
    const current = counts.get(base) ?? 0;
    counts.set(base, current + 1);
  }
  const entries = [...counts.entries()];
  entries.sort((a, b): number => b[1] - a[1]);
  return entries[0]?.[0] ?? '';
}

/** Tier label emitted on the canonical `discover.shapeAware` event. */
type ShapeAwareTier =
  | 'none'
  | 'postWithShape'
  | 'replayablePost'
  | 'shapePassing'
  | 'preClickFallback'
  | 'urlOnlyMatch'
  | 'windowParamsMatch';

/**
 * Phase H'' (2026-05-15): WK-aliased date-window param keys, joined
 * from the WK txn-field registry. Used by the {@link hasWindowParams}
 * picker probe so the `windowParamsMatch` tier can rescue Hapoalim
 * dormant-account dashboards where the SPA fires only a populated
 * `?type=totals&view=future` GET whose URL still exposes the canonical
 * `fromDate` / `toDate` aliases.
 */
const WINDOW_FROM_KEYS = new Set<string>(PIPELINE_WELL_KNOWN_TXN_FIELDS.fromDate);
const WINDOW_TO_KEYS = new Set<string>(PIPELINE_WELL_KNOWN_TXN_FIELDS.toDate);

/**
 * Safely parse a URL string. Returns false on any parse error so the
 * caller can fall through without try/catch noise.
 * @param input - Candidate URL.
 * @returns Parsed URL or false.
 */
function safeParseWindowUrl(input: string): URL | false {
  try {
    return new URL(input);
  } catch {
    return false;
  }
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
  const keyIter = parsed.searchParams.keys();
  const keys = Array.from(keyIter);
  const hasFrom = keys.some((key): boolean => WINDOW_FROM_KEYS.has(key));
  if (!hasFrom) return false;
  const hasTo = keys.some((key): boolean => WINDOW_TO_KEYS.has(key));
  return hasTo;
}

/**
 * Emit one canonical structured event per `discoverShapeAware` call.
 * Named fields keep the log queryable in centralized stores; PII-safe
 * via `redactUrlFull`; `captureIndex` bridges the log line to the
 * exact on-disk capture file (`<runId>/network/NNNN-METHOD-…json`).
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

/**
 * Run the shape-aware tier preference over a single candidate pool
 * (post-click or pre-click). Returns the chosen endpoint with its
 * tier label, or `none` when the pool yields no URL match at all.
 * Rejects dashboard-widget URLs (M4.F2) via {@link isTxnWidgetUrl}
 * before scoring so widgets never reach SCRAPE.
 *
 * <p>Phase H' (2026-05-15, refined after live Hapoalim trace) —
 * the `urlOnlyMatch` tier (last-resort pick) is restricted to
 * <em>2xx-no-body</em> responses (e.g. 204 No Content for a dormant
 * 30-day window). A captured response with a populated body that
 * fails the txn-shape gate is NOT a transaction endpoint — it is a
 * sibling URL like Hapoalim's `?type=totals&view=future` summary
 * GET which matches the same WK pattern but carries no txn array.
 * Picking such a URL via `urlOnlyMatch` would commit the wrong
 * endpoint and silently produce zero-txn scrapes. The picker
 * therefore falls through to `tier:'none'` on populated-but-
 * non-matching bodies, letting DASHBOARD.FINAL fail loud per the
 * user-locked principle "the dashboard ensures it has the values;
 * if not, signal LOUD".
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
  const postWithShape = shapePassing.find(isReplayablePost);
  if (postWithShape) return { endpoint: postWithShape, tier: 'postWithShape', matches };
  const anyReplayablePost = urlMatches.find(isReplayablePost);
  if (anyReplayablePost) {
    return { endpoint: anyReplayablePost, tier: 'replayablePost', matches };
  }
  if (shapePassing.length > 0) {
    return { endpoint: shapePassing[0], tier: 'shapePassing', matches };
  }
  const emptyBodyMatch = urlMatches.find((ep): boolean => ep.responseBody === null);
  if (emptyBodyMatch) {
    return { endpoint: emptyBodyMatch, tier: 'urlOnlyMatch', matches };
  }
  // Phase H'' (2026-05-15): Hapoalim dormant-account rescue — pick a
  // populated-body URL whose searchParams expose the canonical
  // fromDate/toDate WK aliases. SCRAPE then writes the live window
  // via `applyDateRangeToUrl`; the detector tuple supplied through
  // `fc.dateWindowParams` covers the APPEND case when aliases are
  // absent from the captured URL.
  const windowParamsHit = urlMatches.find((ep): boolean => hasWindowParams(ep.url));
  if (windowParamsHit) {
    return { endpoint: windowParamsHit, tier: 'windowParamsMatch', matches };
  }
  return { endpoint: false, tier: 'none', matches };
}

/**
 * Stamp the picker tier label and pre-click flag onto the chosen
 * endpoint so DASHBOARD.FINAL's resolver can carry them onto
 * `ITxnEndpointInternal`. Pure shape extension; preserves the rest
 * of the captured fields.
 *
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
 * Phase 7f — picks the best endpoint from the post-click pool first;
 * when the post-click pool yields zero matches, falls back to the
 * full captured pool with a `preClickFallback` tier label. The
 * fallback covers Visacal-class banks where the real TRX URL fires
 * at login-FINAL (before any dashboard click).
 *
 * <p>Emits one canonical `discover.shapeAware` event per call so the
 * picker's tier choice and selected URL are traceable from
 * `pipeline.log` alone. The `captureIndex` field on the log line
 * matches the on-disk filename prefix.
 *
 * @param postNav - Post-click captured endpoints (preferred pool).
 * @param fullPool - All captured endpoints (pre-click fallback).
 * @param patterns - WellKnown regex patterns.
 * @returns Best endpoint stamped with `pickerTier` + `capturedPreClick`,
 *   or false when no pool yields a match.
 */
function discoverShapeAware(
  postNav: readonly IDiscoveredEndpoint[],
  fullPool: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): IDiscoveredEndpoint | false {
  const postOutcome = tierPick(postNav, patterns);
  if (postOutcome.endpoint !== false) {
    const stamped = stampTierMeta(postOutcome.endpoint, postOutcome.tier, false);
    logShapeAwarePick(postOutcome.tier, stamped, postOutcome.matches);
    return stamped;
  }
  // Post-click pool yielded nothing — try the FULL pool. Any pre-click
  // hit is logged as `preClickFallback` so a Visacal-class capture
  // surfaces in telemetry as the documented exception.
  const fullOutcome = tierPick(fullPool, patterns);
  if (fullOutcome.endpoint !== false) {
    const stamped = stampTierMeta(fullOutcome.endpoint, 'preClickFallback', true);
    logShapeAwarePick('preClickFallback', stamped, fullOutcome.matches);
    return stamped;
  }
  // No shape-passing capture in either pool — surface as no-match.
  // DASHBOARD.FINAL escalates to F-DASH-1 so the pipeline halts before
  // SCRAPE inherits a URL whose body has zero transaction records.
  logShapeAwarePick('none', false, fullOutcome.matches);
  return false;
}

/**
 * Find the first endpoint matching any pattern in the list.
 * @param captured - All captured endpoints.
 * @param patterns - WellKnown regex patterns to try in order.
 * @returns First matching endpoint or false.
 */
function discoverByWellKnown(
  captured: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): IDiscoveredEndpoint | false {
  /**
   * Test if an endpoint URL matches a regex pattern.
   * @param ep - Captured endpoint.
   * @param p - Pattern to test.
   * @returns True if URL matches.
   */
  const urlMatchesPattern = (ep: IDiscoveredEndpoint, p: RegExp): boolean => p.test(ep.url);
  /**
   * Check if any captured endpoint URL matches a pattern.
   * @param p - Pattern to test against all captured endpoints.
   * @returns True if at least one URL matches.
   */
  const matchesAny = (p: RegExp): boolean =>
    captured.some((ep): boolean => urlMatchesPattern(ep, p));
  const match = patterns.find(matchesAny);
  if (!match) return false;
  const hit = captured.find((ep): boolean => match.test(ep.url));
  return hit ?? false;
}

/**
 * Check if an endpoint has a non-empty value for any of the header names.
 * @param ep - Captured endpoint.
 * @param headerNames - Header names to check.
 * @returns Header value or false.
 */
function extractHeader(ep: IDiscoveredEndpoint, headerNames: readonly string[]): string | false {
  const match = headerNames.find(
    (h): boolean => typeof ep.requestHeaders[h] === 'string' && ep.requestHeaders[h].length > 0,
  );
  if (!match) return false;
  return ep.requestHeaders[match];
}

/**
 * Find the first non-empty header value matching any WellKnown header name.
 * @param captured - All captured endpoints.
 * @param headerNames - Header names to search (lowercase).
 * @returns Header value or false.
 */
function discoverHeaderValue(
  captured: readonly IDiscoveredEndpoint[],
  headerNames: readonly string[],
): string | false {
  const ep = captured.find((e): boolean => extractHeader(e, headerNames) !== false);
  if (!ep) return false;
  return extractHeader(ep, headerNames);
}

/**
 * Discover the SPA URL from captured API traffic.
 * Finds a captured endpoint on an API domain and extracts its referer header.
 * The referer is the SPA page that made the API call.
 * @param captured - All captured endpoints.
 * @returns SPA URL or false.
 */
/**
 * Tier 1: Find SPA URL from cross-domain referer on WellKnown API endpoints.
 * @param captured - All captured endpoints.
 * @returns SPA URL or false.
 */
function findByReferer(captured: readonly IDiscoveredEndpoint[]): string | false {
  const apiPatterns = [
    ...PIPELINE_WELL_KNOWN_API.transactions,
    ...PIPELINE_WELL_KNOWN_API.accounts,
    ...PIPELINE_WELL_KNOWN_API.balance,
    ...PIPELINE_WELL_KNOWN_API.auth,
  ];
  const apiEndpoint = captured.find((ep): boolean => {
    const isApi = apiPatterns.some((p): boolean => p.test(ep.url));
    if (!isApi) return false;
    const referer = ep.requestHeaders.referer;
    if (!referer) return false;
    const epOrigin = new URL(ep.url).origin;
    const refOrigin = new URL(referer).origin;
    return epOrigin !== refOrigin;
  });
  if (!apiEndpoint) return false;
  const ref = apiEndpoint.requestHeaders.referer;
  if (!ref) return false;
  LOG.debug({
    message:
      `SPA Tier1 (referer): ${maskVisibleText(ref)} ` + `from ${maskVisibleText(apiEndpoint.url)}`,
  });
  return ref;
}

/**
 * Tier 2: Find SPA URL from CORS access-control-allow-origin response header.
 * Generic W3C standard — every cross-origin API returns this header.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin for filtering.
 * @returns SPA URL or false.
 */
/**
 * Check if a CORS header reveals a cross-domain SPA.
 * @param ep - Captured endpoint.
 * @param pageOrigin - Current page origin.
 * @returns SPA URL or false.
 */
function checkCorsHeader(ep: IDiscoveredEndpoint, pageOrigin: string): string | false {
  const cors = ep.responseHeaders['access-control-allow-origin'];
  if (!cors || cors === '*') return false;
  const corsOrigin = new URL(cors).origin;
  const epOrigin = new URL(ep.url).origin;
  const isCross = corsOrigin !== epOrigin && corsOrigin !== pageOrigin;
  if (!isCross) return false;
  LOG.debug({
    message: `SPA Tier2 (CORS): ${maskVisibleText(cors)} from ${maskVisibleText(ep.url)}`,
  });
  return cors;
}

/**
 * Tier 2: Find SPA URL from CORS allow-origin response header.
 * @param captured - All captured endpoints.
 * @param pageOrigin - Current page origin for filtering.
 * @returns SPA URL or false.
 */
function findByCorsOrigin(
  captured: readonly IDiscoveredEndpoint[],
  pageOrigin: string,
): string | false {
  const hit = captured.find((ep): boolean => checkCorsHeader(ep, pageOrigin) !== false);
  if (!hit) return false;
  return checkCorsHeader(hit, pageOrigin);
}

/**
 * Discover SPA URL from traffic — 2-tier: referer → CORS allow-origin.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin (optional).
 * @returns SPA URL or false.
 */
/** URL pattern in JSON config bodies — matches https://sub.domain.co.il paths. */
const CONFIG_URL_REGEX = /https:\/\/[\w-]+\.[\w.-]+\.\w{2,}/g;

/**
 * Tier 3: Scan captured JSON response bodies for cross-subdomain URLs.
 * Config files (config.prod.json) often contain the SPA dashboard URL.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin.
 * @returns SPA URL or false.
 */
/** Subdomains that are infrastructure, not SPA dashboards. */
const INFRA_PREFIXES = ['api.', 'connect.', 'css.', 'cdn.', 'login.'];

/**
 * Check if a URL is a candidate SPA on the same parent domain.
 * @param url - Discovered URL.
 * @param currentHost - Current page hostname.
 * @param parentDomain - Parent domain suffix.
 * @returns True if candidate SPA.
 */
function isSpaCandidate(url: string, currentHost: string, parentDomain: string): boolean {
  const host = new URL(url).hostname;
  const isSameParent = host.endsWith(parentDomain);
  const isDifferent = host !== currentHost;
  const isNotInfra = !INFRA_PREFIXES.some((p): boolean => host.startsWith(p));
  return isSameParent && isDifferent && isNotInfra;
}

/**
 * Scan a single config endpoint body for SPA URLs.
 * @param ep - Config endpoint.
 * @param currentHost - Current hostname.
 * @param parentDomain - Parent domain suffix.
 * @returns SPA URL or false.
 */
function scanConfigBody(
  ep: IDiscoveredEndpoint,
  currentHost: string,
  parentDomain: string,
): string | false {
  const body = JSON.stringify(ep.responseBody);
  const urls = body.match(CONFIG_URL_REGEX);
  if (!urls) return false;
  const hit = urls.find((u): boolean => isSpaCandidate(u, currentHost, parentDomain));
  if (!hit) return false;
  LOG.debug({
    message: `SPA Tier3 (config): ${maskVisibleText(hit)} from ${maskVisibleText(ep.url)}`,
  });
  return hit;
}

/**
 * Tier 3: Scan captured JSON config bodies for cross-subdomain URLs.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin.
 * @returns SPA URL or false.
 */
function findByConfigBody(
  captured: readonly IDiscoveredEndpoint[],
  currentOrigin: string,
): string | false {
  const currentHost = new URL(currentOrigin).hostname;
  const parentDomain = currentHost.split('.').slice(-3).join('.');
  const configEps = captured.filter(
    (ep): boolean => ep.url.includes('config') || ep.url.includes('settings'),
  );
  const hit = configEps.find(
    (ep): boolean => scanConfigBody(ep, currentHost, parentDomain) !== false,
  );
  if (!hit) return false;
  return scanConfigBody(hit, currentHost, parentDomain);
}

/**
 * Discover SPA URL — 3-tier: referer → CORS → config body scan.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin (optional).
 * @returns SPA URL or false.
 */
function discoverSpaUrlFromTraffic(
  captured: readonly IDiscoveredEndpoint[],
  currentOrigin?: string,
): string | false {
  const byReferer = findByReferer(captured);
  if (byReferer) return byReferer;
  if (!currentOrigin) return false;
  const byCors = findByCorsOrigin(captured, currentOrigin);
  if (byCors) return byCors;
  return findByConfigBody(captured, currentOrigin);
}

// ── API Origin Discovery (Pre-Emptive Forensic) ─────────────

/** URL pattern for API paths in JSON config bodies. */
const API_PATH_REGEX = /https:\/\/[^"]+\/api\//gi;

/**
 * Tier 1: Scan config body for API URLs.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
/**
 * Extract API origin from a single config endpoint body.
 * @param ep - Config endpoint.
 * @returns API origin or false.
 */
function extractApiFromBody(ep: IDiscoveredEndpoint): string | false {
  const body = JSON.stringify(ep.responseBody);
  const urls = body.match(API_PATH_REGEX);
  if (!urls || urls.length === 0) return false;
  const origin = new URL(urls[0]).origin;
  LOG.debug({
    message: `apiOrigin Tier1 (config): ${maskVisibleText(origin)} from ${maskVisibleText(ep.url)}`,
  });
  return origin;
}

/**
 * Tier 1: Scan config body for API URLs.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromConfig(captured: readonly IDiscoveredEndpoint[]): string | false {
  const configEps = captured.filter(
    (ep): boolean => ep.url.includes('config') || ep.url.includes('settings'),
  );
  const hit = configEps.find((ep): boolean => extractApiFromBody(ep) !== false);
  if (!hit) return false;
  return extractApiFromBody(hit);
}

/**
 * Tier 2: Find API origin from api.* subdomain endpoints.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromSubdomain(captured: readonly IDiscoveredEndpoint[]): string | false {
  const hit = captured.find((ep): boolean => new URL(ep.url).hostname.startsWith('api.'));
  if (!hit) return false;
  const origin = new URL(hit.url).origin;
  LOG.debug({
    message: `apiOrigin Tier2 (subdomain): ${maskVisibleText(origin)}`,
  });
  return origin;
}

/**
 * Tier 3: Find API origin from any captured POST with /api/ in URL.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromPath(captured: readonly IDiscoveredEndpoint[]): string | false {
  const hit = captured.find((ep): boolean => ep.method === 'POST' && ep.url.includes('/api/'));
  if (!hit) return false;
  const origin = new URL(hit.url).origin;
  LOG.debug({
    message: `apiOrigin Tier3 (path): ${maskVisibleText(origin)}`,
  });
  return origin;
}

/**
 * Discover API origin — 3-tier: config body → api.* subdomain → /api/ path.
 * @param captured - All captured endpoints.
 * @returns API origin URL or false.
 */
function discoverApiOriginFromTraffic(captured: readonly IDiscoveredEndpoint[]): string | false {
  const fromConfig = discoverApiFromConfig(captured);
  if (fromConfig) return fromConfig;
  const fromSubdomain = discoverApiFromSubdomain(captured);
  if (fromSubdomain) return fromSubdomain;
  return discoverApiFromPath(captured);
}

// ── Origin Utilities ────────────────────────────────────────

/**
 * Check if a header name is browser-standard (should be excluded from SPA merge).
 * @param name - Lowercase header name.
 * @returns True if standard browser header.
 */
function isBrowserStandard(name: string): boolean {
  const lower = name.toLowerCase();
  return BROWSER_STANDARD_HEADERS.has(lower);
}

/**
 * Extract SPA-specific headers from the transaction endpoint.
 * Filters out browser-standard headers, keeps custom SPA headers (SID, CID, etc.).
 * @param captured - Captured endpoints.
 * @returns SPA-specific headers or empty object.
 */
function extractSpaHeaders(captured: readonly IDiscoveredEndpoint[]): Record<string, string> {
  const txnEp = discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.transactions);
  if (!txnEp) return {};
  const entries = Object.entries(txnEp.requestHeaders);
  const spaOnly = entries.filter(([name]): boolean => !isBrowserStandard(name));
  const count = String(spaOnly.length);
  LOG.debug({ message: `spaHeaders: ${count} custom headers from txn endpoint` });
  return Object.fromEntries(spaOnly);
}

/**
 * Case-insensitive presence check: does the SPA-extracted header set
 * already carry ANY of the names in `headerNames`? Used to gate the
 * bank-specific fallback layers (Referer / X-Site-Id from
 * `discoverHeaderValue`) so they skip themselves when the captured
 * pool already provides the header — avoiding duplicate-header
 * rejection (VisaCal 401 regression, 15-05-2026 run `14093991`:
 * SCRAPE sent both `x-site-id` and `X-Site-Id` → 401 Unauthorized;
 * Hapoalim's 302 fix proved Referer needs the same guard).
 *
 * `headerNames` MUST come from WK (`REFERER_HEADERS` / `SITE_ID_HEADERS`)
 * — never hardcode literals. Captures arrive lowercase (HTTP/2 wire
 * shape); explicit overrides use mixed case; both must be observed.
 *
 * @param spaBase - SPA-extracted headers.
 * @param headerNames - WK alias list to check against (any-of).
 * @returns True when any case-variant of any listed name is present.
 */
function spaHasAny(
  spaBase: Readonly<Record<string, string>>,
  headerNames: readonly string[],
): boolean {
  const lowered = headerNames.map((n): string => n.toLowerCase());
  const targets = new Set(lowered);
  const spaKeys = Object.keys(spaBase);
  return spaKeys.some((k): boolean => {
    const keyLower = k.toLowerCase();
    return targets.has(keyLower);
  });
}

export {
  discoverApiOriginFromTraffic,
  discoverByWellKnown,
  discoverHeaderValue,
  discoverShapeAware,
  discoverSpaUrlFromTraffic,
  extractSpaHeaders,
  findCommonServicesUrl,
  spaHasAny,
};
