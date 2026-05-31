/**
 * AuthDiscovery Tier 1 — extract auth from captured request headers.
 */

import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import { AUTH_HEADER_NAMES } from './Tokens.js';

/**
 * Check if an endpoint has an auth header.
 * @param ep - Endpoint to check.
 * @returns Auth header value or false.
 */
export function extractAuthHeader(ep: IDiscoveredEndpoint): string | false {
  const hit = AUTH_HEADER_NAMES.find(
    (h): boolean => typeof ep.requestHeaders[h] === 'string' && ep.requestHeaders[h].length > 0,
  );
  if (!hit) return false;
  return ep.requestHeaders[hit];
}

/**
 * Find auth token from captured request headers.
 * @param captured - All captured endpoints.
 * @returns Auth token or false.
 */
export function discoverFromHeaders(captured: readonly IDiscoveredEndpoint[]): string | false {
  const match = captured.find((ep): boolean => extractAuthHeader(ep) !== false);
  if (!match) return false;
  return extractAuthHeader(match);
}
