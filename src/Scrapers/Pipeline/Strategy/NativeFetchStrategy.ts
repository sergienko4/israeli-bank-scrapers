/**
 * Native fetch strategy — for API-only scrapers (no browser).
 * Stub: returns fail('NOT_IMPLEMENTED') until Step 8.
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail } from '../Types/Procedure.js';
import type { IFetchOpts, IFetchStrategy } from './FetchStrategy.js';

/** Base API URL string for this strategy instance. */
type BaseUrlStr = string;

/** Native fetch — uses Node.js fetch() with configurable headers. */
class NativeFetchStrategy implements IFetchStrategy {
  protected readonly _baseUrl: BaseUrlStr;

  /**
   * Create a NativeFetchStrategy.
   * @param baseUrl - The base URL for API requests.
   */
  constructor(baseUrl: string) {
    this._baseUrl = baseUrl;
  }

  /**
   * POST via native fetch (stub).
   * @param url - Target URL.
   * @param data - POST body.
   * @param opts - Fetch options with extra headers.
   * @returns Failure Procedure (stub).
   */
  public fetchPost<T>(
    url: string,
    data: Record<string, string>,
    opts: IFetchOpts,
  ): Promise<Procedure<T>> {
    const keyCount = String(Object.keys(data).length);
    const headerCount = String(Object.keys(opts.extraHeaders).length);
    const base = this._baseUrl;
    const msg = `NativeFetchStrategy stub: POST ${url} (${keyCount}k, ${headerCount}h, ${base})`;
    const result = fail(ScraperErrorTypes.Generic, msg);
    return Promise.resolve(result);
  }

  /**
   * GET via native fetch (stub).
   * @param url - Target URL.
   * @param opts - Fetch options with extra headers.
   * @returns Failure Procedure (stub).
   */
  public fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> {
    const headerCount = String(Object.keys(opts.extraHeaders).length);
    const base = this._baseUrl;
    const msg = `NativeFetchStrategy stub: GET ${url} (${headerCount}h, ${base})`;
    const result = fail(ScraperErrorTypes.Generic, msg);
    return Promise.resolve(result);
  }
}

export default NativeFetchStrategy;
export { NativeFetchStrategy };
