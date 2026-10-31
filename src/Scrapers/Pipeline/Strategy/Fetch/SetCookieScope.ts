/**
 * Set-Cookie line → stored cookie for the domain jar (RFC 6265 §5.2/§5.3
 * subset). `Domain` is honoured only for an allow-listed domain the request
 * host domain-matches (the allow-list stands in for a public-suffix list); a
 * `Domain` equal to a non-allow-listed host keeps the cookie host-only; any
 * other `Domain` drops the cookie. `Max-Age` beats `Expires`; a past expiry
 * yields an already-expired cookie, which the jar treats as a deletion.
 * Reuses the simple jar's pair and attribute readers; never logs values.
 */

import type { IStoredCookie } from '../../Types/Domain/CookieSession.js';
import { MAX_AGE_RE, parseCookieLine, readAttribute } from './CookieJar.js';
import type { ICookieTarget } from './CookieMatch.js';
import { defaultPath, domainMatches, SESSION_EXPIRY } from './CookieMatch.js';

/** Inputs shared by every line of one response. */
interface ISetCookieContext {
  readonly target: ICookieTarget;
  readonly allow: readonly string[];
  readonly nowS: number;
}

/** Host scope of a cookie. */
interface ICookieScope {
  readonly domain: string;
  readonly hostOnly: boolean;
}

/** Expiry of a cookie the server already expired: any past epoch second. */
const EXPIRED_EPOCH_S = 1;

/**
 * The `Domain` attribute, lower-cased without its leading dot.
 * @param line - Raw Set-Cookie line.
 * @returns The domain, or false when absent or empty.
 */
function domainAttribute(line: string): string | false {
  const raw = readAttribute(line, 'domain');
  if (raw === false) return false;
  const bare = raw.replace(/^\./, '').toLowerCase();
  if (bare.length === 0) return false;
  return bare;
}

/**
 * The host scope of a Set-Cookie line for one request host.
 * @param line - Raw Set-Cookie line.
 * @param host - Lower-case request host.
 * @param allow - Allow-listed registrable domains.
 * @returns The scope, or false when the cookie must be ignored.
 */
function scopeOf(line: string, host: string, allow: readonly string[]): ICookieScope | false {
  const domain = domainAttribute(line);
  if (domain === false) return { domain: host, hostOnly: true };
  if (allow.includes(domain) && domainMatches(host, domain)) return { domain, hostOnly: false };
  if (domain === host) return { domain: host, hostOnly: true };
  return false;
}

/**
 * The cookie path: the `Path` attribute when it is absolute, else the default.
 * @param line - Raw Set-Cookie line.
 * @param requestPath - Request URL path.
 * @returns The cookie path.
 */
function pathOf(line: string, requestPath: string): string {
  const raw = readAttribute(line, 'path');
  if (raw === false || !raw.startsWith('/')) return defaultPath(requestPath);
  return raw;
}

/**
 * Whether a value-less attribute such as `Secure` is present.
 * @param line - Raw Set-Cookie line.
 * @param flag - Lower-case attribute name.
 * @returns True when present.
 */
function hasFlag(line: string, flag: string): boolean {
  const attributes = line.split(';').slice(1);
  const names = attributes.map((part): string => part.trim().toLowerCase());
  return names.includes(flag);
}

/**
 * Expiry from `Expires`, or a session cookie when absent or unparseable.
 * @param line - Raw Set-Cookie line.
 * @returns Epoch seconds, or the session marker.
 */
function expiresExpiry(line: string): number {
  const expires = readAttribute(line, 'expires');
  if (expires === false) return SESSION_EXPIRY;
  const atMs = Date.parse(expires);
  if (Number.isNaN(atMs)) return SESSION_EXPIRY;
  const atS = Math.floor(atMs / 1000);
  return Math.max(EXPIRED_EPOCH_S, atS);
}

/**
 * Expiry of a Set-Cookie line; `Max-Age` beats `Expires`.
 * @param line - Raw Set-Cookie line.
 * @param nowS - Current epoch seconds.
 * @returns Epoch seconds, or the session marker.
 */
function expiryOf(line: string, nowS: number): number {
  const maxAge = readAttribute(line, 'max-age');
  if (maxAge === false || !MAX_AGE_RE.test(maxAge)) return expiresExpiry(line);
  const seconds = Number(maxAge);
  if (seconds <= 0) return EXPIRED_EPOCH_S;
  return nowS + seconds;
}

/**
 * Parse one Set-Cookie line into a stored cookie for the request.
 * @param line - Raw Set-Cookie line.
 * @param context - Request scope, allow-list and clock.
 * @returns The cookie, or false when malformed or out of scope.
 */
function parseSetCookie(line: string, context: ISetCookieContext): IStoredCookie | false {
  const pair = parseCookieLine(line);
  if (pair === false) return false;
  const scope = scopeOf(line, context.target.host, context.allow);
  if (scope === false) return false;
  const path = pathOf(line, context.target.path);
  const isSecure = hasFlag(line, 'secure');
  const expiresEpochS = expiryOf(line, context.nowS);
  return { name: pair.name, value: pair.value, ...scope, path, secure: isSecure, expiresEpochS };
}

export default parseSetCookie;
export { parseSetCookie };
