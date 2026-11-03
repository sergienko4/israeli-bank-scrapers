/**
 * Session cookie decorator — one run-scoped, origin-scoped cookie jar in front
 * of a fetch strategy. Every response's Set-Cookie lines feed the jar of the
 * origin that answered: the response's final URL when fetch followed a
 * redirect, else the request URL. Every request sends its origin's jar as one
 * `cookie` header, replacing a caller cookie header in any letter case (an
 * empty jar adds nothing), so a cookie never reaches another host. Fetch
 * follows redirects itself, so a redirect hop's own Set-Cookie lines never
 * reach the jar. Built only for node transports whose headless block sets
 * `sessionCookies`; the browser transport keeps the page's own jar. Cookie
 * values are never logged.
 */

import type { Procedure } from '../../Types/Procedure.js';
import type { IFetchOpts, IFetchStrategy, OnSetCookie, PostData } from './FetchStrategy.js';
import { createOriginCookieJar, type IOriginCookieJar } from './OriginCookieJar.js';

/** Mediator-args slice: the opt-in flag and the base URL relative paths join. */
interface ISessionCookieArgs {
  readonly sessionCookies?: boolean;
  readonly identityBaseUrl: string;
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
 * The URL whose origin set the cookies: the response's own URL, or the
 * request URL when the transport reports none (node:https and test doubles).
 * @param requestUrl - Request URL.
 * @param responseUrl - Response URL from the transport, when it has one.
 * @returns The URL the cookies are filed under.
 */
function answeringUrl(requestUrl: string, responseUrl?: string): string {
  if (responseUrl === undefined || responseUrl === '') return requestUrl;
  return responseUrl;
}

/**
 * Feed Set-Cookie lines to the answering origin's jar, then to the caller's
 * own hook.
 * @param jar - Session jar.
 * @param url - Request URL.
 * @param hook - The caller's own onSetCookie hook, when it has one.
 * @returns Combined sink returning the origin jar's size.
 */
function chainCookieSink(jar: IOriginCookieJar, url: string, hook?: OnSetCookie): OnSetCookie {
  return (lines, responseUrl): number => {
    const origin = answeringUrl(url, responseUrl);
    const size = jar.add(origin, lines);
    if (hook) hook(lines, responseUrl);
    return size;
  };
}

/**
 * Fold the jar into one request's fetch options.
 * @param jar - Session jar.
 * @param url - Request URL.
 * @param opts - Caller fetch options.
 * @returns The caller's options plus the cookie header and the jar sink.
 */
function withJar(jar: IOriginCookieJar, url: string, opts: IFetchOpts): IFetchOpts {
  const extraHeaders = withCookieHeader(jar, url, opts.extraHeaders);
  const onSetCookie = chainCookieSink(jar, url, opts.onSetCookie);
  return { ...opts, extraHeaders, onSetCookie };
}

/** Fetch strategy decorator carrying one session cookie jar across calls. */
class SessionCookieFetchStrategy implements IFetchStrategy {
  private readonly _inner: IFetchStrategy;

  private readonly _jar: IOriginCookieJar;

  /**
   * Wrap a transport.
   * @param inner - The transport that sends the requests.
   * @param baseUrl - The transport's base URL, which relative URLs join.
   */
  constructor(inner: IFetchStrategy, baseUrl: string) {
    this._inner = inner;
    this._jar = createOriginCookieJar(baseUrl);
  }

  /**
   * POST through the inner transport with the origin's session cookies.
   * @param url - Target URL.
   * @param data - POST body.
   * @param opts - Caller fetch options.
   * @returns The inner transport's Procedure.
   */
  public async fetchPost<T>(url: string, data: PostData, opts: IFetchOpts): Promise<Procedure<T>> {
    const jarOpts = withJar(this._jar, url, opts);
    return this._inner.fetchPost<T>(url, data, jarOpts);
  }

  /**
   * GET through the inner transport with the origin's session cookies.
   * @param url - Target URL.
   * @param opts - Caller fetch options.
   * @returns The inner transport's Procedure.
   */
  public async fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> {
    const jarOpts = withJar(this._jar, url, opts);
    return this._inner.fetchGet<T>(url, jarOpts);
  }
}

/**
 * Wrap a transport in a session jar when the bank opts in.
 * @param transport - The headless identity transport.
 * @param args - Mediator args: the optional `sessionCookies` flag and the
 *   transport's base URL.
 * @returns The decorated transport, or the same transport when the flag is off.
 */
function withSessionCookies(transport: IFetchStrategy, args: ISessionCookieArgs): IFetchStrategy {
  if (args.sessionCookies !== true) return transport;
  return Reflect.construct(SessionCookieFetchStrategy, [transport, args.identityBaseUrl]);
}

export default SessionCookieFetchStrategy;
export { SessionCookieFetchStrategy, withSessionCookies };
