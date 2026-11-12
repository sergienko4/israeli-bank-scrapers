/**
 * Session cookie decorator — one run-scoped, origin-scoped cookie jar in front
 * of a fetch strategy. Every response's Set-Cookie lines feed the jar of the
 * origin that answered: the response's final URL when fetch followed a
 * redirect, else the request URL. Every request sends its origin's jar as one
 * `cookie` header, replacing a caller cookie header in any letter case (an
 * empty jar adds nothing), so a cookie never reaches another host.
 * Under the default `follow` policy fetch follows redirects
 * itself, so a hop's own Set-Cookie lines never reach the jar; under a manual
 * redirect policy the transport files each hop's lines under the hop URL and
 * asks the decorator (`sessionHeadersFor`) for each hop's Cookie header and
 * `@cookie:` headers, recomputed for the hop URL. Built only for node
 * transports whose bank configuration sets `sessionCookies`. A bank that also
 * sets `cookieDomains` gets the RFC 6265 domain jar
 * instead, and `withCookieSession` hands its port (`ICookieSession`) to the
 * mediator so login steps can read, set, export, import and clear cookies.
 * The headers each request and hop sends — `@cookie:` sentinels resolved and
 * the cookie header added — come from `SessionCookieHeaders`; a failure there
 * stops the request before the inner transport is called. Cookie values are
 * never logged.
 */

import type { ICookieSession } from '../../Types/Domain/CookieSession.js';
import type { Option } from '../../Types/Option.js';
import { none, some } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { isOk, succeed } from '../../Types/Procedure.js';
import { createDomainCookieJar, type IDomainCookieJar } from './DomainCookieJar.js';
import type { IFetchOpts, IFetchStrategy, OnSetCookie, PostData } from './FetchStrategy.js';
import { createOriginCookieJar, type IOriginCookieJar } from './OriginCookieJar.js';
import {
  type ISessionJar,
  jarHeaders,
  sentinelHeaders,
  sessionHeaders,
} from './SessionCookieHeaders.js';

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
 * The Cookie header a jar sends to a URL.
 * @param jar - Session jar.
 * @param url - Request URL.
 * @returns The header, or none when no cookie applies.
 */
function headerOption(jar: IOriginCookieJar, url: string): Option<string> {
  const header = jar.header(url);
  if (header === '') return none();
  return some(header);
}

/**
 * Fold the jar into one request's fetch options.
 * @param jar - Session jar.
 * @param url - Request URL.
 * @param opts - Caller fetch options.
 * @returns The caller's options with sentinels resolved, plus the cookie
 *   header, the jar sink and the per-hop session headers; or the failure
 *   that stops the request before the inner transport is called.
 */
function withJar(jar: ISessionJar, url: string, opts: IFetchOpts): Procedure<IFetchOpts> {
  const headers = jarHeaders(jar, url, opts.extraHeaders);
  if (!isOk(headers)) return headers;
  const onSetCookie = chainCookieSink(jar, url, opts.onSetCookie);
  const sentinels = sentinelHeaders(jar, opts.extraHeaders);
  const sessionHeadersFor = sessionHeaders.bind(null, jar, sentinels);
  return succeed({ ...opts, extraHeaders: headers.value, onSetCookie, sessionHeadersFor });
}

/** Fetch strategy decorator carrying one session cookie jar across calls. */
class SessionCookieFetchStrategy implements IFetchStrategy {
  private readonly _inner: IFetchStrategy;

  private readonly _jar: ISessionJar;

  /**
   * Wrap a transport.
   * @param inner - The transport that sends the requests.
   * @param baseUrl - The transport's base URL, which relative URLs join.
   * @param jar - The jar to keep; default a fresh origin-scoped jar.
   */
  constructor(inner: IFetchStrategy, baseUrl: string, jar?: ISessionJar) {
    this._inner = inner;
    this._jar = jar ?? createOriginCookieJar(baseUrl);
  }

  /**
   * POST through the inner transport with the origin's session cookies.
   * @param url - Target URL.
   * @param data - POST body.
   * @param opts - Caller fetch options.
   * @returns The inner transport's Procedure, or the header failure.
   */
  public async fetchPost<T>(url: string, data: PostData, opts: IFetchOpts): Promise<Procedure<T>> {
    const jarOpts = withJar(this._jar, url, opts);
    if (!isOk(jarOpts)) return jarOpts;
    return this._inner.fetchPost<T>(url, data, jarOpts.value);
  }

  /**
   * GET through the inner transport with the origin's session cookies.
   * @param url - Target URL.
   * @param opts - Caller fetch options.
   * @returns The inner transport's Procedure, or the header failure.
   */
  public async fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> {
    const jarOpts = withJar(this._jar, url, opts);
    if (!isOk(jarOpts)) return jarOpts;
    return this._inner.fetchGet<T>(url, jarOpts.value);
  }
}

/**
 * Wrap a transport in a session jar when the bank opts in.
 * @param transport - The underlying HTTP strategy.
 * @param args - Mediator args: the optional `sessionCookies` flag and the
 *   transport's base URL.
 * @returns The decorated transport, or the same transport when the flag is off.
 */
function withSessionCookies(transport: IFetchStrategy, args: ISessionCookieArgs): IFetchStrategy {
  if (args.sessionCookies !== true) return transport;
  return Reflect.construct(SessionCookieFetchStrategy, [transport, args.identityBaseUrl]);
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
 * @param transport - The underlying HTTP strategy.
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
