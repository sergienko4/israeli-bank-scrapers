/**
 * Network Scoring / ApiOriginDiscovery — 3-tier pre-emptive forensic
 * for the bank's API origin URL. Extracted from `Scoring.ts`
 * (PR #276 review) to fit Section 11's 150 LoC cap.
 *
 *   • Tier 1: scan JSON config bodies for `https://…/api/` URLs.
 *   • Tier 2: `api.*` subdomain on any captured endpoint.
 *   • Tier 3: POST to any URL containing `/api/`.
 *
 * Every URL parse routes through {@link safeParseWindowUrl} per
 * CR PR #276 #9.
 */

import { getDebug } from '../../../Types/Debug.js';
import { redactUrlFull } from '../../../Types/PiiRedactor.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import { isConfigOrSettingsUrl } from './ConfigUrlMatcher.js';
import safeParseWindowUrl from './SafeUrl.js';

const LOG = getDebug(import.meta.url);

/** URL pattern for API paths in JSON config bodies. */
const API_PATH_REGEX = /https:\/\/[^"]+\/api\//gi;

/**
 * Log the Tier 1 (config) origin discovery event. Pulled out of
 * {@link extractApiFromBody} so the parser fits the 10-LoC cap.
 * @param origin - Discovered origin.
 * @param epUrl - Source endpoint URL.
 * @returns Always true.
 */
function logTier1ConfigOrigin(origin: string, epUrl: string): true {
  LOG.debug({
    message: `apiOrigin Tier1 (config): ${redactUrlFull(origin)} from ${redactUrlFull(epUrl)}`,
  });
  return true;
}

/**
 * Extract API origin from a single config endpoint body. CR #9 guards
 * the URL parse.
 * @param ep - Config endpoint.
 * @returns API origin or false.
 */
function extractApiFromBody(ep: IDiscoveredEndpoint): string | false {
  const body = JSON.stringify(ep.responseBody);
  const urls = body.match(API_PATH_REGEX);
  if (!urls || urls.length === 0) return false;
  const parsed = safeParseWindowUrl(urls[0]);
  if (parsed === false) return false;
  const origin = parsed.origin;
  logTier1ConfigOrigin(origin, ep.url);
  return origin;
}

/**
 * Tier 1 — scan config body for API URLs.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromConfig(captured: readonly IDiscoveredEndpoint[]): string | false {
  const configEps = captured.filter((ep): boolean => isConfigOrSettingsUrl(ep.url));
  const hit = configEps.find((ep): boolean => extractApiFromBody(ep) !== false);
  if (!hit) return false;
  return extractApiFromBody(hit);
}

/**
 * Predicate — true when the endpoint's host starts with `api.`.
 * CR #9 guards the URL parse.
 * @param ep - Captured endpoint.
 * @returns True when the hostname starts with `api.`.
 */
function hasApiSubdomain(ep: IDiscoveredEndpoint): boolean {
  const parsed = safeParseWindowUrl(ep.url);
  if (parsed === false) return false;
  return parsed.hostname.startsWith('api.');
}

/**
 * Tier 2 — find API origin from `api.*` subdomain endpoints. CR #9
 * guards the origin parse.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromSubdomain(captured: readonly IDiscoveredEndpoint[]): string | false {
  const hit = captured.find(hasApiSubdomain);
  if (!hit) return false;
  const parsed = safeParseWindowUrl(hit.url);
  if (parsed === false) return false;
  const origin = parsed.origin;
  LOG.debug({ message: `apiOrigin Tier2 (subdomain): ${redactUrlFull(origin)}` });
  return origin;
}

/**
 * Tier 3 — find API origin from any captured POST with `/api/` in URL.
 * CR #9 guards the origin parse.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromPath(captured: readonly IDiscoveredEndpoint[]): string | false {
  const hit = captured.find((ep): boolean => ep.method === 'POST' && ep.url.includes('/api/'));
  if (!hit) return false;
  const parsed = safeParseWindowUrl(hit.url);
  if (parsed === false) return false;
  const origin = parsed.origin;
  LOG.debug({ message: `apiOrigin Tier3 (path): ${redactUrlFull(origin)}` });
  return origin;
}

/**
 * Discover API origin — 3-tier: config body → `api.*` subdomain →
 * `/api/` path.
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

export default discoverApiOriginFromTraffic;
