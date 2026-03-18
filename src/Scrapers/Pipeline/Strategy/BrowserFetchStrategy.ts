/**
 * Browser-based fetch strategy — runs through Playwright page session.
 * Wraps fetchPostWithinPage/fetchGetWithinPage from Common/Fetch.ts.
 * Returns Procedure<T> — never throws.
 */

import type { Page } from 'playwright-core';

import { fetchGetWithinPage, fetchPostWithinPage } from '../../../Common/Fetch.js';
import { ScraperErrorTypes } from '../../Base/ErrorTypes.js';
import type { Procedure } from '../Types/Procedure.js';
import { fail, succeed } from '../Types/Procedure.js';
import type { IFetchStrategy } from './FetchStrategy.js';

/**
 * Build a failure for an empty fetch response.
 * @param url - The URL that returned empty.
 * @returns A Generic failure Procedure.
 */
function emptyResponseError(url: string): Procedure<never> {
  const truncated = url.slice(-80);
  return fail(ScraperErrorTypes.Generic, `Fetch returned empty response: ${truncated}`);
}

/**
 * Build a failure from a caught fetch exception.
 * @param error - The caught error.
 * @returns A Generic failure Procedure.
 */
function catchError(error: Error): Procedure<never> {
  return fail(ScraperErrorTypes.Generic, error.message);
}

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
   * POST via browser page session.
   * @param url - Target URL.
   * @param data - POST body key-value pairs.
   * @returns Procedure with parsed response or failure.
   */
  public async fetchPost<T>(url: string, data: Record<string, string>): Promise<Procedure<T>> {
    try {
      const result = await fetchPostWithinPage<T>(this._page, url, { data });
      if (result) return succeed(result);
      return emptyResponseError(url);
    } catch (error) {
      return catchError(error as Error);
    }
  }

  /**
   * GET via browser page session.
   * @param url - Target URL.
   * @returns Procedure with parsed response or failure.
   */
  public async fetchGet<T>(url: string): Promise<Procedure<T>> {
    try {
      const result = await fetchGetWithinPage<T>(this._page, url);
      if (result) return succeed(result);
      return emptyResponseError(url);
    } catch (error) {
      return catchError(error as Error);
    }
  }
}

export default BrowserFetchStrategy;
export { BrowserFetchStrategy };
