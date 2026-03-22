/**
 * Pluggable fetch strategy — abstracts how HTTP calls are made.
 * Returns Procedure<T> (never null/undefined).
 */

import type { Procedure } from '../Types/Procedure.js';

/** Optional fetch configuration. */
interface IFetchOpts {
  /** Additional HTTP headers to include in the request. */
  readonly extraHeaders: Record<string, string>;
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

export default IFetchStrategy;
export type { IFetchOpts, IFetchStrategy };
export { DEFAULT_FETCH_OPTS };
