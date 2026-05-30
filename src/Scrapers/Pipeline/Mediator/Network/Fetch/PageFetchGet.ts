/**
 * Fetch sub-module — in-page GET requests (Playwright page.evaluate).
 *
 * Cookies + CORS are handled by the browser context. Public surface:
 *   - fetchGetWithinPage
 *   - fetchGetWithinPageWithHeaders
 */

import type { Frame, Page } from 'playwright-core';

import type { Nullable } from '../../../../Base/Interfaces/CallbackTypes.js';
import { logApiCall, logResponseIssues } from './Logging.js';
import { parseGetResult } from './ParseResult.js';

/**
 * GET request inside the browser context (cookies + CORS handled by browser).
 * @param context - The Playwright page or frame context.
 * @param url - The URL to fetch.
 * @returns A tuple of [responseBody, httpStatus].
 */
async function evaluateGet(context: Page | Frame, url: string): Promise<readonly [string, number]> {
  return context.evaluate(async (innerUrl: string): Promise<readonly [string, number]> => {
    const response = await fetch(innerUrl, { credentials: 'include' });
    if (response.status === 204) return ['', response.status] as const;
    return [await response.text(), response.status] as const;
  }, url);
}

/** Args for the in-page GET-with-headers evaluate callback. */
interface IGetWithHeadersArgs {
  url: string;
  headers: Record<string, string>;
}

/**
 * In-page evaluator for {@link evaluateGetWithHeaders} — runs inside
 * the browser context. Pulled to module scope so the caller fits cap.
 * @param args - URL + extra headers bundle.
 * @returns [responseText, statusCode].
 */
async function evalGetWithHeadersBody(
  args: IGetWithHeadersArgs,
): Promise<readonly [string, number]> {
  const response = await fetch(args.url, { credentials: 'include', headers: args.headers });
  if (response.status === 204) return ['', response.status] as const;
  return [await response.text(), response.status] as const;
}

/**
 * GET request with custom headers inside the browser context.
 * @param context - The Playwright page or frame context.
 * @param url - The URL to fetch.
 * @param headers - Extra headers to include.
 * @returns [responseText, statusCode].
 */
async function evaluateGetWithHeaders(
  context: Page | Frame,
  url: string,
  headers: Record<string, string>,
): Promise<readonly [string, number]> {
  return context.evaluate(evalGetWithHeadersBody, { url, headers });
}

/**
 * Common tail for {@link fetchGetWithinPage} variants — log + parse.
 * @param args - Bundled response text + status + url + start + ignore-flag.
 * @returns Parsed JSON or EMPTY_RESULT on swallowed parse error.
 */
function finalisePageGet<TResult>(args: IFinalisePageGetArgs): Nullable<TResult> {
  const { result, status, url, startMs, shouldIgnoreErrors } = args;
  logApiCall(`GET(page) ${url.slice(-100)}`, status, Date.now() - startMs);
  logResponseIssues(status, result, url);
  return parseGetResult({ result, status, url, shouldIgnoreErrors }) as TResult;
}

/** Bundled args for {@link finalisePageGet} — keeps the sig under max-params. */
interface IFinalisePageGetArgs {
  result: string;
  status: number;
  url: string;
  startMs: number;
  shouldIgnoreErrors: boolean;
}

/**
 * Perform a GET request inside a Playwright page context (with cookies).
 * @param page - The Playwright page or frame context.
 * @param url - The URL to fetch.
 * @param shouldIgnoreErrors - Whether to swallow parse errors.
 * @returns The parsed JSON response body, or null on failure when errors are ignored.
 */
export async function fetchGetWithinPage<TResult>(
  page: Page | Frame,
  url: string,
  shouldIgnoreErrors = false,
): Promise<Nullable<TResult>> {
  const startMs = Date.now();
  const [result, status] = await evaluateGet(page, url);
  return finalisePageGet<TResult>({ result, status, url, startMs, shouldIgnoreErrors });
}

/**
 * GET via browser page session with custom headers.
 * @param page - The Playwright page or frame context.
 * @param url - Target URL.
 * @param extraHeaders - Custom headers to include.
 * @returns Parsed JSON result or null.
 */
export async function fetchGetWithinPageWithHeaders<TResult>(
  page: Page | Frame,
  url: string,
  extraHeaders: Record<string, string>,
): Promise<Nullable<TResult>> {
  const startMs = Date.now();
  const [result, status] = await evaluateGetWithHeaders(page, url, extraHeaders);
  return finalisePageGet<TResult>({ result, status, url, startMs, shouldIgnoreErrors: false });
}
