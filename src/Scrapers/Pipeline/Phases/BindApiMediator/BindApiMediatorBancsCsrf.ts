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
 * Find the CSRF request header on one BaNCS request — by value-match to the
 * login token first (the name is opaque), then by a name containing "csrf".
 * @param ep - Captured endpoint.
 * @param value - The login `csrfTkn` value (empty to skip value-match).
 * @returns CSRF header, or `false`.
 */
function matchCsrfHeader(ep: IDiscoveredEndpoint, value: string): ICsrfHeader | false {
  if (!ep.url.includes(BANCS_APP_MATCH)) return false;
  const entries = Object.entries(ep.requestHeaders);
  const byValue = value.length > 0 ? entries.find((e): boolean => e[1] === value) : undefined;
  const byName = entries.find((e): boolean => e[0].toLowerCase().includes('csrf'));
  const hit = byValue ?? byName;
  if (hit === undefined || hit[1].length === 0) return false;
  return { bancsCsrfName: hit[0], bancsCsrfValue: hit[1] };
}

/**
 * Sniff the CSRF header from the login-boot pool: the exact request-header name
 * (value-matched) when captured, else the login-response value alone (an empty
 * name signals the shape to fall back to candidate header names).
 * @param pool - Login-inclusive discovery captures.
 * @returns CSRF header bundle, or the empty bundle.
 */
export function scanCsrf(pool: readonly IDiscoveredEndpoint[]): ICsrfHeader {
  const value = readLoginCsrf(pool);
  const hits = pool.map((ep): ICsrfHeader | false => matchCsrfHeader(ep, value));
  const hit = hits.find((c): c is ICsrfHeader => c !== false);
  if (hit !== undefined) return hit;
  if (value.length > 0) return { bancsCsrfName: '', bancsCsrfValue: value };
  return EMPTY_CSRF;
}

export default scanCsrf;
