/**
 * Browser-based fetch strategy — runs through Playwright page session.
 * Wraps fetchPostWithinPage/fetchGetWithinPage from Common/Fetch.ts.
 * Returns Procedure<T> — never throws.
 *
 * After the .ashx removal there is no proxy session activation; every
 * bank uses fetchPost / fetchGet directly through the browser context.
 */

import type { Frame, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import {
  fetchGetWithinPage,
  fetchGetWithinPageWithHeaders,
  fetchPostWithinPage,
} from '../../Mediator/Network/Fetch.js';
import { getDebug } from '../../Types/Debug.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IFetchOpts, IFetchStrategy } from './FetchStrategy.js';

const LOG = getDebug(import.meta.url);

/**
 * Build a failure for an empty fetch response.
 * @param url - The URL that returned empty.
 * @returns A Generic failure Procedure.
 */
function emptyResponseError(url: string): Procedure<never> {
  const truncated = url.slice(-80);
  return fail(ScraperErrorTypes.Generic, `Fetch returned empty response: ${truncated}`);
}

/** Nullable fetch result — truthy means data was returned. */
type NullableFetchResult<T> = T | null | false | undefined;

/**
 * Convert a nullable fetch result to a Procedure.
 * @param result - The fetch result (falsy if empty).
 * @param url - The URL for error reporting.
 * @returns Succeed with data, or empty-response failure.
 */
function resultToProcedure<T>(result: NullableFetchResult<T>, url: string): Procedure<T> {
  if (result) return succeed(result as T);
  return emptyResponseError(url);
}

/**
 * Build a failure from a caught fetch exception.
 * @param error - The caught error.
 * @returns A Generic failure Procedure.
 */
function catchError(error: Error): Procedure<never> {
  const message = toErrorMessage(error);
  return fail(ScraperErrorTypes.Generic, message);
}

/**
 * Find a frame matching the target URL's origin.
 * @param page - Playwright page with attached frames.
 * @param targetUrl - The API URL to fetch.
 * @returns Matching frame, or the page itself.
 */
function resolveContext(page: Page, targetUrl: string): Page | Frame {
  const targetOrigin = new URL(targetUrl).origin;
  const pageOrigin = new URL(page.url()).origin;
  if (targetOrigin === pageOrigin) return page;
  const frame = page.frames().find((f): boolean => {
    const frameUrl = f.url();
    if (!frameUrl || frameUrl === 'about:blank') return false;
    return new URL(frameUrl).origin === targetOrigin;
  });
  if (frame) {
    const frameUrl = frame.url().slice(0, 50);
    LOG.trace({
      message: `using iframe context: ${frameUrl}`,
    });
    return frame;
  }
  return page;
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
   * @param opts - Optional fetch config (extraHeaders).
   * @returns Procedure with parsed response or failure.
   */
  public async fetchPost<T>(
    url: string,
    data: Record<string, string>,
    opts: IFetchOpts,
  ): Promise<Procedure<T>> {
    const ctx = resolveContext(this._page, url);
    return fetchPostWithinPage<T>(ctx, url, { data, extraHeaders: opts.extraHeaders })
      .then((result): Procedure<T> => resultToProcedure(result, url))
      .catch(catchError);
  }

  /**
   * GET via browser page session.
   * @param url - Target URL.
   * @param opts - Optional fetch config (extraHeaders).
   * @returns Procedure with parsed response or failure.
   */
  public async fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> {
    const hasHeaders = Object.keys(opts.extraHeaders).length > 0;
    const ctx = resolveContext(this._page, url);
    if (!hasHeaders) {
      return fetchGetWithinPage<T>(ctx, url, false)
        .then((result): Procedure<T> => resultToProcedure(result, url))
        .catch(catchError);
    }
    return fetchGetWithinPageWithHeaders<T>(ctx, url, opts.extraHeaders)
      .then((result): Procedure<T> => resultToProcedure(result, url))
      .catch(catchError);
  }
}

/**
 * Factory: create a BrowserFetchStrategy bound to a page.
 * @param page - The Playwright page for fetch context.
 * @returns IFetchStrategy implementation using browser session.
 */
function createBrowserFetchStrategy(page: Page): IFetchStrategy {
  return Reflect.construct(BrowserFetchStrategy, [page]);
}

export default BrowserFetchStrategy;
export { BrowserFetchStrategy, createBrowserFetchStrategy };
