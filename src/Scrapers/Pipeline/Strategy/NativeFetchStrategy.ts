/**
 * Native fetch strategy — for API-only scrapers (no browser).
 * Stub: returns fail('NOT_IMPLEMENTED') until Step 8.
 */

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail } from '../Types/Procedure.js';
import type { IFetchStrategy } from './FetchStrategy.js';

/** Native fetch — uses Node.js fetch() with configurable headers. */
class NativeFetchStrategy implements IFetchStrategy {
  protected readonly _baseUrl: string;

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
   * @returns Failure Procedure (stub).
   */
  public fetchPost<T>(url: string, data: Record<string, string>): Promise<Procedure<T>> {
    const keyCount = String(Object.keys(data).length);
    const msg = `NativeFetchStrategy stub: POST ${url} (${keyCount} keys, base: ${this._baseUrl})`;
    const result = fail(ScraperErrorTypes.Generic, msg);
    return Promise.resolve(result);
  }

  /**
   * GET via native fetch (stub).
   * @param url - Target URL.
   * @returns Failure Procedure (stub).
   */
  public fetchGet<T>(url: string): Promise<Procedure<T>> {
    const msg = `NativeFetchStrategy stub: GET ${url} (base: ${this._baseUrl})`;
    const result = fail(ScraperErrorTypes.Generic, msg);
    return Promise.resolve(result);
  }
}

export default NativeFetchStrategy;
export { NativeFetchStrategy };
