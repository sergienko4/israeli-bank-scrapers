/**
 * AuthDiscovery Tier 2 — extract auth from captured response bodies.
 */

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import { prefixToken, TOKEN_BODY_FIELDS } from './Tokens.js';

/** Minimum length for a string field to be treated as a usable bearer token. */
const MIN_TOKEN_LENGTH = 5;

/**
 * Find a WellKnown token field in a flat object.
 * @param obj - Object to search.
 * @returns Prefixed token string or false.
 */
function findTokenInFlat(obj: Record<string, unknown>): string | false {
  const hit = TOKEN_BODY_FIELDS.find(
    (f): boolean => typeof obj[f] === 'string' && obj[f].length > MIN_TOKEN_LENGTH,
  );
  if (!hit) return false;
  return prefixToken(obj[hit] as string);
}

/**
 * Try one nested value (must be a non-null object) against the flat
 * token-field table. Pulled out of {@link findTokenInNested} so the
 * walker stays flat (max-depth ≤ 1).
 * @param value - One nested value from the parsed body.
 * @returns Prefixed token or false when no match (or not an object).
 */
function tryNestedValue(value: unknown): string | false {
  if (typeof value !== 'object' || value === null) return false;
  return findTokenInFlat(value as Record<string, unknown>);
}

/**
 * Search every nested object value (one level deep) for a flat-token hit.
 * Walks ALL nested entries — not just the first — so a winner deeper in
 * the response body is not missed (CR PR #280 #112 fix).
 * @param body - Parsed response body.
 * @returns Prefixed token or false.
 */
function findTokenInNested(body: Record<string, unknown>): string | false {
  const hits = Object.values(body).map(tryNestedValue);
  const found = hits.find((h): boolean => h !== false);
  return found ?? false;
}

/**
 * Search a response body for token (flat + 1 level nested across ALL nested entries).
 * @param body - Parsed response body.
 * @returns Prefixed token or false.
 */
export function searchBodyForToken(body: Record<string, unknown>): string | false {
  const direct = findTokenInFlat(body);
  if (direct) return direct;
  return findTokenInNested(body);
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
