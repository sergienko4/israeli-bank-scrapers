/**
 * Session cookie decorator — one run-scoped, origin-scoped cookie jar in front
 * of a fetch strategy. Every response's Set-Cookie lines feed the jar of the
 * origin that answered: the response's final URL when fetch followed a
 * redirect, else the request URL. Every request sends its origin's jar as one
 * `cookie` header, replacing a caller cookie header in any letter case (an
 * empty jar adds nothing), so a cookie never reaches another host. Fetch
 * follows redirects itself, so a redirect hop's own Set-Cookie lines never
 * reach the jar. Built only for node transports whose headless block sets
 * `sessionCookies`; the browser transport keeps the page's own jar.
 * A bank that also sets `cookieDomains` gets the RFC 6265 domain jar
 * instead, and `withCookieSession` hands its port (`ICookieSession`) to the
 * mediator so login steps can read, set, export, import and clear cookies.
 * Cookie values are never logged.
 */

import type { ICookieSession } from '../../Types/Domain/CookieSession.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { createDomainCookieJar, type IDomainCookieJar } from './DomainCookieJar.js';
import type { IFetchOpts, IFetchStrategy, OnSetCookie, PostData } from './FetchStrategy.js';
import { createOriginCookieJar, type IOriginCookieJar } from './OriginCookieJar.js';

/** Mediator-args slice: the opt-in flags and the base URL relative paths join. */
interface ISessionCookieArgs {
  readonly sessionCookies?: boolean;
  readonly cookieDomains?: readonly string[];
  readonly identityBaseUrl: string;
}

/** A decorated transport and, for a domain jar, its cookie session. */
interface ISessionTransport {
  readonly transport: IFetchStrategy;
  readonly cookies?: ICookieSession;
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
   * @param jar - The jar to keep; default a fresh origin-scoped jar.
   */
  constructor(inner: IFetchStrategy, baseUrl: string, jar?: IOriginCookieJar) {
    this._inner = inner;
    this._jar = jar ?? createOriginCookieJar(baseUrl);
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

/**
 * The Cookie header a domain jar sends to a URL.
 * @param jar - Domain jar.
 * @param url - Request URL.
 * @returns The header, or none when no cookie applies.
 */
function headerOption(jar: IDomainCookieJar, url: string): Option<string> {
  const header = jar.header(url);
  if (header === '') return none();
  return some(header);
}

/**
 * The cookie-session port onto a domain jar.
 * @param jar - Domain jar the transport keeps.
 * @returns The port.
 */
function toCookieSession(jar: IDomainCookieJar): ICookieSession {
  const { cookieFor, set, exportAll, importAll, clear } = jar;
  const headerFor = headerOption.bind(null, jar);
  return { cookieFor, headerFor, set, exportAll, importAll, clear };
}

/**
 * Wrap a transport in its session jar and expose the domain jar's session.
 * @param transport - The headless identity transport.
 * @param args - Mediator args: `sessionCookies`, `cookieDomains`, base URL.
 * @returns The transport (decorated when the flag is on) and, only with
 *   `cookieDomains`, the cookie session sharing its jar.
 */
function withCookieSession(transport: IFetchStrategy, args: ISessionCookieArgs): ISessionTransport {
  const domains = args.cookieDomains;
  if (args.sessionCookies !== true || domains === undefined) {
    return { transport: withSessionCookies(transport, args) };
  }
  const jar = createDomainCookieJar(args.identityBaseUrl, domains);
  const ctorArgs = [transport, args.identityBaseUrl, jar] as const;
  const decorated = Reflect.construct(SessionCookieFetchStrategy, ctorArgs);
  return { transport: decorated, cookies: toCookieSession(jar) };
}

export default SessionCookieFetchStrategy;
export type { ISessionTransport };
export { SessionCookieFetchStrategy, withCookieSession, withSessionCookies };
