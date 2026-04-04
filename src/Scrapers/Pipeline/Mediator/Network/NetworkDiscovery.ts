/**
 * Network Discovery — captures API traffic from browser page.
 * Black box: observes what the page's JavaScript does, stores endpoints.
 * SCRAPE phase can replay discovered patterns with different params.
 *
 * Generic for ALL banks — no bank-specific logic.
 * Captures JSON responses from page.on('response'), ignores HTML/images/fonts.
 */

import type { Page, Response } from 'playwright-core';

import { PIPELINE_WELL_KNOWN_API } from '../../Registry/WK/ScrapeWK.js';
import type { IFetchOpts } from '../../Strategy/Fetch/FetchStrategy.js';
import { getDebug } from '../../Types/Debug.js';
import { discoverAuthThreeTier } from './AuthDiscovery.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from './NetworkDiscoveryTypes.js';

const LOG = getDebug('network-discovery');

/** Whether a content-type header indicates a JSON API response. */
type IsJsonContent = boolean;
/** Whether a header value was new (not seen before). */
type IsNew = boolean;
/** Raw URL string of a discovered endpoint. */
type EndpointUrl = string;
/** Raw HTTP POST body string. */
type PostBodyStr = string;
/** HTTP Content-Type header value. */
type ContentTypeStr = string;
/** Numeric comparator result for array sort (negative/zero/positive). */
type SortOrder = number;
/** Whether an endpoint was successfully captured and stored. */
type CaptureResult = boolean;
/** Whether a regex pattern matched a captured URL. */
type PatternTest = boolean;
/** Whether an endpoint contains a non-empty header value. */
type HeaderPresent = boolean;
/** Normalized HTTP origin string (scheme + host). */
type OriginStr = string;
/** Raw header value string extracted from a request. */
type HeaderValue = string;
/** Truncated token string for debug logging (first 12 chars + '...'). */
type TokenPreview = string;

/** WellKnown request header names for origin discovery. */
const ORIGIN_HEADERS = ['origin', 'referer'];

/** WellKnown request header names for site ID discovery. */
const SITE_ID_HEADERS = ['x-site-id', 'x-session-id'];

/** Sentinel for missing content-type header. */
const NO_CONTENT_TYPE = 'none';

/** Sentinel for missing POST body. */
const NO_POST_DATA = '';

/** Content types that may contain a JSON API response. */
const JSON_CONTENT_TYPES = ['application/json', 'text/json', 'text/plain', 'text/html'];

/**
 * Check if a content-type header indicates JSON.
 * @param contentType - The content-type header value.
 * @returns True if JSON response.
 */
function isJsonContentType(contentType: ContentTypeStr): IsJsonContent {
  const lower = contentType.toLowerCase();
  return JSON_CONTENT_TYPES.some((jsonType): IsJsonContent => lower.includes(jsonType));
}

/**
 * Extract request metadata from a Playwright response.
 * @param response - Playwright response object.
 * @returns URL, method, postData, and contentType.
 */
function extractRequestMeta(response: Response): {
  url: EndpointUrl;
  method: 'GET' | 'POST' | 'PUT';
  postData: PostBodyStr;
  contentType: ContentTypeStr;
  requestHeaders: Record<string, string>;
} {
  const headers = response.headers();
  const contentType = headers['content-type'] ?? NO_CONTENT_TYPE;
  const url = response.url();
  const method = response.request().method() as 'GET' | 'POST' | 'PUT';
  const rawPost = response.request().postData();
  const postData = rawPost ?? NO_POST_DATA;
  const requestHeaders = response.request().headers();
  return { url, method, postData, contentType, requestHeaders };
}

/**
 * Try to parse a response as a discovered endpoint.
 * @param response - Playwright response object.
 * @returns Discovered endpoint or false if not a JSON API response.
 */
async function parseResponse(response: Response): Promise<IDiscoveredEndpoint | false> {
  const meta = extractRequestMeta(response);
  if (!isJsonContentType(meta.contentType)) return false;
  try {
    const text = await response.text();
    const responseBody = JSON.parse(text) as unknown;
    const responseHeaders = response.headers();
    return { ...meta, responseHeaders, responseBody, timestamp: Date.now() };
  } catch {
    return false;
  }
}

