/**
 * Browser-based fetch strategy — runs through Playwright page session.
 * Stub: returns fail('NOT_IMPLEMENTED') until Step 3.
 */

import type { Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail } from '../Types/Procedure.js';
import type { IFetchStrategy } from './FetchStrategy.js';

/** Browser fetch — delegates to fetchPostWithinPage/fetchGetWithinPage. */
class BrowserFetchStrategy implements IFetchStrategy {
  private readonly _page: Page;

  /**
   * Create a BrowserFetchStrategy.
   * @param page - The Playwright page for fetch context.
   */
  constructor(page: Page) {
    this._page = page;
  }

  /**
   * POST via browser page session (stub).
   * @param url - Target URL.
   * @param data - POST body.
   * @returns Failure Procedure (stub).
   */
  public fetchPost<T>(url: string, data: Record<string, string>): Promise<Procedure<T>> {
    const pageUrl = this._page.url();
    const keyCount = String(Object.keys(data).length);
    const msg = `BrowserFetchStrategy stub: POST ${url} (${keyCount} keys, page: ${pageUrl})`;
    const result = fail(ScraperErrorTypes.Generic, msg);
    return Promise.resolve(result);
  }

  /**
   * GET via browser page session (stub).
   * @param url - Target URL.
   * @returns Failure Procedure (stub).
   */
  public fetchGet<T>(url: string): Promise<Procedure<T>> {
    const pageUrl = this._page.url();
    const msg = `BrowserFetchStrategy stub: GET ${url} (page: ${pageUrl})`;
    const result = fail(ScraperErrorTypes.Generic, msg);
    return Promise.resolve(result);
  }
}

export default BrowserFetchStrategy;
export { BrowserFetchStrategy };
