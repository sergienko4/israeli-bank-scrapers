/**
 * Network Discovery — captures API traffic from browser page.
 * Black box: observes what the page's JavaScript does, stores endpoints.
 * SCRAPE phase can replay discovered patterns with different params.
 *
 * Generic for ALL banks — no bank-specific logic.
 * Captures JSON responses from page.on('response'), ignores HTML/images/fonts.
 */

import type { Page, Response } from 'playwright-core';

import { getDebug } from '../../../Common/Debug.js';
import { PIPELINE_WELL_KNOWN_API } from '../Registry/PipelineWellKnown.js';
import type { IFetchOpts } from '../Strategy/FetchStrategy.js';

const LOG = getDebug('network-discovery');

import { AUTH_HEADER_NAMES, discoverAuthThreeTier } from './AuthDiscovery.js';

/** WellKnown request header names for origin discovery. */
const ORIGIN_HEADERS = ['origin', 'referer'];

/** WellKnown request header names for site ID discovery. */
const SITE_ID_HEADERS = ['x-site-id', 'x-session-id'];

/** A discovered API endpoint — captured from browser network traffic. */
interface IDiscoveredEndpoint {
  /** Full URL including query params. */
  readonly url: string;
  /** HTTP method (GET or POST). */
  readonly method: 'GET' | 'POST';
  /** POST body if applicable. */
  readonly postData: string;
  /** Parsed JSON response body. */
  readonly responseBody: unknown;
  /** Response content type. */
  readonly contentType: string;
  /** Request headers sent by page JS (for auth token, origin, site ID). */
  readonly requestHeaders: Record<string, string>;
  /** Capture timestamp (ms since epoch). */
  readonly timestamp: number;
}

/** Network discovery interface — captures and queries API traffic. */
interface INetworkDiscovery {
  /**
   * Find all captured endpoints matching a URL pattern.
   * @param pattern - Regex to match against endpoint URLs.
   * @returns Matching endpoints in capture order.
   */
  findEndpoints(pattern: RegExp): readonly IDiscoveredEndpoint[];

  /**
   * Get the common services base URL from captured traffic.
   * Extracts the URL path before query params from the most common pattern.
   * @returns Services URL or false if no endpoints captured.
   */
  getServicesUrl(): string | false;

  /**
   * Get all captured endpoints.
   * @returns All endpoints in capture order.
   */
  getAllEndpoints(): readonly IDiscoveredEndpoint[];

  /**
   * Discover endpoint by WellKnown API category.
   * Tries each pattern in the category until one matches.
   * @param patterns - Array of regex patterns (from PIPELINE_WELL_KNOWN_API).
   * @returns First matching endpoint or false.
   */
  discoverByPatterns(patterns: readonly RegExp[]): IDiscoveredEndpoint | false;

  /** Discover accounts endpoint via WellKnown patterns. */
  discoverAccountsEndpoint(): IDiscoveredEndpoint | false;

  /** Discover transactions endpoint via WellKnown patterns. */
  discoverTransactionsEndpoint(): IDiscoveredEndpoint | false;

  /** Discover balance endpoint via WellKnown patterns. */
  discoverBalanceEndpoint(): IDiscoveredEndpoint | false;

  /**
   * Discover auth token — 3-tier: headers → response bodies → sessionStorage.
   * Async because sessionStorage requires page.evaluate.
   * @returns Auth token string or false.
   */
  discoverAuthToken(): Promise<string | false>;

  /** Discover origin domain from captured request headers. */
  discoverOrigin(): string | false;

  /** Discover site ID from captured request headers (X-Site-Id, etc.). */
  discoverSiteId(): string | false;

  /**
   * Build fetch headers from ALL discovered auth values in traffic.
   * Includes authorization, origin, site-id, content-type.
   * @returns IFetchOpts ready to pass to fetchStrategy.
   */
  buildDiscoveredHeaders(): IFetchOpts;

  /**
   * Build a full transaction URL for an account from captured traffic templates.
   * Transforms dashboard summary URLs (forHomePage) into full history URLs (Date).
   * @param accountId - Account number.
   * @param startDate - Start date formatted (e.g., YYYYMMDD).
   * @returns Full transaction URL or false.
   */
  buildTransactionUrl(accountId: string, startDate: string): string | false;

  /**
   * Build a balance URL for an account from captured traffic templates.
   * @param accountId - Account number.
   * @returns Balance URL or false.
   */
  buildBalanceUrl(accountId: string): string | false;
}

/** Sentinel for missing content-type header. */
const NO_CONTENT_TYPE = 'none';

/** Sentinel for missing POST body. */
const NO_POST_DATA = '';

/** Content types that indicate a JSON API response. */
const JSON_CONTENT_TYPES = ['application/json', 'text/json'];

/**
 * Check if a content-type header indicates JSON.
 * @param contentType - The content-type header value.
 * @returns True if JSON response.
 */
function isJsonContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return JSON_CONTENT_TYPES.some((jsonType): boolean => lower.includes(jsonType));
}

/**
 * Extract request metadata from a Playwright response.
 * @param response - Playwright response object.
 * @returns URL, method, postData, and contentType.
 */