/**
 * Extract the base URL (before query params) from a full URL.
 * @param fullUrl - Full URL with query params.
 * @returns Base URL without query string.
 */
function extractBaseUrl(fullUrl: EndpointUrl): EndpointUrl {
  const idx = fullUrl.indexOf('?');
  if (idx < 0) return fullUrl;
  return fullUrl.slice(0, idx);
}

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
  const sorted = entries.sort((a, b): SortOrder => b[1] - a[1]);
  return sorted[0]?.[0] ?? '';
}

/**
 * Handle a response event — parse and store if JSON API.
 * @param captured - Mutable array to store discovered endpoints.
 * @param response - Playwright response.
 * @returns True (always — fire-and-forget).
 */
function handleResponse(captured: IDiscoveredEndpoint[], response: Response): CaptureResult {
  const url = response.url();
  const status = response.status();
  const method = response.request().method();
  parseResponse(response)
    .then((endpoint): CaptureResult => {
      const isInteresting = method === 'POST' || url.includes('/col-rest/');
      if (!endpoint && isInteresting) {
        const ct = response.headers()['content-type'] ?? 'none';
        process.stderr.write(`    [NET] SKIP: ${method} ${url} (s=${String(status)} ct=${ct})\n`);
      }
      if (!endpoint) return false;
      captured.push(endpoint);
      const ref = endpoint.requestHeaders.referer || 'none';
      process.stderr.write(`    [NET] captured: ${endpoint.method} ${endpoint.url} (ref=${ref})\n`);
      return true;
    })
    .catch((): CaptureResult => false);
  return true;
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
  const urlMatchesPattern = (ep: IDiscoveredEndpoint, p: RegExp): PatternTest => p.test(ep.url);
  /**
   * Check if any captured endpoint URL matches a pattern.
   * @param p - Pattern to test against all captured endpoints.
   * @returns True if at least one URL matches.
   */
  const matchesAny = (p: RegExp): PatternTest =>
    captured.some((ep): PatternTest => urlMatchesPattern(ep, p));
  const match = patterns.find(matchesAny);
  if (!match) return false;
  const hit = captured.find((ep): PatternTest => match.test(ep.url));
  return hit ?? false;
}

/**
 * Discover proxy/gateway base URL from captured traffic.
 * Matches WK proxy patterns (ProxyRequestHandler, ServiceEndpoint).
 * Returns the base URL (path without query params).
 * @param captured - All captured endpoints.
 * @returns Proxy base URL or false.
 */
function discoverProxyUrl(captured: readonly IDiscoveredEndpoint[]): EndpointUrl | false {
  const hit = discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.proxy);
  if (!hit) return false;
  return extractBaseUrl(hit.url);
}

/**
 * Check if an endpoint has a non-empty value for any of the header names.
 * @param ep - Captured endpoint.
 * @param headerNames - Header names to check.
 * @returns Header value or false.
 */
function extractHeader(ep: IDiscoveredEndpoint, headerNames: readonly string[]): string | false {
  const match = headerNames.find(
    (h): HeaderPresent =>
      typeof ep.requestHeaders[h] === 'string' && ep.requestHeaders[h].length > 0,
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
  const ep = captured.find((e): HeaderPresent => extractHeader(e, headerNames) !== false);
  if (!ep) return false;
  return extractHeader(ep, headerNames);
}

/**
 * Build the low-level discovery methods bound to captured data.
 * @param captured - Mutable captured endpoints array.
 * @returns Low-level discovery methods.
 */
function buildCoreMethods(
  captured: IDiscoveredEndpoint[],
): Pick<
  INetworkDiscovery,
  'findEndpoints' | 'getServicesUrl' | 'getAllEndpoints' | 'discoverByPatterns' | 'discoverSpaUrl'
> {
  return {
    /** @inheritdoc */
    findEndpoints: (pattern: RegExp): readonly IDiscoveredEndpoint[] =>
      captured.filter((ep): PatternTest => pattern.test(ep.url)),
    /** @inheritdoc */
    getServicesUrl: (): string | false => findCommonServicesUrl(captured),
    /** @inheritdoc */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [...captured],
    /** @inheritdoc */
    discoverByPatterns: (patterns: readonly RegExp[]): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, patterns),
    /** @inheritdoc */
    discoverSpaUrl: (currentOrigin?: string): string | false =>
      discoverSpaUrlFromTraffic(captured, currentOrigin),
  };
}

