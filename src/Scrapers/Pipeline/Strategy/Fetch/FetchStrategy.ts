/**
 * Pluggable fetch strategy — abstracts how HTTP calls are made.
 * Returns Procedure<T> (never null/undefined).
 */

import type { ApiPostData } from '../../Types/Domain/ApiPostData.js';
import type { IFetchCallPolicy, IResponseReading } from '../../Types/Domain/FetchPolicy.js';
import type { Procedure } from '../../Types/Procedure.js';

/** HTTP method verbs a node transport sends. */
type HttpVerb = 'GET' | 'POST';

/**
 * Transport seam — performs the raw request and yields a Procedure<Response>.
 * The native strategy binds it to globalThis.fetch; capped and mTLS
 * subclasses replace it while reusing all downstream response parsing,
 * cookie emission, redirect policy and logging.
 */
type FetchInvoke = (url: string, init: RequestInit, verb: HttpVerb) => Promise<Procedure<Response>>;

/**
 * Callback receiving the raw Set-Cookie header lines from a response.
 * `responseUrl` is the URL of the response that carried them — after any
 * redirect fetch followed — when the transport knows it; empty or absent
 * means the request URL. Returns a count of entries the consumer chose to
 * keep (or 0 when the caller did not ingest anything). Non-void per Rule #15.
 */
type OnSetCookie = (setCookies: readonly string[], responseUrl?: string) => number;

/**
 * The headers a session sends to one URL. `owned` names (lower-case) every
 * header the session controls — `cookie` and each `@cookie:` header; a
 * redirect hop drops them all and sends only `values`, so a header owned by
 * the session never carries a value computed for another URL.
 */
interface ISessionHeaders {
  readonly owned: readonly string[];
  readonly values: Readonly<Record<string, string>>;
}

/** Optional fetch configuration; the call policy overrides the transport's default. */
interface IFetchOpts extends IFetchCallPolicy, Pick<IResponseReading, 'onEmptyResponse'> {
  /** Additional HTTP headers to include in the request. */
  readonly extraHeaders: Record<string, string>;
  /**
   * Optional hook — invoked once per response with the array of raw
   * Set-Cookie header lines. Absent when the caller doesn't care
   * about cookies (the non-Pepper default).
   */
  readonly onSetCookie?: OnSetCookie;
  /**
   * The session's headers for a URL. Set by the session decorator; the
   * transport calls it once per manual redirect hop.
   */
  readonly sessionHeadersFor?: (url: string) => ISessionHeaders;
}

/** Default fetch options — no extra headers. */
const DEFAULT_FETCH_OPTS: IFetchOpts = { extraHeaders: {} };

/** JSON-serializable POST body — an object or a top-level array (N19). */
type PostData = ApiPostData;

/** Fetch strategy interface — all fetches return strong-typed Procedure. */
interface IFetchStrategy {
  /** POST with optional extra headers. */
  fetchPost<T>(url: string, data: PostData, opts: IFetchOpts): Promise<Procedure<T>>;

  /** GET with optional extra headers. */
  fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>>;
}

export type {
  FetchInvoke,
  HttpVerb,
  IFetchOpts,
  IFetchStrategy,
  ISessionHeaders,
  OnSetCookie,
  PostData,
};
export { DEFAULT_FETCH_OPTS };
