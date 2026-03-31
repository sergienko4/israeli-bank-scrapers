/**
 * Network Discovery — captures API traffic from browser page.
 * Black box: observes what the page's JavaScript does, stores endpoints.
 * SCRAPE phase can replay discovered patterns with different params.
 *
 * Generic for ALL banks — no bank-specific logic.
 * Captures JSON responses from page.on('response'), ignores HTML/images/fonts.
 */

import type { Page, Response } from 'playwright-core';

import { PIPELINE_WELL_KNOWN_API } from '../Registry/WK/ScrapeWK.js';
import type { IFetchOpts } from '../Strategy/FetchStrategy.js';
import { getDebug } from '../Types/Debug.js';
import { discoverAuthThreeTier } from './AuthDiscovery.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from './NetworkDiscoveryTypes.js';

const LOG = getDebug('network-discovery');

/** Whether a content-type header indicates a JSON API response. */
type IsJsonContent = boolean;
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
  method: 'GET' | 'POST';
  postData: PostBodyStr;
  contentType: ContentTypeStr;
  requestHeaders: Record<string, string>;
} {
  const headers = response.headers();
  const contentType = headers['content-type'] ?? NO_CONTENT_TYPE;
  const url = response.url();
  const method = response.request().method() as 'GET' | 'POST';
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
    return { ...meta, responseBody, timestamp: Date.now() };
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
  parseResponse(response)
    .then((endpoint): CaptureResult => {
      if (!endpoint) return false;
      captured.push(endpoint);
      LOG.debug('captured: %s %s', endpoint.method, endpoint.url);
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
    discoverSpaUrl: (): string | false => discoverSpaUrlFromTraffic(captured),
  };
}

/** Type alias for endpoint discovery methods. */
type EndpointMethods = Pick<
  INetworkDiscovery,
  'discoverAccountsEndpoint' | 'discoverTransactionsEndpoint' | 'discoverBalanceEndpoint'
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
  };
}

/**
 * Discover the SPA URL from captured API traffic.
 * Finds a captured endpoint on an API domain and extracts its referer header.
 * The referer is the SPA page that made the API call.
 * @param captured - All captured endpoints.
 * @returns SPA URL or false.
 */
function discoverSpaUrlFromTraffic(captured: readonly IDiscoveredEndpoint[]): string | false {
  // Find an API endpoint (matches txn/accounts WellKnown) whose referer is a DIFFERENT domain
  const apiPatterns = [
    ...PIPELINE_WELL_KNOWN_API.transactions,
    ...PIPELINE_WELL_KNOWN_API.accounts,
    ...PIPELINE_WELL_KNOWN_API.balance,
  ];
  const apiEndpoint = captured.find((ep): PatternTest => {
    const isApiEndpoint = apiPatterns.some((p): PatternTest => p.test(ep.url));
    if (!isApiEndpoint) return false;
    const referer = ep.requestHeaders.referer;
    if (!referer) return false;
    const epOrigin = new URL(ep.url).origin;
    const refOrigin = new URL(referer).origin;
    return epOrigin !== refOrigin;
  });
  if (!apiEndpoint) return false;
  const discoveredReferer = apiEndpoint.requestHeaders.referer;
  if (!discoveredReferer) return false;
  return discoveredReferer;
}

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
  return captured.reduce<ISourcedValue[]>((result, ep): ISourcedValue[] => {
    const val = extractHeader(ep, headerNames);
    if (val === false || seen.has(val)) return result;
    seen.add(val);
    return [...result, { value: val, sourceUrl: ep.url }];
  }, []);
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
 * Create a network discovery instance bound to a page.
 * Starts capturing immediately on creation.
 * @param page - Playwright page to observe.
 * @returns Network discovery interface.
 */
function createNetworkDiscovery(page: Page): INetworkDiscovery {
  const captured: IDiscoveredEndpoint[] = [];
  page.on('response', (r: Response): CaptureResult => handleResponse(captured, r));
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
  return { ...core, ...endpoints, ...headers, ...urlBuilders };
}

export { distillHeaders } from './HeaderDistillation.js';
export type { IDiscoveredEndpoint, INetworkDiscovery } from './NetworkDiscoveryTypes.js';
export { createNetworkDiscovery };
