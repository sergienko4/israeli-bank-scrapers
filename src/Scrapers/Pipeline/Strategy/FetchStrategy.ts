/**
 * Pluggable fetch strategy — abstracts how HTTP calls are made.
 * Returns Procedure<T> (never null/undefined).
 */

import type { ScraperCredentials } from '../../Base/Interface.js';
import type { IBankScraperConfig } from '../../Registry/Config/ScraperConfigDefaults.js';
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

/** Whether the session activation completed successfully. */
type SessionActivated = boolean;

/** Fetch strategy interface — all fetches return strong-typed Procedure. */
interface IFetchStrategy {
  /** POST with optional extra headers. */
  fetchPost<T>(url: string, data: PostData, opts: IFetchOpts): Promise<Procedure<T>>;

  /** GET with optional extra headers. */
  fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>>;

  /**
   * Optional session activation hook — establishes server-side session via API.
   * Called by DASHBOARD.ACTION when form-fill login doesn't propagate session.
   * Banks that don't need this leave it undefined (BYPASS strategy skips it).
   * @param credentials - User credentials for API-based auth handshake.
   * @param config - Bank config with auth params (companyCode, etc.).
   * @returns Procedure with activation result, or undefined if not supported.
   */
  activateSession?(
    credentials: ScraperCredentials,
    config: IBankScraperConfig,
  ): Promise<Procedure<SessionActivated>>;

  /**
   * Optional proxy GET — fetches data via .ashx proxy handler on the api.base domain.
   * Used when the data domain (web.) has a separate auth system.
   * Constructs URL: config.api.base/services/ProxyRequestHandler.ashx?reqName=...&params
   * @param config - Bank config with api.base URL.
   * @param reqName - The proxy request name (discovered from traffic, NOT hardcoded).
   * @param params - Additional query parameters.
   * @returns Procedure with parsed JSON response.
   */
  proxyGet?<T>(
    config: IBankScraperConfig,
    reqName: ProxyReqName,
    params: Record<string, string>,
  ): Promise<Procedure<T>>;
}

/** Proxy request name (discovered from traffic). */
type ProxyReqName = string;

export type { IFetchOpts, IFetchStrategy, PostData, ProxyReqName, SessionActivated };
export { DEFAULT_FETCH_OPTS };
