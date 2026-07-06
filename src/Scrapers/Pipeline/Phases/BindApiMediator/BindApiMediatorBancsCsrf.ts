/**
 * BIND-API-MEDIATOR BaNCS CSRF sniff — the TCS BaNCS SPA's Angular HTTP
 * interceptor injects a CSRF header (the login-response `csrfTkn`) on every
 * request. The hard-model direct fetch bypasses that interceptor, so BaNCS
 * rejects a bare POST with server error 88521 "CSRF Token unavailable in
 * request". This reads the token value from the login response and the exact
 * request-header NAME from the login-boot pool (value-match — the SPA's header
 * name is opaque, not literally "csrf"), so the scrape steps replay it verbatim.
 * PII-safe: the token is a per-session CSRF nonce, never logged.
 */

import type { IDiscoveredEndpoint } from '../../Mediator/Network/Types/Endpoint.js';
import { isRecord, isStr } from '../../Mediator/Scrape/Bancs/BancsShape.js';

/** Any BaNCS Digital app request — the CSRF header rides all of them. */
const BANCS_APP_MATCH = '/BaNCSDigitalApp/';

/** The login POST whose response body carries the CSRF token. */
const LOGIN_URL_MATCH = '/BaNCSDigitalApp/login';

/** The captured CSRF request header (name + value), or empty. */
export interface ICsrfHeader {
  readonly bancsCsrfName: string;
  readonly bancsCsrfValue: string;
}

/** Empty CSRF capture — no header injected when the sniff finds none. */
const EMPTY_CSRF: ICsrfHeader = { bancsCsrfName: '', bancsCsrfValue: '' };

/**
 * Read the login response's `csrfTkn` value from the pool (empty when absent).
 * @param pool - Login-inclusive discovery captures.
 * @returns The CSRF token value, or empty.
 */
function readLoginCsrf(pool: readonly IDiscoveredEndpoint[]): string {
  const login = pool.find(
    (ep): boolean => ep.method === 'POST' && ep.url.includes(LOGIN_URL_MATCH),
  );
  if (login === undefined) return '';
  const body = login.responseBody;
  if (!isRecord(body)) return '';
  const tkn = body.csrfTkn;
  return isStr(tkn) ? tkn : '';
}

/**
 * Read a matched header entry into a CSRF bundle (`false` for an empty value).
 * @param hit - Matched `[name, value]` entry.
 * @returns CSRF header bundle, or `false`.
 */
function toCsrf(hit: readonly [string, string]): ICsrfHeader | false {
  if (hit[1].length === 0) return false;
  return { bancsCsrfName: hit[0], bancsCsrfValue: hit[1] };
}

/**
 * Value-match one BaNCS request's headers against the login token (the header
 * name is opaque, so the value is the reliable key).
 * @param ep - Captured endpoint.
 * @param value - The login `csrfTkn` value (empty ⇒ no match).
 * @returns CSRF header bundle, or `false`.
 */
function matchByValue(ep: IDiscoveredEndpoint, value: string): ICsrfHeader | false {
  if (value.length === 0 || !ep.url.includes(BANCS_APP_MATCH)) return false;
  const hit = Object.entries(ep.requestHeaders).find((e): boolean => e[1] === value);
  return hit === undefined ? false : toCsrf(hit);
}

/**
 * Whether a header entry is a non-empty `csrf`-named header.
 * @param entry - Header `[name, value]` entry.
 * @returns True when the name contains "csrf" and the value is non-empty.
 */
function isCsrfNamed(entry: readonly [string, string]): boolean {
  return entry[0].toLowerCase().includes('csrf') && entry[1].length > 0;
}

/**
 * Name-match one BaNCS request's headers by a name containing "csrf".
 * @param ep - Captured endpoint.
 * @returns CSRF header bundle, or `false`.
 */
function matchByName(ep: IDiscoveredEndpoint): ICsrfHeader | false {
  if (!ep.url.includes(BANCS_APP_MATCH)) return false;
  const hit = Object.entries(ep.requestHeaders).find(isCsrfNamed);
  return hit === undefined ? false : toCsrf(hit);
}

/**
 * Sniff the CSRF header from the login-boot pool. A GLOBAL value-match pass
 * (across every request) runs first, so a later request that actually carries
 * the login token wins over an earlier request with a `csrf`-named but
 * wrong-valued header; the name-contains-`csrf` pass is the fallback. When only
 * the login value is known, an empty name signals the shape to try candidate
 * header names.
 * @param pool - Login-inclusive discovery captures.
 * @returns CSRF header bundle, or the empty bundle.
 */
export function scanCsrf(pool: readonly IDiscoveredEndpoint[]): ICsrfHeader {
  const value = readLoginCsrf(pool);
  const valueHit = pool.map((ep): ICsrfHeader | false => matchByValue(ep, value));
  const byValue = valueHit.find((c): c is ICsrfHeader => c !== false);
  if (byValue !== undefined) return byValue;
  const byName = pool.map(matchByName).find((c): c is ICsrfHeader => c !== false);
  if (byName !== undefined) return byName;
  if (value.length > 0) return { bancsCsrfName: '', bancsCsrfValue: value };
  return EMPTY_CSRF;
}

export default scanCsrf;