function extractRequestMeta(response: Response): {
  url: string;
  method: 'GET' | 'POST';
  postData: string;
  contentType: string;
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
function extractBaseUrl(fullUrl: string): string {
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
  const sorted = entries.sort((a, b): number => b[1] - a[1]);
  return sorted[0]?.[0] ?? '';
}

/**
 * Handle a response event — parse and store if JSON API.
 * @param captured - Mutable array to store discovered endpoints.
 * @param response - Playwright response.
 * @returns True (always — fire-and-forget).
 */
function handleResponse(captured: IDiscoveredEndpoint[], response: Response): boolean {
  parseResponse(response)
    .then((endpoint): boolean => {
      if (!endpoint) return false;
      captured.push(endpoint);
      LOG.debug('captured: %s %s', endpoint.method, endpoint.url);
      return true;
    })
    .catch((): boolean => false);
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
  const match = patterns.find((p): boolean => captured.some((ep): boolean => p.test(ep.url)));
  if (!match) return false;
  const hit = captured.find((ep): boolean => match.test(ep.url));
  return hit ?? false;
}

/**
 * Find the first non-empty header value matching any WellKnown header name.
 * @param captured - All captured endpoints.
 * @param headerNames - Header names to search (lowercase).
 * @returns Header value or false.
 */
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
 * Build the low-level discovery methods bound to captured data.
 * @param captured - Mutable captured endpoints array.
 * @returns Low-level discovery methods.
 */
function buildCoreMethods(
  captured: IDiscoveredEndpoint[],
): Pick<
  INetworkDiscovery,
  'findEndpoints' | 'getServicesUrl' | 'getAllEndpoints' | 'discoverByPatterns'
> {
  return {
    /**
     * Find endpoints matching URL pattern.
     * @param pattern - Regex to match.
     * @returns Matching endpoints.
     */
    findEndpoints: (pattern: RegExp): readonly IDiscoveredEndpoint[] =>
      captured.filter((ep): boolean => pattern.test(ep.url)),
    /**
     * Get common services base URL from traffic.
     * @returns Common services URL or false.
     */
    getServicesUrl: (): string | false => findCommonServicesUrl(captured),
    /**
     * Get all captured endpoints.
     * @returns All endpoints.
     */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [...captured],
    /**
     * Discover endpoint by regex patterns.
     * @param patterns - Regex patterns to try.
     * @returns First match or false.
     */
    discoverByPatterns: (patterns: readonly RegExp[]): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, patterns),
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
    /**
     * Accounts endpoint via WellKnown.
     * @returns Endpoint or false.
     */
    discoverAccountsEndpoint: (): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.accounts),
    /**
     * Transactions endpoint via WellKnown.
     * @returns Endpoint or false.
     */
    discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.transactions),
    /**
     * Balance endpoint via WellKnown.
     * @returns Endpoint or false.
     */
    discoverBalanceEndpoint: (): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.balance),
  };
}

/**
 * Build header discovery methods from captured request headers.
 * @param captured - Captured endpoints array.
 * @param page - Playwright page for auth fallback.
 * @returns Header discovery methods.
 */
function buildHeaderMethods(captured: readonly IDiscoveredEndpoint[], page: Page): HeaderMethods {
  return {
    /**
     * Auth token — 3-tier fallback.
     * @returns Token string or false.
     */
    discoverAuthToken: (): Promise<string | false> => discoverAuthThreeTier(captured, page),
    /**
     * Origin domain from request headers.
     * @returns Origin URL or false.
     */
    discoverOrigin: (): string | false => discoverHeaderValue(captured, ORIGIN_HEADERS),
    /**
     * Site ID from request headers.
     * @returns Site ID or false.
     */
    discoverSiteId: (): string | false => discoverHeaderValue(captured, SITE_ID_HEADERS),
    /**
     * Build fetch headers from all discovered values.
     * @returns IFetchOpts with auth, origin, site-id.
     */
    buildDiscoveredHeaders: (): IFetchOpts => {
      const extraHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      const auth = discoverHeaderValue(captured, AUTH_HEADER_NAMES);
      if (auth) extraHeaders.authorization = auth;
      const origin = discoverHeaderValue(captured, ORIGIN_HEADERS);
      if (origin) extraHeaders.Origin = origin;
      if (origin) extraHeaders.Referer = origin;
      const siteId = discoverHeaderValue(captured, SITE_ID_HEADERS);
      if (siteId) extraHeaders['X-Site-Id'] = siteId;
      return { extraHeaders };
    },
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
  const hit = captured.find((ep): boolean => ep.url.includes(accountId));
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
  const balanceHits = captured.filter((ep): boolean =>
    PIPELINE_WELL_KNOWN_API.balance.some((p): boolean => p.test(ep.url)),
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
  page.on('response', (r: Response): boolean => handleResponse(captured, r));
  const core = buildCoreMethods(captured);
  const endpoints = buildEndpointMethods(captured);
  const headers = buildHeaderMethods(captured, page);
  const urlBuilders = {
    /**
     * Build full transaction URL from traffic templates.
     * @param accountId - Account number.
     * @param startDate - Start date.
     * @returns URL or false.
     */
    buildTransactionUrl: (accountId: string, startDate: string): string | false =>
      buildTxnUrlFromTraffic(captured, accountId, startDate),
    /**
     * Build balance URL from traffic templates.
     * @param accountId - Account number.
     * @returns URL or false.
     */
    buildBalanceUrl: (accountId: string): string | false =>
      buildBalUrlFromTraffic(captured, accountId),
  };
  return { ...core, ...endpoints, ...headers, ...urlBuilders };
}

export type { IDiscoveredEndpoint, INetworkDiscovery };
export { createNetworkDiscovery };