/** Type alias for endpoint discovery methods. */
type EndpointMethods = Pick<
  INetworkDiscovery,
  | 'discoverAccountsEndpoint'
  | 'discoverTransactionsEndpoint'
  | 'discoverBalanceEndpoint'
  | 'discoverProxyEndpoint'
>;

/** Type alias for header discovery methods. */
type HeaderMethods = Pick<
  INetworkDiscovery,
  'discoverAuthToken' | 'discoverOrigin' | 'discoverSiteId' | 'buildDiscoveredHeaders'
>;

/**
 * Build endpoint discovery methods via WellKnown patterns.
 * @param captured - Captured endpoints array.
 * @returns Endpoint discovery methods.
 */
function buildEndpointMethods(captured: readonly IDiscoveredEndpoint[]): EndpointMethods {
  return {
    /** @inheritdoc */
    discoverAccountsEndpoint: (): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.accounts),
    /** @inheritdoc */
    discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.transactions),
    /** @inheritdoc */
    discoverBalanceEndpoint: (): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.balance),
    /** @inheritdoc */
    discoverProxyEndpoint: (): string | false => discoverProxyUrl(captured),
  };
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
  const apiEndpoint = captured.find((ep): PatternTest => {
    const isApi = apiPatterns.some((p): PatternTest => p.test(ep.url));
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
  LOG.debug('SPA Tier1 (referer): %s from %s', ref, apiEndpoint.url);
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
  LOG.debug('SPA Tier2 (CORS): %s from %s', cors, ep.url);
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
  const hit = captured.find((ep): PatternTest => checkCorsHeader(ep, pageOrigin) !== false);
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
function isSpaCandidate(url: string, currentHost: string, parentDomain: string): PatternTest {
  const host = new URL(url).hostname;
  const isSameParent = host.endsWith(parentDomain);
  const isDifferent = host !== currentHost;
  const isNotInfra = !INFRA_PREFIXES.some((p): PatternTest => host.startsWith(p));
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
  const hit = urls.find((u): PatternTest => isSpaCandidate(u, currentHost, parentDomain));
  if (!hit) return false;
  LOG.debug('SPA Tier3 (config): %s from %s', hit, ep.url);
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
    (ep): PatternTest => ep.url.includes('config') || ep.url.includes('settings'),
  );
  const hit = configEps.find(
    (ep): PatternTest => scanConfigBody(ep, currentHost, parentDomain) !== false,
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
  LOG.debug('apiOrigin Tier1 (config): %s from %s', origin, ep.url);
  return origin;
}

/**
 * Tier 1: Scan config body for API URLs.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromConfig(captured: readonly IDiscoveredEndpoint[]): string | false {
  const configEps = captured.filter(
    (ep): PatternTest => ep.url.includes('config') || ep.url.includes('settings'),
  );
  const hit = configEps.find((ep): PatternTest => extractApiFromBody(ep) !== false);
  if (!hit) return false;
  return extractApiFromBody(hit);
}

/**
 * Tier 2: Find API origin from api.* subdomain endpoints.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromSubdomain(captured: readonly IDiscoveredEndpoint[]): string | false {
  const hit = captured.find((ep): PatternTest => new URL(ep.url).hostname.startsWith('api.'));
  if (!hit) return false;
  const origin = new URL(hit.url).origin;
  LOG.debug('apiOrigin Tier2 (subdomain): %s', origin);
  return origin;
}

/**
 * Tier 3: Find API origin from any captured POST with /api/ in URL.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromPath(captured: readonly IDiscoveredEndpoint[]): string | false {
  const hit = captured.find((ep): PatternTest => ep.method === 'POST' && ep.url.includes('/api/'));
  if (!hit) return false;
  const origin = new URL(hit.url).origin;
  LOG.debug('apiOrigin Tier3 (path): %s', origin);
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

// ── Content-First Discovery ─────────────────────────────────

/**
 * Check if a JSON body contains any of the given field names.
 * Stringifies the body and checks for key presence — lightweight, no BFS.
 * @param body - Parsed JSON response body.
 * @param fieldNames - WK field names to search for.
 * @returns True if any field name found as a JSON key.
 */
function bodyHasFields(body: Record<string, string>, fieldNames: readonly string[]): PatternTest {
  const json = JSON.stringify(body);
  return fieldNames.some((f): PatternTest => json.includes(`"${f}"`));
}

/**
 * Content-First: find captured endpoint whose body contains WK field names.
 * Scans ALL captured JSON bodies — no URL matching needed.
 * @param captured - All captured endpoints.
 * @param fieldNames - WK field names (e.g. WK.accountId).
 * @returns First matching endpoint or false.
 */
function discoverByContent(
  captured: readonly IDiscoveredEndpoint[],
  fieldNames: readonly string[],
): IDiscoveredEndpoint | false {
  const hit = captured.find((ep): PatternTest => {
    if (!ep.responseBody) return false;
    return bodyHasFields(ep.responseBody as Record<string, string>, fieldNames);
  });
  if (!hit) return false;
  LOG.debug('Content discovery: found field in %s', hit.url);
  return hit;
}

// ── Origin Utilities ────────────────────────────────────────

/**
 * Extract bare origin (scheme+host) from a URL or origin string.
 * @param raw - URL or origin, possibly with path/query.
 * @returns Clean origin like "https://example.com".
 */
function extractOriginOnly(raw: OriginStr): OriginStr {
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
}

/** Login/connect domains that are unlikely to be the correct API origin. */
const LOGIN_DOMAIN_PATTERNS = [/connect\./i, /login\./i, /col-rest/i];

/** A header value paired with the URL of the endpoint it came from. */
interface ISourcedValue {
  readonly value: HeaderValue;
  readonly sourceUrl: EndpointUrl;
}

/**
 * Collect all unique header values paired with their source endpoint URL.
 * @param captured - All captured endpoints.
 * @param headerNames - Header names to search.
 * @returns Deduplicated values with source URLs.
 */
function collectSourcedValues(
  captured: readonly IDiscoveredEndpoint[],
  headerNames: readonly string[],
): readonly ISourcedValue[] {
  const seen = new Set<string>();
  const result: ISourcedValue[] = [];
  /**
   * Process one endpoint — extract header, dedup, collect.
   * @param ep - Discovered endpoint.
   * @returns True if value was new.
   */
  const processOne = (ep: IDiscoveredEndpoint): IsNew => {
    const val = extractHeader(ep, headerNames);
    if (val === false || seen.has(val)) return false;
    seen.add(val);
    result.push({ value: val, sourceUrl: ep.url });
    return true;
  };
  captured.forEach(processOne);
  return result;
}

/**
 * Pick best value: prefer values from non-login endpoints (SPA/API domain).
 * @param sourced - Values with source URLs.
 * @returns Best value or false.
 */
function pickBestValue(sourced: readonly ISourcedValue[]): string | false {
  if (sourced.length === 0) return false;
  if (sourced.length === 1) return sourced[0].value;
  const nonLogin = sourced.find(
    (s): PatternTest => !LOGIN_DOMAIN_PATTERNS.some((p): PatternTest => p.test(s.sourceUrl)),
  );
  return nonLogin?.value ?? sourced[0].value;
}

/**
 * Format a token for debug logging (first 12 chars + ellipsis, or 'NONE').
 * @param token - Auth token or false.
 * @returns Truncated token string.
 */
function formatTokenPreview(token: HeaderValue | false): TokenPreview {
  if (!token) return 'NONE';
  return token.slice(0, 12) + '...';
}

/**
 * Resolve the best origin from captured traffic.
 * @param captured - Captured endpoints.
 * @returns Clean origin string or false.
 */
function resolveOrigin(captured: readonly IDiscoveredEndpoint[]): string | false {
  const sourced = collectSourcedValues(captured, ORIGIN_HEADERS);
  const rawOrigin = pickBestValue(sourced);
  if (!rawOrigin) return false;
  return extractOriginOnly(rawOrigin);
}

/**
 * Assemble discovered headers into an IFetchOpts object.
 * @param captured - Captured endpoints.
 * @param page - Playwright page for auth fallback.
 * @returns IFetchOpts with auth, origin, site-id.
 */
async function assembleDiscoveredHeaders(
  captured: readonly IDiscoveredEndpoint[],
  page: Page,
): Promise<IFetchOpts> {
  const extraHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  const auth = await discoverAuthThreeTier(captured, page);
  if (auth) extraHeaders.authorization = auth;
  const origin = resolveOrigin(captured);
  if (origin) extraHeaders.Origin = origin;
  if (origin) extraHeaders.Referer = origin;
  const sourcedSiteIds = collectSourcedValues(captured, SITE_ID_HEADERS);
  const siteId = pickBestValue(sourcedSiteIds);
  if (siteId) extraHeaders['X-Site-Id'] = siteId;
  const originLabel = origin || 'NONE';
  const siteIdLabel = siteId || 'NONE';
  const authLabel = formatTokenPreview(auth);
  LOG.debug('discoveredHeaders: auth=%s origin=%s siteId=%s', authLabel, originLabel, siteIdLabel);
  return { extraHeaders };
}

/**
 * Build header discovery methods from captured request headers.
 * @param captured - Captured endpoints array.
 * @param page - Playwright page for auth fallback.
 * @returns Header discovery methods.
 */
function buildHeaderMethods(captured: readonly IDiscoveredEndpoint[], page: Page): HeaderMethods {
  return {
    /** @inheritdoc */
    discoverAuthToken: (): Promise<string | false> => discoverAuthThreeTier(captured, page),
    /** @inheritdoc */
    discoverOrigin: (): string | false => discoverHeaderValue(captured, ORIGIN_HEADERS),
    /** @inheritdoc */
    discoverSiteId: (): string | false => discoverHeaderValue(captured, SITE_ID_HEADERS),
    /** @inheritdoc */
    buildDiscoveredHeaders: (): Promise<IFetchOpts> => assembleDiscoveredHeaders(captured, page),
  };
}

/** WellKnown transaction URL query params for full history. */
const FULL_TXN_PARAMS = [
  'IsCategoryDescCode=True',
  'IsTransactionDetails=True',
  'IsEventNames=True',
  'IsFutureTransactionFlag=True',
];

/**
 * Find a captured URL containing the given account ID.
 * @param captured - Captured endpoints.
 * @param accountId - Account ID to search for in URLs.
 * @returns First matching endpoint or false.
 */
function findUrlWithAccountId(
  captured: readonly IDiscoveredEndpoint[],
  accountId: string,
): IDiscoveredEndpoint | false {
  const hit = captured.find((ep): PatternTest => ep.url.includes(accountId));
  return hit ?? false;
}

/**
 * Extract the API base from a captured URL (before the account-specific path).
 * @param url - Full URL with account ID.
 * @param accountId - Account ID to split on.
 * @returns Base URL or false.
 */
function extractApiBaseFromUrl(url: string, accountId: string): string | false {
  const parts = url.split(accountId);
  if (parts.length < 2) return false;
  const base = parts[0].replace(/\/lastTransactions.*/, '').replace(/\/accountDetails.*/, '');
  return base;
}

/**
 * Build a full transaction URL from discovered API base + account ID + date.
 * @param captured - Captured endpoints.
 * @param accountId - Account number.
 * @param startDate - Formatted start date.
 * @returns Full transaction URL or false.
 */
function buildTxnUrlFromTraffic(
  captured: readonly IDiscoveredEndpoint[],
  accountId: string,
  startDate: string,
): string | false {
  const hit = findUrlWithAccountId(captured, accountId);
  if (!hit) return false;
  const base = extractApiBaseFromUrl(hit.url, accountId);
  if (!base) return false;
  const params = [...FULL_TXN_PARAMS, `FromDate=${startDate}`].join('&');
  return `${base}/lastTransactions/${accountId}/Date?${params}`;
}

/**
 * Build a balance URL from discovered traffic pattern.
 * @param captured - Captured endpoints.
 * @param accountId - Account number.
 * @returns Balance URL or false.
 */
function buildBalUrlFromTraffic(
  captured: readonly IDiscoveredEndpoint[],
  accountId: string,
): string | false {
  const balanceHits = captured.filter(
    (ep): PatternTest => PIPELINE_WELL_KNOWN_API.balance.some((p): PatternTest => p.test(ep.url)),
  );
  if (balanceHits.length === 0) return false;
  const templateUrl = balanceHits[0].url;
  const pathOnly = templateUrl.split('?')[0];
  const segments = pathOnly.split('/');
  const lastSeg = segments[segments.length - 1];
  const isAccountInUrl = /^\d{5,}$/.test(lastSeg);
  if (isAccountInUrl) {
    segments[segments.length - 1] = accountId;
    return segments.join('/');
  }
  return `${pathOnly}/${accountId}`;
}

/**
 * Check if any captured endpoint matches the patterns.
 * @param captured - Live captured endpoints.
 * @param patterns - WellKnown regex patterns.
 * @returns First matching endpoint or false.
 */
function findTrafficHit(
  captured: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): IDiscoveredEndpoint | false {
  const hit = captured.find(
    (ep): PatternTest =>
      ep.responseBody !== undefined &&
      ep.responseBody !== null &&
      patterns.some((p): PatternTest => p.test(ep.url)),
  );
  return hit ?? false;
}

/** Bundled args for traffic waiting. */
interface ITrafficWaitArgs {
  readonly page: Page;
  readonly captured: readonly IDiscoveredEndpoint[];
  readonly patterns: readonly RegExp[];
}

/**
 * Wait for a response matching WellKnown patterns via Playwright.
 * Non-polling: uses Playwright's native event-driven response matching.
 * @param args - Page, captured endpoints, and patterns.
 * @param timeoutMs - Max wait time.
 * @returns First matching endpoint or false on timeout.
 */
async function awaitTraffic(
  args: ITrafficWaitArgs,
  timeoutMs: number,
): Promise<IDiscoveredEndpoint | false> {
  const immediate = findTrafficHit(args.captured, args.patterns);
  if (immediate) return immediate;
  /**
   * Match response URL against WellKnown patterns.
   * @param r - Playwright response.
   * @returns True if URL matches.
   */
  const matchUrl = (r: Response): PatternTest => {
    const url = r.url();
    return args.patterns.some((p): PatternTest => p.test(url));
  };
  await args.page.waitForResponse(matchUrl, { timeout: timeoutMs }).catch((): false => false);
  return findTrafficHit(args.captured, args.patterns);
}

/**
 * Create a network discovery instance bound to a page.
 * Starts capturing immediately on creation.
 * @param page - Playwright page to observe.
 * @returns Network discovery interface.
 */
/** Timeout for fire-and-forget POST interceptor (ms). */
const POST_INTERCEPT_TIMEOUT = 120_000;

/**
 * Intercept POST responses matching WellKnown patterns from any frame.
 * `page.waitForResponse` captures cross-origin iframe traffic that
 * `page.on('response')` misses. Generic for all banks.
 * @param page - Playwright page.
 * @param captured - Mutable captured endpoints array.
 * @returns True (fire-and-forget).
 */
function interceptPostResponses(page: Page, captured: IDiscoveredEndpoint[]): CaptureResult {
  const allPatterns = [
    ...PIPELINE_WELL_KNOWN_API.auth,
    ...PIPELINE_WELL_KNOWN_API.transactions,
    ...PIPELINE_WELL_KNOWN_API.accounts,
    ...PIPELINE_WELL_KNOWN_API.balance,
  ];
  /**
   * Match POST requests against WellKnown patterns.
   * @param r - Playwright response.
   * @returns True if POST + URL matches.
   */
  /**
   * Match POST/PUT requests against WellKnown patterns.
   * @param r - Playwright response.
   * @returns True if API method + URL matches.
   */
  const isWkApi = (r: Response): PatternTest => {
    const method = r.request().method();
    const isApiMethod = method === 'POST' || method === 'PUT';
    const url = r.url();
    return isApiMethod && allPatterns.some((p): PatternTest => p.test(url));
  };
  page
    .waitForResponse(isWkApi, { timeout: POST_INTERCEPT_TIMEOUT })
    .then(async (resp): Promise<CaptureResult> => {
      const endpoint = await parseResponse(resp);
      if (!endpoint) return false;
      const isDupe = captured.some((ep): PatternTest => ep.url === endpoint.url);
      if (isDupe) return false;
      captured.push(endpoint);
      process.stderr.write(`    [NET] intercepted POST: ${endpoint.url}\n`);
      return true;
    })
    .catch((): CaptureResult => false);
  return true;
}

/**
 * Create a network discovery instance bound to a page.
 * Starts capturing immediately on creation.
 * @param page - Playwright page to observe.
 * @returns Network discovery interface.
 */
function createNetworkDiscovery(page: Page): INetworkDiscovery {
  const captured: IDiscoveredEndpoint[] = [];
  page.on('response', (r: Response): CaptureResult => handleResponse(captured, r));
  interceptPostResponses(page, captured);
  const core = buildCoreMethods(captured);
  const endpoints = buildEndpointMethods(captured);
  const headers = buildHeaderMethods(captured, page);
  const urlBuilders = {
    /** @inheritdoc */
    buildTransactionUrl: (accountId: string, startDate: string): string | false =>
      buildTxnUrlFromTraffic(captured, accountId, startDate),
    /** @inheritdoc */
    buildBalanceUrl: (accountId: string): string | false =>
      buildBalUrlFromTraffic(captured, accountId),
  };
  const traffic = {
    /** @inheritdoc */
    waitForTraffic: (
      patterns: readonly RegExp[],
      timeoutMs: number,
    ): Promise<IDiscoveredEndpoint | false> =>
      awaitTraffic({ page, captured, patterns }, timeoutMs),
  };
  const authState = { cached: false as string | false };
  /**
   * Discover auth with cache support.
   * @returns Token or false.
   */
  const cachedDiscoverAuth = async (): Promise<string | false> => {
    if (authState.cached) return authState.cached;
    return discoverAuthThreeTier(captured, page);
  };
  const authCache = {
    /** @inheritdoc */
    cacheAuthToken: async (): Promise<string | false> => {
      const token = await discoverAuthThreeTier(captured, page);
      if (token) {
        authState.cached = token;
        process.stderr.write(`    [NET] auth cached: ${token.slice(0, 20)}...\n`);
      }
      return authState.cached;
    },
    /** @inheritdoc */
    discoverAuthToken: cachedDiscoverAuth,
    /**
     * Build headers with cached auth.
     * @returns Fetch options with auth + origin + site-id.
     */
    buildDiscoveredHeaders: async (): Promise<IFetchOpts> => {
      const extraHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      const auth = await cachedDiscoverAuth();
      if (auth) extraHeaders.authorization = auth;
      const origin = headers.discoverOrigin();
      if (origin) extraHeaders.Origin = origin;
      if (origin) extraHeaders.Referer = origin;
      const siteId = headers.discoverSiteId();
      if (siteId) extraHeaders['X-Site-Id'] = siteId;
      return { extraHeaders };
    },
  };
  const apiOrigin = {
    /** @inheritdoc */
    discoverApiOrigin: (): string | false => discoverApiOriginFromTraffic(captured),
  };
  const contentScan = {
    /** @inheritdoc */
    discoverEndpointByContent: (fieldNames: readonly string[]): IDiscoveredEndpoint | false =>
      discoverByContent(captured, fieldNames),
  };
  const base = { ...core, ...endpoints, ...headers, ...urlBuilders };
  return { ...base, ...traffic, ...authCache, ...apiOrigin, ...contentScan };
}

export { distillHeaders } from '../Elements/HeaderDistillation.js';
export type { IDiscoveredEndpoint, INetworkDiscovery } from './NetworkDiscoveryTypes.js';
export { createNetworkDiscovery };
