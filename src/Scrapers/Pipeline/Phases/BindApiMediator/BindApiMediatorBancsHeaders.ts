/**
 * BIND-API-MEDIATOR BaNCS SPA-header sniff — the TCS BaNCS SPA's Angular
 * HttpClient sets custom XHR headers (e.g. `X-Requested-With`, `Accept`,
 * `Accept-Language`) on every request; the BaNCS server validates their
 * presence and rejects a bare direct fetch with a generic 93194 exception whose
 * subject element is `origin`. The proven generic path seeds these from a
 * captured transactions request, but the hard model skips the dashboard nav
 * that triggers one — so this reads the identical header set from the login-boot
 * accounts POST (the SPA sends the same XHR headers on every `/account` call)
 * and the scrape steps replay it. Browser-controlled / forbidden headers
 * (cookie, origin, sec-*, authorization) and `content-type` (set per-call) are
 * filtered out. PII-safe: only content-negotiation headers, never credentials.
 */

import { BROWSER_STANDARD_HEADERS } from '../../Mediator/Network/Indexing/Indexing.js';
import type { IDiscoveredEndpoint } from '../../Mediator/Network/Types/Endpoint.js';

/** The BaNCS multiplexed accounts POST — carries the SPA's XHR header set. */
const ACCOUNT_URL_MATCH = '/BaNCSDigitalApp/account';

/** The captured SPA header bag, JSON-encoded (empty string when none). */
export interface IBancsSpaHeaders {
  readonly bancsSpaHeaders: string;
}

/** Empty capture — no SPA header bag replayed when the sniff finds none. */
const EMPTY_SPA: IBancsSpaHeaders = { bancsSpaHeaders: '' };

/**
 * Whether a captured request header is a replayable SPA header — not a
 * browser-controlled / forbidden one and not `content-type` (set per-call).
 * @param name - Captured header name (any casing).
 * @returns True when the header should ride the hard-model calls.
 */
function isReplayable(name: string): boolean {
  const lower = name.toLowerCase();
  return !BROWSER_STANDARD_HEADERS.has(lower) && lower !== 'content-type';
}

/**
 * Keep only the SPA's replayable custom request headers.
 * @param headers - Captured request headers.
 * @returns Filtered SPA header map.
 */
function keepSpaHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const spa = Object.entries(headers).filter(([name]): boolean => isReplayable(name));
  return Object.fromEntries(spa);
}

/**
 * Whether an endpoint is an accounts POST carrying captured request headers.
 * @param ep - Captured endpoint.
 * @returns True when it can seed the SPA header bag.
 */
function isHeaderSource(ep: IDiscoveredEndpoint): boolean {
  if (ep.method !== 'POST' || !ep.url.includes(ACCOUNT_URL_MATCH)) return false;
  return Object.keys(ep.requestHeaders).length > 0;
}

/**
 * Sniff the SPA's custom request headers from the first login-boot accounts
 * POST carrying request headers (empty when none captured).
 * @param pool - Login-inclusive discovery captures.
 * @returns The JSON-encoded SPA header bag, or the empty capture.
 */
export function scanSpaHeaders(pool: readonly IDiscoveredEndpoint[]): IBancsSpaHeaders {
  const ep = pool.find(isHeaderSource);
  if (ep === undefined) return EMPTY_SPA;
  const bag = keepSpaHeaders(ep.requestHeaders);
  return { bancsSpaHeaders: JSON.stringify(bag) };
}

export default scanSpaHeaders;
