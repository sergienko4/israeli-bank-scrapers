/**
 * AuthDiscovery sub-module — shared token helpers + WellKnown constants.
 *
 * Tier-agnostic: every tier reuses prefixToken / tryParseJsonToken.
 * No runtime side effects.
 */

import type { Brand } from '../../../Types/Brand.js';

/** WellKnown sessionStorage key name for the canonical auth blob. */
export const AUTH_MODULE_STORAGE_KEY = 'auth-module' as const;

/** WellKnown token field names found in auth response bodies. */
export const TOKEN_BODY_FIELDS = [
  'token',
  'calConnectToken',
  'access_token',
  'authToken',
  'jwt',
] as const;

/** WellKnown sessionStorage keys for auth tokens. */
export const STORAGE_AUTH_KEYS = [
  AUTH_MODULE_STORAGE_KEY,
  'auth',
  'token',
  'session',
  'guid',
] as const;

/** WellKnown request header names for auth. */
export const AUTH_HEADER_NAMES = ['authorization', 'x-auth-token'] as const;

/** Max polling time for auth-module to appear (ms). */
export const AUTH_POLL_TIMEOUT = 3_000;

/** Poll interval (ms). */
export const AUTH_POLL_INTERVAL = 100;

/** Parsed sessionStorage auth shape. */
export interface IStorageAuth {
  auth?: { calConnectToken?: string; token?: string };
}

/** Nominal type for a prefixed auth header value (Rule #15 boundary marker). */
export type PrefixedAuthToken = Brand<string, 'PrefixedAuthToken'>;

/**
 * Add auth scheme prefix to a bare token if not already prefixed.
 * @param token - Raw token string.
 * @returns Token with CALAuthScheme or Bearer prefix.
 */
export function prefixToken(token: string): PrefixedAuthToken {
  if (token.startsWith('CALAuthScheme ')) return token as PrefixedAuthToken;
  if (token.startsWith('Bearer ')) return token as PrefixedAuthToken;
  return `CALAuthScheme ${token}` as PrefixedAuthToken;
}

/**
 * Extract token from parsed auth JSON.
 * @param parsed - Parsed JSON object.
 * @returns Prefixed token or false (preserves the PrefixedAuthToken brand).
 */
function extractFromParsed(parsed: IStorageAuth): PrefixedAuthToken | false {
  const token = parsed.auth?.calConnectToken ?? parsed.auth?.token;
  if (!token) return false;
  return prefixToken(token);
}

/**
 * Try extracting a token from JSON sessionStorage value.
 * @param raw - Raw JSON string.
 * @returns Prefixed token (branded) or false.
 */
export function tryParseJsonToken(raw: string): PrefixedAuthToken | false {
  try {
    const parsed = JSON.parse(raw) as IStorageAuth;
    return extractFromParsed(parsed);
  } catch {
    return false;
  }
}
