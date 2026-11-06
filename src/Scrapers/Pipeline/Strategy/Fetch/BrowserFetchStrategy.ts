/**
 * Browser-based fetch strategy — runs through Playwright page session.
 * Wraps fetchPostWithinPage/fetchGetWithinPage from
 * Scrapers/Pipeline/Mediator/Network/Fetch/index.ts.
 * Returns Procedure<T> — never throws.
 *
 * After the .ashx removal there is no proxy session activation; every
 * bank uses fetchPost / fetchGet directly through the browser context.
 */

import type { Frame, Page } from 'playwright-core';

import { WafBlockError } from '../../../Base/Errors.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { getDebug } from '../../Logging/Debug.js';
import {
  fetchGetWithinPage,
  fetchGetWithinPageWithHeaders,
  fetchPostWithinPage,
} from '../../Mediator/Network/Fetch/index.js';
import { TimeoutError } from '../../Mediator/Timing/TimingActions.js';
import type { Brand } from '../../Types/Brand.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, failWithDetails, isOk, succeed } from '../../Types/Procedure.js';
import { hasCookieSentinel, substituteCookieHeaders } from './CookieHeaderSentinel.js';
import type { IFetchOpts, IFetchStrategy } from './FetchStrategy.js';

type IsTargetFrame = Brand<boolean, 'IsTargetFrame'>;

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
 *
 * The deadline is enforced in Node by `timeoutPromise`, so the timeout arrives
 * as a real {@link TimeoutError} rather than engine-specific abort text — the
 * classification is a type check, not a string match. A {@link WafBlockError}
 * is preserved for the same reason: `ApiMediator` treats `WafBlocked` as
 * terminal, and flattening it to `Generic` would hide the block behind a retry.
 * Its `details` ride along, because `toLegacy` forwards them to the caller —
 * plain `fail` would return the right type with none of the evidence.
 * @param error - The caught error.
 * @returns The narrowest failure type the error supports.
 */
function catchError(error: Error): Procedure<never> {
  const message = toErrorMessage(error);
  if (error instanceof TimeoutError) return fail(ScraperErrorTypes.Timeout, message);
  const blockType = ScraperErrorTypes.WafBlocked;
  if (error instanceof WafBlockError) return failWithDetails(blockType, message, error.details);
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
  const frame = page.frames().find((f): IsTargetFrame => {
    const frameUrl = f.url();
    if (!frameUrl || frameUrl === 'about:blank') return false as IsTargetFrame;
    return (new URL(frameUrl).origin === targetOrigin) as IsTargetFrame;
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

/**
 * GET inside the page — the plain GET when no header is left to send, so a
 * GET whose sentinels all dropped matches one that had no headers.
 * @param ctx - Page or frame the request runs in.
 * @param url - Target URL.
 * @param headers - Outgoing headers, sentinels already resolved.
 * @returns The page fetch's parsed result.
 */
function getWithinPage<T>(
  ctx: Page | Frame,
  url: string,
  headers: Record<string, string>,
): Promise<NullableFetchResult<T>> {
  const hasHeaders = Object.keys(headers).length > 0;
  if (!hasHeaders) return fetchGetWithinPage<T>(ctx, url, false);
  return fetchGetWithinPageWithHeaders<T>(ctx, url, headers);
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
    const headers = await this.resolveHeaders(url, opts.extraHeaders);
    if (!isOk(headers)) return headers;
    return fetchPostWithinPage<T>(ctx, url, { data, extraHeaders: headers.value })
      .then((result): Procedure<T> => resultToProcedure(result, url))
      .catch(catchError);
  }

  /**
   * GET via browser page session; `@cookie:` sentinels resolve as on a POST.
   * @param url - Target URL.
   * @param opts - Optional fetch config (extraHeaders).
   * @returns Procedure with parsed response or failure.
   */
  public async fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> {
    const ctx = resolveContext(this._page, url);
    const headers = await this.resolveHeaders(url, opts.extraHeaders);
    if (!isOk(headers)) return headers;
    return getWithinPage<T>(ctx, url, headers.value)
      .then((result): Procedure<T> => resultToProcedure(result, url))
      .catch(catchError);
  }

  /**
   * Resolve `@cookie:<name>` header sentinels against the live page cookie jar,
   * scoped to the request URL so only that URL's cookies are read; skips the
   * cookie read when no sentinel is present so non-anti-replay banks pay zero
   * overhead.
   * @param url - Request URL the cookies are scoped to.
   * @param headers - Outgoing header map (possibly with sentinels).
   * @returns Header map with sentinels resolved, or the failure that stops
   *   the request before the page fetch, including a rejected cookie read.
   */
  private async resolveHeaders(
    url: string,
    headers: Record<string, string>,
  ): Promise<Procedure<Record<string, string>>> {
    const isPresent: boolean = hasCookieSentinel(headers);
    if (!isPresent) return succeed(headers);
    const jarRead = this._page.context().cookies(url);
    const jar = await jarRead.then(succeed, catchError);
    if (!isOk(jar)) return jar;
    return substituteCookieHeaders(headers, jar.value);
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
