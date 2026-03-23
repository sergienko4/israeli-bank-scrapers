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

const LOG = getDebug('network-discovery');

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
} {
  const headers = response.headers();
  const contentType = headers['content-type'] ?? NO_CONTENT_TYPE;
  const url = response.url();
  const method = response.request().method() as 'GET' | 'POST';
  const rawPost = response.request().postData();
  const postData = rawPost ?? NO_POST_DATA;
  return { url, method, postData, contentType };
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
 * Create a network discovery instance bound to a page.
 * Starts capturing immediately on creation.
 * @param page - Playwright page to observe.
 * @returns Network discovery interface.
 */
function createNetworkDiscovery(page: Page): INetworkDiscovery {
  const captured: IDiscoveredEndpoint[] = [];
  page.on('response', (r: Response): boolean => handleResponse(captured, r));
  const discovery: INetworkDiscovery = {
    /**
     * Find endpoints matching URL pattern.
     * @param pattern - Regex to match.
     * @returns Matching endpoints.
     */
    findEndpoints: (pattern: RegExp): readonly IDiscoveredEndpoint[] =>
      captured.filter((ep): boolean => pattern.test(ep.url)),
    /**
     * Get common services base URL.
     * @returns Base URL or false.
     */
    getServicesUrl: (): string | false => findCommonServicesUrl(captured),
    /**
     * Get all captured endpoints.
     * @returns All endpoints.
     */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [...captured],
    /**
     * Discover endpoint by WellKnown API patterns.
     * @param patterns - Array of regex patterns to try.
     * @returns First matching endpoint or false.
     */
    discoverByPatterns: (patterns: readonly RegExp[]): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, patterns),
  };
  return discovery;
}

export type { IDiscoveredEndpoint, INetworkDiscovery };
export { createNetworkDiscovery };
