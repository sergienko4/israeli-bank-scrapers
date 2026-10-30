/**
 * Session cookie decorator — one run-scoped cookie jar in front of a fetch
 * strategy. Every response's Set-Cookie lines feed the jar; every request
 * sends the jar as one `cookie` header (an empty jar adds nothing). Built only
 * for node transports whose headless block sets `sessionCookies`; the browser
 * transport keeps the page's own jar. Cookie values are never logged.
 */

import type { Procedure } from '../../Types/Procedure.js';
import { createSimpleCookieJar, type ICookieJar } from './CookieJar.js';
import type { IFetchOpts, IFetchStrategy, OnSetCookie, PostData } from './FetchStrategy.js';

/** Mediator-args slice carrying the opt-in flag. */
interface ISessionCookiesFlag {
  readonly sessionCookies?: boolean;
}

/**
 * Add the jar's cookie header to the caller's headers.
 * @param jar - Session jar.
 * @param headers - Caller headers.
 * @returns Headers with `cookie`, or the caller's map when the jar is empty.
 */
function withCookieHeader(
  jar: ICookieJar,
  headers: Record<string, string>,
): Record<string, string> {
  const cookie = jar.header();
  if (cookie === '') return headers;
  return { ...headers, cookie };
}

/**
 * Feed Set-Cookie lines to the jar, then to the caller's own hook when set.
 * @param jar - Session jar.
 * @param callerSink - Optional caller hook.
 * @returns Combined sink returning the jar size.
 */
function chainCookieSink(jar: ICookieJar, callerSink?: OnSetCookie): OnSetCookie {
  return (lines): number => {
    const size = jar.add(lines);
    if (callerSink) callerSink(lines);
    return size;
  };
}

/**
 * Fold the jar into one request's fetch options.
 * @param jar - Session jar.
 * @param opts - Caller fetch options.
 * @returns Options carrying the cookie header and the jar sink.
 */
function withJar(jar: ICookieJar, opts: IFetchOpts): IFetchOpts {
  const extraHeaders = withCookieHeader(jar, opts.extraHeaders);
  const onSetCookie = chainCookieSink(jar, opts.onSetCookie);
  return { extraHeaders, onSetCookie };
}

/** Fetch strategy decorator carrying one session cookie jar across calls. */
class SessionCookieFetchStrategy implements IFetchStrategy {
  private readonly _inner: IFetchStrategy;

  private readonly _jar: ICookieJar = createSimpleCookieJar();

  /**
   * Wrap a transport.
   * @param inner - The transport that sends the requests.
   */
  constructor(inner: IFetchStrategy) {
    this._inner = inner;
  }

  /**
   * POST through the inner transport with the session cookies.
   * @param url - Target URL.
   * @param data - POST body.
   * @param opts - Caller fetch options.
   * @returns The inner transport's Procedure.
   */
  public async fetchPost<T>(url: string, data: PostData, opts: IFetchOpts): Promise<Procedure<T>> {
    const jarOpts = withJar(this._jar, opts);
    return this._inner.fetchPost<T>(url, data, jarOpts);
  }

  /**
   * GET through the inner transport with the session cookies.
   * @param url - Target URL.
   * @param opts - Caller fetch options.
   * @returns The inner transport's Procedure.
   */
  public async fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> {
    const jarOpts = withJar(this._jar, opts);
    return this._inner.fetchGet<T>(url, jarOpts);
  }
}

/**
 * Wrap a transport in a session jar when the bank opts in.
 * @param transport - The headless identity transport.
 * @param args - Mediator args carrying the optional `sessionCookies` flag.
 * @returns The decorated transport, or the same transport when the flag is off.
 */
function withSessionCookies(transport: IFetchStrategy, args: ISessionCookiesFlag): IFetchStrategy {
  if (args.sessionCookies !== true) return transport;
  return Reflect.construct(SessionCookieFetchStrategy, [transport]);
}

export default SessionCookieFetchStrategy;
export { SessionCookieFetchStrategy, withSessionCookies };
