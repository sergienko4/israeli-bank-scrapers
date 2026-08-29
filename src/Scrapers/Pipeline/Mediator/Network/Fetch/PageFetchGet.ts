/**
 * Fetch sub-module — in-page GET requests (Playwright page.evaluate).
 *
 * Cookies + CORS are handled by the browser context. Public surface:
 *   - fetchGetWithinPage
 *   - fetchGetWithinPageWithHeaders
 */

import type { Frame, Page } from 'playwright-core';

import type { Nullable } from '../../../../Base/Interfaces/CallbackTypes.js';
import { redactUrlFull } from '../../../Types/PiiRedactor.js';
import { timeoutPromise } from '../../Timing/TimingActions.js';
import { NETWORK_FETCH_PAGE_TIMEOUT_MS, NETWORK_FETCH_TIMEOUT_MS } from '../FetchConfig.js';
import type { PageFetchTuple } from './Bounce.js';
import { assertNotBounced, toResponseFacts } from './Bounce.js';
import { logApiCall, logResponseIssues } from './Logging.js';
import { parseGetResult } from './ParseResult.js';

/** Args for the in-page GET evaluate callback. */
interface IGetArgs {
  url: string;
  timeoutMs: number;
}

/**
 * In-page evaluator for {@link evaluateGet} — runs inside the browser context.
 *
 * Serialised into the page, so it may reference only its argument and browser
 * globals; the timeout arrives as data rather than a closed-over import.
 * @param args - URL + abort budget.
 * @returns [responseText, statusCode, contentType, redirected, finalUrl].
 */
async function evalGetBody(args: IGetArgs): Promise<PageFetchTuple> {
  const signal = AbortSignal.timeout(args.timeoutMs);
  const response = await fetch(args.url, { credentials: 'include', signal });
  const text = response.status === 204 ? '' : await response.text();
  const type = response.headers.get('content-type') ?? '';
  return [text, response.status, type, response.redirected, response.url] as const;
}

/**
 * GET request inside the browser context (cookies + CORS handled by browser).
 * @param context - The Playwright page or frame context.
 * @param url - The URL to fetch.
 * @returns The evaluator response tuple.
 */
async function evaluateGet(context: Page | Frame, url: string): Promise<PageFetchTuple> {
  const timeoutMs = NETWORK_FETCH_PAGE_TIMEOUT_MS;
  const pending = context.evaluate(evalGetBody, { url, timeoutMs });
  return timeoutPromise(NETWORK_FETCH_TIMEOUT_MS, pending, `in-page GET ${redactUrlFull(url)}`);
}

/** Args for the in-page GET-with-headers evaluate callback. */
interface IGetWithHeadersArgs {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

/**
 * In-page evaluator for {@link evaluateGetWithHeaders} — runs inside
 * the browser context. Pulled to module scope so the caller fits cap.
 * @param args - URL + extra headers + abort budget.
 * @returns [responseText, statusCode, contentType, redirected, finalUrl].
 */
async function evalGetWithHeadersBody(args: IGetWithHeadersArgs): Promise<PageFetchTuple> {
  const signal = AbortSignal.timeout(args.timeoutMs);
  const init = { credentials: 'include' as const, headers: args.headers, signal };
  const response = await fetch(args.url, init);
  const text = response.status === 204 ? '' : await response.text();
  const type = response.headers.get('content-type') ?? '';
  return [text, response.status, type, response.redirected, response.url] as const;
}

/**
 * GET request with custom headers inside the browser context.
 * @param context - The Playwright page or frame context.
 * @param url - The URL to fetch.
 * @param headers - Extra headers to include.
 * @returns The evaluator response tuple.
 */
async function evaluateGetWithHeaders(
  context: Page | Frame,
  url: string,
  headers: Record<string, string>,
): Promise<PageFetchTuple> {
  const timeoutMs = NETWORK_FETCH_PAGE_TIMEOUT_MS;
  const pending = context.evaluate(evalGetWithHeadersBody, { url, headers, timeoutMs });
  return timeoutPromise(NETWORK_FETCH_TIMEOUT_MS, pending, `in-page GET ${redactUrlFull(url)}`);
}

/**
 * Common tail for {@link fetchGetWithinPage} variants — log, bounce-check, parse.
 *
 * The bounce check sits before the parser so a WAF interstitial or login
 * redirect is reported as a typed {@link WafBlockError} rather than as the
 * `Unexpected token '<'` parse failure it would otherwise become.
 * @param args - Bundled response tuple + url + start + ignore-flag.
 * @returns Parsed JSON or EMPTY_RESULT on swallowed parse error.
 */
function finalisePageGet<TResult>(args: IFinalisePageGetArgs): Nullable<TResult> {
  const { response, url, startMs, shouldIgnoreErrors } = args;
  const [result, status] = response;
  logApiCall(`GET(page) ${redactUrlFull(url).slice(-100)}`, status, Date.now() - startMs);
  logResponseIssues(status, result, url);
  const facts = toResponseFacts(response, url);
  assertNotBounced(facts, shouldIgnoreErrors);
  return parseGetResult({ result, status, url, shouldIgnoreErrors }) as TResult;
}

/** Bundled args for {@link finalisePageGet} — keeps the sig under max-params. */
interface IFinalisePageGetArgs {
  response: PageFetchTuple;
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
  const response = await evaluateGet(page, url);
  return finalisePageGet<TResult>({ response, url, startMs, shouldIgnoreErrors });
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
  const response = await evaluateGetWithHeaders(page, url, extraHeaders);
  return finalisePageGet<TResult>({ response, url, startMs, shouldIgnoreErrors: false });
}
