/**
 * Pluggable fetch strategy — abstracts how HTTP calls are made.
 * Returns Procedure<T> (never null/undefined).
 */

import type { Procedure } from '../../Types/Procedure.js';

/**
 * Callback receiving the raw Set-Cookie header lines from a response.
 * `responseUrl` is the URL of the response that carried them — after any
 * redirect fetch followed — when the transport knows it; empty or absent
 * means the request URL. Returns a count of entries the consumer chose to
 * keep (or 0 when the caller did not ingest anything). Non-void per Rule #15.
 */
type OnSetCookie = (setCookies: readonly string[], responseUrl?: string) => number;

/** Optional fetch configuration. */
interface IFetchOpts {
  /** Additional HTTP headers to include in the request. */
  readonly extraHeaders: Record<string, string>;
  /**
   * Optional hook — invoked once per response with the array of raw
   * Set-Cookie header lines. Absent when the caller doesn't care
   * about cookies (the non-Pepper default).
   */
  readonly onSetCookie?: OnSetCookie;
}

/** Default fetch options — no extra headers. */
const DEFAULT_FETCH_OPTS: IFetchOpts = { extraHeaders: {} };

/** JSON-serializable POST body — strings, arrays, or nested objects. */
type PostData = Record<string, string | string[] | object>;

/** Fetch strategy interface — all fetches return strong-typed Procedure. */
interface IFetchStrategy {
  /** POST with optional extra headers. */
  fetchPost<T>(url: string, data: PostData, opts: IFetchOpts): Promise<Procedure<T>>;

  /** GET with optional extra headers. */
  fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>>;
}

export type { IFetchOpts, IFetchStrategy, OnSetCookie, PostData };
export { DEFAULT_FETCH_OPTS };
