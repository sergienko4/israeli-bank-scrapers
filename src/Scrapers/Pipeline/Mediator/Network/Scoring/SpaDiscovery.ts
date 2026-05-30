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
import { redactUrlFull } from '../../../Types/PiiRedactor.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import { isConfigOrSettingsUrl } from './ConfigUrlMatcher.js';
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
 * Emit the structured Tier 1 referer-discovery log line. Returns
 * `true` so the caller can chain without a `void`-typed helper.
 * @param ref - Discovered referer.
 * @param epUrl - Captured endpoint URL.
 * @returns Always true.
 */
function logTier1Referer(ref: string, epUrl: string): true {
  LOG.debug({
    message: `SPA Tier1 (referer): ${redactUrlFull(ref)} ` + `from ${redactUrlFull(epUrl)}`,
  });
  return true;
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
  logTier1Referer(ref, apiEndpoint.url);
  return ref;
}

/**
 * Resolve whether a CORS header truly reveals a cross-domain SPA.
 * Pulled out of {@link checkCorsHeader} so the parser fits the cap.
 * @param cors - Access-Control-Allow-Origin header.
 * @param epUrl - Captured endpoint URL.
 * @param pageOrigin - Current page origin.
 * @returns True when `cors` is a cross-domain SPA URL.
 */
function isCorsCrossDomainSpa(cors: string, epUrl: string, pageOrigin: string): boolean {
  const corsParsed = safeParseWindowUrl(cors);
  const epParsed = safeParseWindowUrl(epUrl);
  if (corsParsed === false || epParsed === false) return false;
  return corsParsed.origin !== epParsed.origin && corsParsed.origin !== pageOrigin;
}

/**
 * Emit the structured Tier 2 CORS-discovery log line.
 * @param cors - Discovered CORS allow-origin.
 * @param epUrl - Captured endpoint URL.
 * @returns Always true.
 */
function logTier2Cors(cors: string, epUrl: string): true {
  LOG.debug({
    message: `SPA Tier2 (CORS): ${redactUrlFull(cors)} from ${redactUrlFull(epUrl)}`,
  });
  return true;
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
  if (!isCorsCrossDomainSpa(cors, ep.url, pageOrigin)) return false;
  return cors;
}

/**
 * Tier 2 — find SPA URL from CORS allow-origin response header.
 * Emits the structured `logTier2Cors` line once for the winner so the
 * trace count matches a single decision (CR PR #280 #130).
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
  const cors = checkCorsHeader(hit, pageOrigin);
  if (cors !== false) logTier2Cors(cors, hit.url);
  return cors;
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
 * Emit the structured Tier 3 config-body discovery log line.
 * @param hit - Discovered SPA URL inside the config body.
 * @param epUrl - Config endpoint URL.
 * @returns Always true.
 */
function logTier3Config(hit: string, epUrl: string): true {
  LOG.debug({
    message: `SPA Tier3 (config): ${redactUrlFull(hit)} from ${redactUrlFull(epUrl)}`,
  });
  return true;
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
  return hit;
}

/**
 * Resolve scan args (currentHost + parentDomain) from the page origin.
 * Pulled out of {@link findByConfigBody} so the orchestrator fits cap.
 * @param currentOrigin - Current page origin.
 * @returns Bundled scan args or false on parse failure.
 */
function resolveScanArgs(currentOrigin: string): IScanArgs | false {
  const parsedOrigin = safeParseWindowUrl(currentOrigin);
  if (parsedOrigin === false) return false;
  const currentHost = parsedOrigin.hostname;
  const parentDomain = currentHost.split('.').slice(-3).join('.');
  return { currentHost, parentDomain };
}

/**
 * Pick the first config endpoint whose body yields a Tier 3 SPA hit.
 * Pulled out of {@link findByConfigBody} so the orchestrator stays
 * within the 10-LoC cap.
 * @param captured - All captured endpoints.
 * @param scan - Bundled current host + parent domain.
 * @returns SPA URL or false.
 */
function pickConfigHit(captured: readonly IDiscoveredEndpoint[], scan: IScanArgs): string | false {
  const configEps = captured.filter((ep): boolean => isConfigOrSettingsUrl(ep.url));
  const hit = configEps.find((ep): boolean => scanConfigBody(ep, scan) !== false);
  if (!hit) return false;
  const spaUrl = scanConfigBody(hit, scan);
  if (spaUrl !== false) logTier3Config(spaUrl, hit.url);
  return spaUrl;
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
  const scan = resolveScanArgs(currentOrigin);
  if (scan === false) return false;
  return pickConfigHit(captured, scan);
}

/**
 * Tier 2 → 3 cascade — CORS-then-config fallback. Pulled out of
 * {@link discoverSpaUrlFromTraffic} so the orchestrator fits the cap.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin.
 * @returns SPA URL or false.
 */
function cascadeCorsThenConfig(
  captured: readonly IDiscoveredEndpoint[],
  currentOrigin: string,
): string | false {
  const byCors = findByCorsOrigin(captured, currentOrigin);
  if (byCors) return byCors;
  return findByConfigBody(captured, currentOrigin);
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
  return cascadeCorsThenConfig(captured, currentOrigin);
}

export default discoverSpaUrlFromTraffic;
