/**
 * Auth discovery — 3-tier token extraction for the mediator.
 * Tier 1: Request headers (authorization, x-auth-token)
 * Tier 2: Response bodies of auth endpoints (WellKnown token fields)
 * Tier 3: SessionStorage fallback (generic for all banks)
 * All in the mediator — banks never know about auth.
 */

import type { Page } from 'playwright-core';

import { PIPELINE_WELL_KNOWN_API } from '../Registry/PipelineWellKnown.js';
import type { IDiscoveredEndpoint } from './NetworkDiscovery.js';

/** WellKnown token field names in auth response bodies. */
const TOKEN_BODY_FIELDS = ['token', 'calConnectToken', 'access_token', 'authToken', 'jwt'];

/** WellKnown sessionStorage keys for auth tokens. */
const STORAGE_AUTH_KEYS = ['auth-module', 'auth', 'token', 'session'];

/** WellKnown request header names for auth. */
const AUTH_HEADER_NAMES = ['authorization', 'x-auth-token'];

/**
 * Add auth scheme prefix to a bare token if not already prefixed.
 * @param token - Raw token string.
 * @returns Token with CALAuthScheme or Bearer prefix.
 */
function prefixToken(token: string): string {
  if (token.startsWith('CALAuthScheme ')) return token;
  if (token.startsWith('Bearer ')) return token;
  return `CALAuthScheme ${token}`;
}

// ── Tier 1: Request Headers ────────────────────────────

/**
 * Find auth token from captured request headers.
 * @param captured - All captured endpoints.
 * @returns Auth token or false.
 */
/**
 * Check if an endpoint has an auth header.
 * @param ep - Endpoint to check.
 * @returns Auth header value or false.
 */
function extractAuthHeader(ep: IDiscoveredEndpoint): string | false {
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
function discoverFromHeaders(captured: readonly IDiscoveredEndpoint[]): string | false {
  const match = captured.find((ep): boolean => extractAuthHeader(ep) !== false);
  if (!match) return false;
  return extractAuthHeader(match);
}

// ── Tier 2: Response Bodies ────────────────────────────

/**
 * Find a WellKnown token field in a flat object.
 * @param obj - Object to search.
 * @returns Prefixed token string or false.
 */
function findTokenInFlat(obj: Record<string, unknown>): string | false {
  /**
   * Check if field value is a token-length string.
   * @param f - Field name.
   * @returns True if string longer than 5 chars.
   */
  const isToken = (f: string): boolean => {
    const val = obj[f];
    return typeof val === 'string' && val.length > 5;
  };
  const hit = TOKEN_BODY_FIELDS.find(isToken);
  if (!hit) return false;
  return prefixToken(obj[hit] as string);
}

/**
 * Search a response body for token (flat + 1 level nested).
 * @param body - Parsed response body.
 * @returns Prefixed token or false.
 */
function searchBodyForToken(body: Record<string, unknown>): string | false {
  const direct = findTokenInFlat(body);
  if (direct) return direct;
  const nested = Object.values(body).find((v): boolean => typeof v === 'object' && v !== null);
  if (!nested) return false;
  return findTokenInFlat(nested as Record<string, unknown>);
}

/**
 * Search auth endpoint response bodies for a token.
 * @param captured - All captured endpoints.
 * @returns Prefixed token or false.
 */
function discoverFromResponses(captured: readonly IDiscoveredEndpoint[]): string | false {
  const authHits = captured.filter((ep): boolean =>
    PIPELINE_WELL_KNOWN_API.auth.some((p): boolean => p.test(ep.url)),
  );
  const match = authHits.find(
    (ep): boolean => searchBodyForToken(ep.responseBody as Record<string, unknown>) !== false,
  );
  if (!match) return false;
  return searchBodyForToken(match.responseBody as Record<string, unknown>);
}

// ── Tier 3: SessionStorage ─────────────────────────────

/**
 * Try extracting a token from JSON sessionStorage value.
 * @param raw - Raw JSON string.
 * @returns Prefixed token or false.
 */
/** Parsed sessionStorage auth shape. */
interface IStorageAuth {
  auth?: { calConnectToken?: string; token?: string };
}

/**
 * Extract token from parsed auth JSON.
 * @param parsed - Parsed JSON object.
 * @returns Token string or false.
 */
function extractFromParsed(parsed: IStorageAuth): string | false {
  const token = parsed.auth?.calConnectToken ?? parsed.auth?.token;
  if (!token) return false;
  return prefixToken(token);
}

/**
 * Try extracting a token from JSON sessionStorage value.
 * @param raw - Raw JSON string.
 * @returns Prefixed token or false.
 */
function tryParseJsonToken(raw: string): string | false {
  try {
    const parsed = JSON.parse(raw) as { auth?: { calConnectToken?: string; token?: string } };
    return extractFromParsed(parsed);
  } catch {
    return false;
  }
}

/**
 * Read auth token from page sessionStorage.
 * @param page - Playwright page.
 * @returns Token string or false.
 */
async function discoverFromStorage(page: Page): Promise<string | false> {
  const raw = await page
    .evaluate(
      /**
       * Read first non-empty sessionStorage value from keys.
       * @param keys - Storage key names to try.
       * @returns First non-empty value or sentinel.
       */
      (keys: string[]): string => {
        const values = keys.map((k): string => sessionStorage.getItem(k) ?? '');
        const found = values.find(Boolean);
        return found ?? 'NONE';
      },
      STORAGE_AUTH_KEYS,
    )
    .catch((): string => 'NONE');
  if (raw === 'NONE') return false;
  const jsonToken = tryParseJsonToken(raw);
  if (jsonToken) return jsonToken;
  if (raw.length > 10) return raw;
  return false;
}

// ── Public: 3-tier discovery ───────────────────────────

/**
 * Discover auth token: headers → response bodies → sessionStorage.
 * @param captured - Captured endpoints.
 * @param page - Playwright page for sessionStorage fallback.
 * @returns Auth token or false.
 */
async function discoverAuthThreeTier(
  captured: readonly IDiscoveredEndpoint[],
  page: Page,
): Promise<string | false> {
  // Prefer fresh sources (response body, sessionStorage) over stale captured headers
  const fromBody = discoverFromResponses(captured);
  if (fromBody) return fromBody;
  const fromStorage = await discoverFromStorage(page);
  if (fromStorage) return fromStorage;
  return discoverFromHeaders(captured);
}

export { AUTH_HEADER_NAMES, discoverAuthThreeTier, discoverFromHeaders };
