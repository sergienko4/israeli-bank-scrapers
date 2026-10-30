/**
 * Session cookie decorator — one run-scoped, origin-scoped cookie jar in front
 * of a fetch strategy. Every response's Set-Cookie lines feed the jar of the
 * request's origin; every request sends that origin's jar as one `cookie`
 * header (an empty jar adds nothing), so a cookie never reaches another host.
 * Built only for node transports whose headless block sets `sessionCookies`;
 * the browser transport keeps the page's own jar. Cookie values are never
 * logged.
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
 * Add the origin's cookie header to the caller's headers.
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
  return { ...headers, cookie };
}

/**
 * Feed Set-Cookie lines to the origin's jar, then to the caller's own hook.
 * @param jar - Session jar.
 * @param url - Request URL.
 * @param callerSink - Optional caller hook.
 * @returns Combined sink returning the origin jar's size.
 */
function chainCookieSink(
  jar: IOriginCookieJar,
  url: string,
  callerSink?: OnSetCookie,
): OnSetCookie {
  return (lines): number => {
    const size = jar.add(url, lines);
    if (callerSink) callerSink(lines);
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
