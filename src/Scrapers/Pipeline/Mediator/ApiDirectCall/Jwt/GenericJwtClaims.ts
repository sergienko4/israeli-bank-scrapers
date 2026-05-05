/**
 * GenericJwtClaims — generic JWT exp/freshness check driven by
 * IJwtClaimsConfig. Local validation only (no network). Used by
 * TokenStrategyFromConfig to gate stored-jwt-fresh short-circuits.
 *
 * Carries zero bank knowledge; the claim field name + skew are
 * supplied by config.
 */

import type { IJwtClaimsConfig } from '../IApiDirectCallConfig.js';

/** Whether the JWT has usable remaining lifetime per the config. */
type IsTokenFresh = boolean;

/** Decoded JWT payload — only the configured numeric claim matters. */
type JwtPayload = Readonly<Record<string, unknown>>;

/**
 * Decode a base64-url segment to UTF-8 text — returns false on any
 * decoding failure. Hoisted out of parsePayload to satisfy max-depth.
 * @param payloadB64 - Base64-encoded middle segment.
 * @returns UTF-8 string, or false on decode failure.
 */
function safeDecode(payloadB64: string): string | false {
  try {
    return Buffer.from(payloadB64, 'base64').toString('utf8');
  } catch {
    return false;
  }
}

/** Loose-typed parse result — allows runtime narrowing checks. */
type ParseOutcome = JwtPayload | null | false;

/**
 * JSON.parse wrapper returning the raw value or `false` on syntax error.
 * Hoisted so safeJsonParse stays at depth 1.
 * @param text - JSON text to parse.
 * @returns Parsed value (object or null) or false on syntax error.
 */
function tryJsonParse(text: string): ParseOutcome {
  try {
    return JSON.parse(text) as ParseOutcome;
  } catch {
    return false;
  }
}

/**
 * Parse a JSON text — returns false on syntax error or non-object root.
 * @param text - Decoded JSON text.
 * @returns Parsed payload object, or false on parse/type failure.
 */
function safeJsonParse(text: string): JwtPayload | false {
  const parsed = tryJsonParse(text);
  if (parsed === false || parsed === null) return false;
  return parsed;
}

/**
 * Parse the JWT payload segment — returns false on any decoding failure.
 * @param payloadB64 - Base64-encoded middle segment of the JWT.
 * @returns Parsed payload object, or false on failure.
 */
function parsePayload(payloadB64: string): JwtPayload | false {
  const text = safeDecode(payloadB64);
  if (text === false) return false;
  return safeJsonParse(text);
}

/**
 * Decode the configured numeric claim from a compact JWT.
 * @param jwt - Compact JWT string.
 * @param field - Claim field name (e.g. 'exp' or 'nbf').
 * @returns Unix seconds at which the claim fires, or false.
 */
function decodeNumericClaim(jwt: string, field: string): number | false {
  const parts = jwt.split('.');
  if (parts.length < 2) return false;
  const payload = parsePayload(parts[1]);
  if (payload === false) return false;
  const value = payload[field];
  if (typeof value !== 'number') return false;
  return value;
}

/**
 * Return true iff the configured claim is at least skewSeconds in the
 * future. Also false when the JWT is malformed or the claim is missing.
 * @param jwt - Compact JWT string.
 * @param config - IJwtClaimsConfig (freshnessField + skewSeconds).
 * @returns Freshness flag.
 */
function isJwtFresh(jwt: string, config: IJwtClaimsConfig): IsTokenFresh {
  const claim = decodeNumericClaim(jwt, config.freshnessField);
  if (claim === false) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return claim > nowSec + config.skewSeconds;
}

export type { IsTokenFresh };
export { decodeNumericClaim, isJwtFresh };
