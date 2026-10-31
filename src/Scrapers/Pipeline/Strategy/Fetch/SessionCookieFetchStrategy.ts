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
 * transports whose headless block sets `sessionCookies`; the browser transport
 * keeps the page's own jar. A bank that also sets `cookieDomains` gets the RFC 6265 domain jar
 * instead, and `withCookieSession` hands its port (`ICookieSession`) to the
 * mediator so login steps can read, set, export, import and clear cookies.
 * With a domain jar, a `@cookie:<name>` header value is replaced by that
 * cookie's URI-decoded value for the request URL (a malformed escape, or a
 * decoded value no header can hold, is sent raw); the header is dropped when
 * no such cookie applies. An origin jar
 * leaves header values as they are. Cookie values are never logged.
 */

import type { ICookieSession } from '../../Types/Domain/CookieSession.js';
import type { Option } from '../../Types/Option.js';
import { isSome, none, some } from '../../Types/Option.js';
import type { Procedure } from '../../Types/Procedure.js';
import { cookieSentinelHeaders, substituteCookieHeadersBy } from './CookieHeaderSentinel.js';
import { createDomainCookieJar, type IDomainCookieJar } from './DomainCookieJar.js';
import type {
  IFetchOpts,
  IFetchStrategy,
  ISessionHeaders,
  OnSetCookie,
  PostData,
} from './FetchStrategy.js';
import { isHeaderSafe } from './HeaderText.js';
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

/** The jar the decorator keeps; only a domain jar reads single cookies. */
interface ISessionJar extends IOriginCookieJar {
  readonly cookieFor?: IDomainCookieJar['cookieFor'];
}

/**
 * URI-decode a cookie value for a header, keeping it raw when an escape is
 * malformed or the decoded text cannot travel in a header.
 * @param raw - Stored cookie value.
 * @returns The decoded value, or the raw value.
 */
function decodeCookieValue(raw: string): string {
  try {
    const decoded = decodeURIComponent(raw);
    return isHeaderSafe(decoded) ? decoded : raw;
  } catch {
    return raw;
  }
}

/**
 * The decoded value of one cookie that applies to a URL.
 * @param cookieFor - The domain jar's single-cookie read.
 * @param url - Request URL.
 * @param name - Cookie name.
 * @returns The decoded value, or none when no such cookie applies.
 */
function decodedCookie(
  cookieFor: IDomainCookieJar['cookieFor'],
  url: string,
  name: string,
): Option<string> {
  const raw = cookieFor(url, name);
  if (!isSome(raw)) return raw;
  const decoded = decodeCookieValue(raw.value);
  return some(decoded);
}

/**
 * Resolve `@cookie:` sentinels in the caller's headers through a domain jar.
 * @param jar - Session jar.
 * @param url - Request URL.
 * @param headers - Caller headers.
 * @returns Headers with sentinels resolved, or the caller's map for an
 *   origin jar.
 */
function withSentinels(
  jar: ISessionJar,
  url: string,
  headers: Record<string, string>,
): Record<string, string> {
  const { cookieFor } = jar;
  if (cookieFor === undefined) return headers;
  const lookup = decodedCookie.bind(null, cookieFor, url);
  return substituteCookieHeadersBy(headers, lookup);
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
 * The caller's `@cookie:` headers a domain jar resolves; none for an origin
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
 * The session's headers for one URL: the Cookie header and every sentinel
 * header, each computed for that URL.
 * @param jar - Session jar.
 * @param sentinels - The caller's sentinel headers.
 * @param url - Request URL.
 * @returns The owned header names and their values for the URL.
 */
function sessionHeaders(
  jar: ISessionJar,
  sentinels: Record<string, string>,
  url: string,
): ISessionHeaders {
  const resolved = withSentinels(jar, url, sentinels);
  const values = withCookieHeader(jar, url, resolved);
  const names = Object.keys(sentinels).map((name): string => name.toLowerCase());
  return { owned: ['cookie', ...names], values };
}

/**
 * Fold the jar into one request's fetch options.
 * @param jar - Session jar.
 * @param url - Request URL.
 * @param opts - Caller fetch options.
 * @returns The caller's options with sentinels resolved, plus the cookie
 *   header, the jar sink and the per-hop session headers.
 */
function withJar(jar: ISessionJar, url: string, opts: IFetchOpts): IFetchOpts {
  const headers = withSentinels(jar, url, opts.extraHeaders);
  const extraHeaders = withCookieHeader(jar, url, headers);
  const onSetCookie = chainCookieSink(jar, url, opts.onSetCookie);
  const sentinels = sentinelHeaders(jar, opts.extraHeaders);
  const sessionHeadersFor = sessionHeaders.bind(null, jar, sentinels);
  return { ...opts, extraHeaders, onSetCookie, sessionHeadersFor };
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
