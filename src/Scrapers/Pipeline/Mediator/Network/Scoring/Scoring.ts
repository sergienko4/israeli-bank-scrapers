/**
 * Network Scoring — endpoint-pool scorers + pickers. Pure functions
 * over a captured pool; no side effects on Playwright `Page` and no
 * cross-talk with the discovery facade.
 *
 *   • Header probes (`discoverHeaderValue`,
 *     `extractSpaHeaders` / `spaHasAny`).
 *   • `findCommonServicesUrl` — base-URL frequency picker.
 *   • `discoverByWellKnown` — first-match URL pattern picker.
 *   • Re-exports `discoverShapeAware` (from {@link ./ShapeAware.js}),
 *     `discoverSpaUrlFromTraffic` (from {@link ./SpaDiscovery.js})
 *     and `discoverApiOriginFromTraffic` (from
 *     {@link ./ApiOriginDiscovery.js}) so the public surface stays a
 *     single import path.
 *
 * Extracted from NetworkDiscovery.ts (Phase 4 commit 4/9). Split into
 * Scoring + SafeUrl + SpaDiscovery + ApiOriginDiscovery + ShapeAware
 * per PR #276 review-fix (CR #9 / Section 11 LoC cap).
 */

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../../Types/Debug.js';
import { BROWSER_STANDARD_HEADERS, extractBaseUrl } from '../Indexing/Indexing.js';
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
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const entries = [...counts.entries()];
  entries.sort((a, b): number => b[1] - a[1]);
  return entries[0]?.[0] ?? '';
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
   * Pattern-to-pool match check used by {@link Array.prototype.find}.
   * @param p - Candidate pattern.
   * @returns True when any captured endpoint matches the pattern.
   */
  const isMatched = (p: RegExp): boolean => captured.some((ep): boolean => p.test(ep.url));
  const match = patterns.find(isMatched);
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
  LOG.debug({ message: `spaHeaders: ${String(spaOnly.length)} custom headers from txn endpoint` });
  return Object.fromEntries(spaOnly);
}

/**
 * Case-insensitive presence check: does the SPA-extracted header set
 * already carry ANY of the names in `headerNames`? Used to gate the
 * bank-specific fallback layers (Referer / X-Site-Id from
 * `discoverHeaderValue`) so they skip themselves when the captured
 * pool already provides the header.
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
  const keys = Object.keys(spaBase);
  /**
   * True when the lowercased key is in the target set.
   * @param k - SPA header key.
   * @returns True on case-insensitive hit.
   */
  const isTargetKey = (k: string): boolean => {
    const lower = k.toLowerCase();
    return targets.has(lower);
  };
  return keys.some(isTargetKey);
}

export { default as discoverApiOriginFromTraffic } from './ApiOriginDiscovery.js';
export { default as discoverShapeAware } from './ShapeAware.js';
export { default as discoverSpaUrlFromTraffic } from './SpaDiscovery.js';

export {
  discoverByWellKnown,
  discoverHeaderValue,
  extractSpaHeaders,
  findCommonServicesUrl,
  spaHasAny,
};
