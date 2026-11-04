/**
 * RFC 6265 matching rules for the domain cookie jar: which request a stored
 * cookie applies to (§5.1.3 domain-match, §5.1.4 path-match, `Secure`,
 * expiry) and the default path a cookie without `Path` gets. Pure functions;
 * never logs values.
 */

import type { IStoredCookie } from '../../Types/Domain/CookieSession.js';
import { resolveFetchUrl } from './NativeFetchStrategy.js';

/** The parts of a request URL that scope cookies. */
interface ICookieTarget {
  /** Lower-case hostname. */
  readonly host: string;
  readonly path: string;
  readonly isSecure: boolean;
}

/** Expiry value of a session cookie. */
const SESSION_EXPIRY = 0;

/** A dotted IPv4 host, which never domain-matches a parent. */
const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Current time in epoch seconds.
 * @returns Whole seconds since the epoch.
 */
function nowEpochS(): number {
  const nowMs = Date.now();
  return Math.floor(nowMs / 1000);
}

/**
 * Whether a host is an IP literal (IPv4 dotted or bracketed IPv6).
 * @param host - Lower-case hostname.
 * @returns True for an IP literal.
 */
function isIpHost(host: string): boolean {
  return IPV4_HOST.test(host) || host.startsWith('[');
}

/**
 * RFC 6265 §5.1.3 domain-match.
 * @param host - Lower-case request host.
 * @param domain - Lower-case cookie domain.
 * @returns True when the host is the domain or a name under it.
 */
function domainMatches(host: string, domain: string): boolean {
  if (host === domain) return true;
  return host.endsWith(`.${domain}`) && !isIpHost(host);
}

/**
 * RFC 6265 §5.1.4 path-match, on a `/` boundary.
 * @param requestPath - Request URL path.
 * @param cookiePath - Cookie path.
 * @returns True when the cookie path covers the request path.
 */
function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath.charAt(cookiePath.length) === '/';
}

/**
 * RFC 6265 §5.1.4 default path: the request path's directory.
 * @param requestPath - Request URL path.
 * @returns The default cookie path.
 */
function defaultPath(requestPath: string): string {
  const lastSlash = requestPath.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return requestPath.slice(0, lastSlash);
}

/**
 * Whether a stored cookie has expired.
 * @param cookie - Stored cookie.
 * @param nowS - Current epoch seconds.
 * @returns True once a non-session cookie's expiry has passed.
 */
function isExpired(cookie: IStoredCookie, nowS: number): boolean {
  return cookie.expiresEpochS !== SESSION_EXPIRY && cookie.expiresEpochS <= nowS;
}

/**
 * Whether a cookie's host scope covers a request host.
 * @param cookie - Stored cookie.
 * @param host - Lower-case request host.
 * @returns True for the exact host (host-only) or a domain-match.
 */
function hostApplies(cookie: IStoredCookie, host: string): boolean {
  if (cookie.hostOnly) return host === cookie.domain;
  return domainMatches(host, cookie.domain);
}

/**
 * Whether a stored cookie goes on a request.
 * @param cookie - Stored cookie.
 * @param target - Request scope.
 * @param nowS - Current epoch seconds.
 * @returns True when host, Secure, expiry and path all allow it.
 */
function cookieApplies(cookie: IStoredCookie, target: ICookieTarget, nowS: number): boolean {
  if (!hostApplies(cookie, target.host)) return false;
  if (cookie.secure && !target.isSecure) return false;
  if (isExpired(cookie, nowS)) return false;
  return pathMatches(target.path, cookie.path);
}

/**
 * The cookie scope of a request URL, resolved the way the node transports
 * resolve it.
 * @param baseUrl - The transport's base URL.
 * @param url - Caller-supplied URL (absolute or relative).
 * @returns The scope, or false when the URL cannot be parsed.
 */
function targetOf(baseUrl: string, url: string): ICookieTarget | false {
  const fullUrl = resolveFetchUrl(baseUrl, url);
  const parsed = URL.parse(fullUrl);
  if (parsed === null) return false;
  const host = parsed.hostname.toLowerCase();
  return { host, path: parsed.pathname, isSecure: parsed.protocol === 'https:' };
}

export type { ICookieTarget };
export {
  cookieApplies,
  defaultPath,
  domainMatches,
  isExpired,
  nowEpochS,
  SESSION_EXPIRY,
  targetOf,
};
