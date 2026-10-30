/**
 * Origin-scoped cookie jar — one simple jar per origin, so a cookie only goes
 * back to the origin that set it. Host-only and fail-closed: a `Domain`
 * attribute never widens a cookie to a sibling host, and a URL that cannot be
 * parsed neither sends nor keeps a cookie. Request URLs resolve exactly as the
 * node transports resolve them. Never logs values.
 */

import { createSimpleCookieJar, type ICookieJar } from './CookieJar.js';
import { resolveFetchUrl } from './NativeFetchStrategy.js';

/** Origin-scoped cookie jar — ingest and emit per request URL. */
interface IOriginCookieJar {
  add: (url: string, setCookieLines: readonly string[]) => number;
  header: (url: string) => string;
}

/** Origin key of a URL that cannot be parsed; its jar is never stored. */
const NO_ORIGIN = '';

/**
 * Origin of a request URL, resolved against the transport's base URL.
 * @param baseUrl - The transport's base URL.
 * @param url - Caller-supplied URL (absolute or relative).
 * @returns The origin, or NO_ORIGIN when the URL cannot be parsed.
 */
function originOf(baseUrl: string, url: string): string {
  const fullUrl = resolveFetchUrl(baseUrl, url);
  const parsed = URL.parse(fullUrl);
  if (parsed === null) return NO_ORIGIN;
  return parsed.origin;
}

/**
 * The jar for one request URL's origin, created on first use. An unparseable
 * URL gets a throwaway jar, so it neither sends nor keeps a cookie.
 * @param jars - Jars by origin.
 * @param baseUrl - The transport's base URL.
 * @param url - Caller-supplied URL (absolute or relative).
 * @returns The origin's jar.
 */
function jarFor(jars: Map<string, ICookieJar>, baseUrl: string, url: string): ICookieJar {
  const origin = originOf(baseUrl, url);
  if (origin === NO_ORIGIN) return createSimpleCookieJar();
  const known = jars.get(origin);
  if (known !== undefined) return known;
  const created = createSimpleCookieJar();
  jars.set(origin, created);
  return created;
}

/**
 * Bind the origin-scoped add method to its jars.
 * @param jars - Jars by origin.
 * @param baseUrl - The transport's base URL.
 * @returns Add function.
 */
function bindOriginAdd(jars: Map<string, ICookieJar>, baseUrl: string): IOriginCookieJar['add'] {
  return (url, lines): number => jarFor(jars, baseUrl, url).add(lines);
}

/**
 * Bind the origin-scoped header method to its jars.
 * @param jars - Jars by origin.
 * @param baseUrl - The transport's base URL.
 * @returns Header function.
 */
function bindOriginHeader(
  jars: Map<string, ICookieJar>,
  baseUrl: string,
): IOriginCookieJar['header'] {
  return (url): string => jarFor(jars, baseUrl, url).header();
}

/**
 * Build an origin-scoped jar for one transport.
 * @param baseUrl - The transport's base URL, which relative URLs join.
 * @returns The origin-scoped jar.
 */
function createOriginCookieJar(baseUrl: string): IOriginCookieJar {
  const jars = new Map<string, ICookieJar>();
  return { add: bindOriginAdd(jars, baseUrl), header: bindOriginHeader(jars, baseUrl) };
}

export type { IOriginCookieJar };
export { createOriginCookieJar };
