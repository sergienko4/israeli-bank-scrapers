/**
 * AuthDiscovery Tier 2 — extract auth from captured response bodies.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import { prefixToken, TOKEN_BODY_FIELDS } from './Tokens.js';

/**
 * Find a WellKnown token field in a flat object.
 * @param obj - Object to search.
 * @returns Prefixed token string or false.
 */
function findTokenInFlat(obj: Record<string, unknown>): string | false {
  const hit = TOKEN_BODY_FIELDS.find(
    (f): boolean => typeof obj[f] === 'string' && obj[f].length > 5,
  );
  if (!hit) return false;
  return prefixToken(obj[hit] as string);
}

/**
 * Search a response body for token (flat + 1 level nested).
 * @param body - Parsed response body.
 * @returns Prefixed token or false.
 */
export function searchBodyForToken(body: Record<string, unknown>): string | false {
  const direct = findTokenInFlat(body);
  if (direct) return direct;
  const nested = Object.values(body).find((v): boolean => typeof v === 'object' && v !== null);
  if (!nested) return false;
  return findTokenInFlat(nested as Record<string, unknown>);
}

/**
 * Filter captured endpoints to those matching a WellKnown auth URL pattern.
 * @param captured - All captured endpoints.
 * @returns Subset matching the auth URL patterns.
 */
function filterAuthEndpoints(
  captured: readonly IDiscoveredEndpoint[],
): readonly IDiscoveredEndpoint[] {
  return captured.filter((ep): boolean =>
    PIPELINE_WELL_KNOWN_API.auth.some((p): boolean => p.test(ep.url)),
  );
}

/**
 * Search auth endpoint response bodies for a token.
 * @param captured - All captured endpoints.
 * @returns Prefixed token or false.
 */
export function discoverFromResponses(captured: readonly IDiscoveredEndpoint[]): string | false {
  const authHits = filterAuthEndpoints(captured);
  const match = authHits.find(
    (ep): boolean => searchBodyForToken(ep.responseBody as Record<string, unknown>) !== false,
  );
  if (!match) return false;
  return searchBodyForToken(match.responseBody as Record<string, unknown>);
}
