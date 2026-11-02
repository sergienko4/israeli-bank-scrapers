/**
 * Session cookie headers — the headers a session jar sends to one URL.
 *
 * With a domain jar, a `@cookie:<name>` header value is replaced by that
 * cookie's value for the request URL, decoded by `decodeCookieLenient` (a
 * malformed escape, or a decoded value no header can hold, is sent raw); a
 * `@cookie-strict:<name>` value must decode, or the request fails; the
 * header takes its `?<fallback>`, or is dropped, when no such cookie
 * applies. An origin jar leaves header values as they are.
 * Every request then carries the origin's cookie header. Each function
 * returns a `Procedure`, so a header that cannot be resolved stops the
 * request, or the redirect hop, before it is sent. Cookie values are never
 * logged.
 */

import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { cookieSentinelHeaders, substituteCookieHeadersBy } from './CookieHeaderSentinel.js';
import { decodeCookieLenient } from './CookieValueDecode.js';
import type { IDomainCookieJar } from './DomainCookieJar.js';
import type { ISessionHeaders } from './FetchStrategy.js';
import type { IOriginCookieJar } from './OriginCookieJar.js';

/** The jar the decorator keeps; only a domain jar reads single cookies. */
interface ISessionJar extends IOriginCookieJar {
  readonly cookieFor?: IDomainCookieJar['cookieFor'];
}

/**
 * Resolve cookie sentinels in the caller's headers through a domain jar.
 * @param jar - Session jar.
 * @param url - Request URL.
 * @param headers - Caller headers.
 * @returns Headers with sentinels resolved, the caller's map for an origin
 *   jar, or the failure that stops the request.
 */
function withSentinels(
  jar: ISessionJar,
  url: string,
  headers: Record<string, string>,
): Procedure<Record<string, string>> {
  const { cookieFor } = jar;
  if (cookieFor === undefined) return succeed(headers);
  const lookup = cookieFor.bind(null, url);
  return substituteCookieHeadersBy(headers, { lookup, loose: decodeCookieLenient });
}

/**
 * Drop the caller's cookie header in any letter case: the jar owns it, and
 * fetch would otherwise send both values.
 * @param headers - Caller headers.
 * @returns The caller's headers without a cookie header.
 */
function withoutCookie(headers: Record<string, string>): Record<string, string> {
  const kept = Object.entries(headers).filter(([name]): boolean => name.toLowerCase() !== 'cookie');
  return Object.fromEntries(kept);
}

/**
 * Add the origin's cookie header to the caller's headers, replacing the
 * caller's own cookie header.
 * @param jar - Session jar.
 * @param url - Request URL.
 * @param headers - Caller headers.
 * @returns Headers with `cookie`, or the caller's map when the jar is empty.
 */
function withCookieHeader(
  jar: IOriginCookieJar,
  url: string,
  headers: Record<string, string>,
): Record<string, string> {
  const cookie = jar.header(url);
  if (cookie === '') return headers;
  return { ...withoutCookie(headers), cookie };
}

/**
 * The caller's sentinel headers a domain jar resolves; none for an origin
 * jar, which leaves header values as they are.
 * @param jar - Session jar.
 * @param headers - Caller headers.
 * @returns The sentinel headers.
 */
function sentinelHeaders(
  jar: ISessionJar,
  headers: Record<string, string>,
): Record<string, string> {
  if (jar.cookieFor === undefined) return {};
  return cookieSentinelHeaders(headers);
}

/**
 * The caller's headers for one URL: sentinels resolved through the jar, then
 * the origin's cookie header added.
 * @param jar - Session jar.
 * @param url - Request URL.
 * @param headers - Caller headers.
 * @returns The headers to send, or the failure that stops the request.
 */
function jarHeaders(
  jar: ISessionJar,
  url: string,
  headers: Record<string, string>,
): Procedure<Record<string, string>> {
  const resolved = withSentinels(jar, url, headers);
  if (!isOk(resolved)) return resolved;
  const withCookie = withCookieHeader(jar, url, resolved.value);
  return succeed(withCookie);
}

/**
 * The session's headers for one URL: the Cookie header and every sentinel
 * header, each computed for that URL.
 * @param jar - Session jar.
 * @param sentinels - The caller's sentinel headers.
 * @param url - Request URL.
 * @returns The owned header names and their values for the URL, or the
 *   failure that stops the hop.
 */
function sessionHeaders(
  jar: ISessionJar,
  sentinels: Record<string, string>,
  url: string,
): Procedure<ISessionHeaders> {
  const values = jarHeaders(jar, url, sentinels);
  if (!isOk(values)) return values;
  const names = Object.keys(sentinels).map((name): string => name.toLowerCase());
  return succeed({ owned: ['cookie', ...names], values: values.value });
}

export default jarHeaders;
export type { ISessionJar };
export { jarHeaders, sentinelHeaders, sessionHeaders };
