/**
 * JwtLifetime — decode how long a stored long-term token is valid for.
 *
 * <p>Signature verification is deliberately absent: the caller already holds
 * the token the bank issued to it, and the only question here is what the
 * bank stamped into `iat`/`exp`. Nothing is trusted on the strength of this
 * decode — it exists so a documented lifetime can be re-measured instead of
 * quoted.
 */

import ScraperError from '../../Scrapers/Base/ScraperError.js';

const SECONDS_PER_DAY = 86400;
const JWT_SEGMENTS = 3;

/** A token's issued-at and expiry claims, plus the interval between them. */
interface IJwtLifetime {
  /** The `iat` claim, in seconds since the epoch. */
  readonly iatSec: number;
  /** The `exp` claim, in seconds since the epoch. */
  readonly expSec: number;
  /** `exp` minus `iat`, expressed in days — fractional when not a whole day. */
  readonly days: number;
}

/**
 * Decode the payload segment of a compact JWT without verifying it.
 * @param token - Compact-serialisation JWT.
 * @returns The payload as a plain object.
 */
function decodePayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== JWT_SEGMENTS) throw new ScraperError('value is not a compact JWT');
  const segment = parts.at(1) ?? '';
  const json = Buffer.from(segment, 'base64url').toString('utf8');
  const parsed: unknown = JSON.parse(json);
  const isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  if (!isObject) throw new ScraperError('JWT payload is not a JSON object');
  return parsed as Record<string, unknown>;
}

/**
 * Read a numeric claim, failing loudly when it is missing or the wrong type.
 * @param payload - Decoded JWT payload.
 * @param name - Claim name to read.
 * @returns The claim value in seconds since the epoch.
 */
function readSeconds(payload: Record<string, unknown>, name: string): number {
  const value = payload[name];
  if (typeof value !== 'number') throw new ScraperError(`JWT claim "${name}" is not numeric`);
  return value;
}

/**
 * Measure how long a token is valid for, from its own claims.
 * @param token - Compact-serialisation JWT.
 * @returns The `iat`/`exp` claims and the interval between them in days.
 */
function measureJwtLifetime(token: string): IJwtLifetime {
  const payload = decodePayload(token);
  const iatSec = readSeconds(payload, 'iat');
  const expSec = readSeconds(payload, 'exp');
  return { iatSec, expSec, days: (expSec - iatSec) / SECONDS_PER_DAY };
}

export type { IJwtLifetime };
export { measureJwtLifetime };
