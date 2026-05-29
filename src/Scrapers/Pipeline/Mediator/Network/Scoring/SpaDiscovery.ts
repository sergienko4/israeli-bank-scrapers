/**
 * Network Scoring / SpaDiscovery — 3-tier SPA URL discovery from
 * captured traffic. Extracted from `Scoring.ts` (PR #276 review) to
 * fit Section 11's 150 LoC cap.
 *
 *   • Tier 1: cross-domain referer on a WK-API endpoint.
 *   • Tier 2: CORS `access-control-allow-origin` response header.
 *   • Tier 3: scan JSON config bodies for cross-subdomain URLs.
 *
 * Every URL parse routes through {@link safeParseWindowUrl} per
 * CR PR #276 #9 — malformed referer / CORS / config bodies sent by
 * banks no longer crash the discovery tier.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import safeParseWindowUrl from './SafeUrl.js';

const LOG = getDebug(import.meta.url);

/** Bundled WK-API patterns considered "API endpoints" for SPA discovery. */
const SPA_API_PATTERNS = [
  ...PIPELINE_WELL_KNOWN_API.transactions,
  ...PIPELINE_WELL_KNOWN_API.accounts,
  ...PIPELINE_WELL_KNOWN_API.balance,
  ...PIPELINE_WELL_KNOWN_API.auth,
];

/**
 * Decide whether the endpoint qualifies as a cross-domain SPA→API
 * call (Tier 1 input). Both URL parses go through
 * {@link safeParseWindowUrl} per CR #9.
 * @param ep - Captured endpoint.
 * @returns True when the referer's origin differs from the endpoint's.
 */
function isCrossDomainApiCall(ep: IDiscoveredEndpoint): boolean {
  const isApi = SPA_API_PATTERNS.some((p): boolean => p.test(ep.url));
  if (!isApi) return false;
  const referer = ep.requestHeaders.referer;
  if (!referer) return false;
  const epParsed = safeParseWindowUrl(ep.url);
  const refParsed = safeParseWindowUrl(referer);
  if (epParsed === false || refParsed === false) return false;
  return epParsed.origin !== refParsed.origin;
}

/**
 * Tier 1 — find SPA URL from cross-domain referer header.
 * @param captured - All captured endpoints.
 * @returns SPA URL or false.
 */
function findByReferer(captured: readonly IDiscoveredEndpoint[]): string | false {
  const apiEndpoint = captured.find(isCrossDomainApiCall);
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
 * Check if a CORS header reveals a cross-domain SPA. CR #9 guards
 * both `cors` and `ep.url` parses.
 * @param ep - Captured endpoint.
 * @param pageOrigin - Current page origin.
 * @returns SPA URL or false.
 */
function checkCorsHeader(ep: IDiscoveredEndpoint, pageOrigin: string): string | false {
  const cors = ep.responseHeaders['access-control-allow-origin'];
  if (!cors || cors === '*') return false;
  const corsParsed = safeParseWindowUrl(cors);
  const epParsed = safeParseWindowUrl(ep.url);
  if (corsParsed === false || epParsed === false) return false;
  const isCross = corsParsed.origin !== epParsed.origin && corsParsed.origin !== pageOrigin;
  if (!isCross) return false;
  LOG.debug({
    message: `SPA Tier2 (CORS): ${maskVisibleText(cors)} from ${maskVisibleText(ep.url)}`,
  });
  return cors;
}

/**
 * Tier 2 — find SPA URL from CORS allow-origin response header.
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

/** URL pattern in JSON config bodies — matches `https://sub.domain.co.il` paths. */
const CONFIG_URL_REGEX = /https:\/\/[\w-]+\.[\w.-]+\.\w{2,}/g;

/** Subdomains that are infrastructure, not SPA dashboards. */
const INFRA_PREFIXES = ['api.', 'connect.', 'css.', 'cdn.', 'login.'];

/**
 * Check if a URL is a candidate SPA on the same parent domain. CR #9
 * guards the URL parse.
 * @param url - Discovered URL.
 * @param currentHost - Current page hostname.
 * @param parentDomain - Parent domain suffix.
 * @returns True if candidate SPA.
 */
function isSpaCandidate(url: string, currentHost: string, parentDomain: string): boolean {
  const parsed = safeParseWindowUrl(url);
  if (parsed === false) return false;
  const host = parsed.hostname;
  const isSameParent = host.endsWith(parentDomain);
  const isDifferent = host !== currentHost;
  const isNotInfra = !INFRA_PREFIXES.some((p): boolean => host.startsWith(p));
  return isSameParent && isDifferent && isNotInfra;
}

/** Bundled scan args — keeps `scanConfigBody` under the 3-param cap. */
interface IScanArgs {
  readonly currentHost: string;
  readonly parentDomain: string;
}

/**
 * Scan a single config endpoint body for SPA URLs.
 * @param ep - Config endpoint.
 * @param scan - Current host + parent domain.
 * @returns SPA URL or false.
 */
function scanConfigBody(ep: IDiscoveredEndpoint, scan: IScanArgs): string | false {
  const body = JSON.stringify(ep.responseBody);
  const urls = body.match(CONFIG_URL_REGEX);
  if (!urls) return false;
  const hit = urls.find((u): boolean => isSpaCandidate(u, scan.currentHost, scan.parentDomain));
  if (!hit) return false;
  LOG.debug({
    message: `SPA Tier3 (config): ${maskVisibleText(hit)} from ${maskVisibleText(ep.url)}`,
  });
  return hit;
}

/**
 * Tier 3 — scan captured JSON config bodies for cross-subdomain URLs.
 * CR #9 guards the `currentOrigin` parse.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin.
 * @returns SPA URL or false.
 */
function findByConfigBody(
  captured: readonly IDiscoveredEndpoint[],
  currentOrigin: string,
): string | false {
  const parsedOrigin = safeParseWindowUrl(currentOrigin);
  if (parsedOrigin === false) return false;
  const currentHost = parsedOrigin.hostname;
  const parentDomain = currentHost.split('.').slice(-3).join('.');
  const scan: IScanArgs = { currentHost, parentDomain };
  const configEps = captured.filter(
    (ep): boolean => ep.url.includes('config') || ep.url.includes('settings'),
  );
  const hit = configEps.find((ep): boolean => scanConfigBody(ep, scan) !== false);
  if (!hit) return false;
  return scanConfigBody(hit, scan);
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

export default discoverSpaUrlFromTraffic;
