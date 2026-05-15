import { type Frame, type Page } from 'playwright-core';

import type { Nullable } from '../../../Base/Interfaces/CallbackTypes.js';
import ScraperError from '../../../Base/ScraperError.js';
import type { Brand } from '../../Types/Brand.js';
import { getDebug } from '../../Types/Debug.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../Types/LogEvent.js';

/** WAF/IP block description (empty when no block detected). */
type WafBlockDescription = Brand<string, 'WafBlockDescription'>;
import {
  BODY_PREVIEW_LIMIT,
  JSON_CONTENT_TYPE,
  WAF_BLOCK_PATTERNS,
  WAF_STATUS_CODES,
} from './FetchConfig.js';

const LOG = getDebug(import.meta.url);

/** Typed null value for Nullable return types — avoids the no-restricted-syntax rule on `return null`. */
const EMPTY_RESULT: Nullable<never> = JSON.parse('null') as Nullable<never>;

/**
 * Build standard JSON request headers for API calls.
 * @returns An object with Accept and Content-Type set to JSON.
 */
function getJsonHeaders(): Record<string, string> {
  return {
    Accept: JSON_CONTENT_TYPE,
    'Content-Type': JSON_CONTENT_TYPE,
  };
}

/**
 * Detect WAF/IP block from HTTP status or response body patterns.
 * @param status - The HTTP response status code.
 * @param body - The response body text.
 * @returns A description of the detected block, or empty string if none.
 */
export function detectWafBlock(status: number, body: string): WafBlockDescription {
  if (WAF_STATUS_CODES.has(status)) {
    return `HTTP ${String(status)}` as WafBlockDescription;
  }
  if (!body) return '' as WafBlockDescription;
  const lower = body.toLowerCase();
  const match = WAF_BLOCK_PATTERNS.find((pattern): boolean => lower.includes(pattern));
  if (match) return `response contains "${match}"` as WafBlockDescription;
  return '' as WafBlockDescription;
}

/**
 * Log an API call with its tag, status, and duration.
 * @param tag - A short description of the API call.
 * @param status - The HTTP response status code.
 * @param durationMs - Time elapsed in milliseconds.
 * @returns True after logging completes.
 */
function logApiCall(tag: string, status: number, durationMs: number): boolean {
  LOG.debug({
    message: `${tag} → ${String(status)} (${String(durationMs)}ms)`,
  });
  return true;
}

/**
 * Log response issues such as non-200 status or WAF blocks.
 * @param status - The HTTP response status code.
 * @param text - The response body text (empty string for 204 responses).
 * @param url - The request URL for debug output.
 * @returns True after logging completes.
 */
function logResponseIssues(status: number, text: string, url: string): boolean {
  if (text !== '') {
    const bodyPreview = text.substring(0, BODY_PREVIEW_LIMIT);
    LOG.debug({
      message: `response body: ${maskVisibleText(bodyPreview)}`,
    });
  }
  if (status !== 200 && status !== 204) {
    LOG.debug({
      message: `non-200: status=${String(status)} url=${maskVisibleText(url)}`,
    });
  }
  const wafReason = detectWafBlock(status, text);
  if (wafReason) {
    LOG.debug({
      message: `WAF block: ${wafReason} url=${maskVisibleText(url)}`,
    });
  }
  return true;
}

/**
 * Parse and log the response from a native fetch GET request.
 * @param fetchResult - The fetch Response object.
 * @param url - The original request URL for error reporting.
 * @param startMs - The start timestamp for duration calculation.
 * @returns The parsed JSON response body.
 */
async function parseFetchGetResponse<TResult>(
  fetchResult: Response,
  url: string,
  startMs: number,
): Promise<TResult> {
  const elapsed = Date.now() - startMs;
  const urlTail = url.slice(-100);
  logApiCall(`GET ${urlTail}`, fetchResult.status, elapsed);
  const text = await fetchResult.text();
  const bodyPreview = text.substring(0, BODY_PREVIEW_LIMIT);
  LOG.debug({
    message: `response body: ${maskVisibleText(bodyPreview)}`,
  });
  if (fetchResult.status !== 200) {
    const statusStr = String(fetchResult.status);
    throw new ScraperError(`GET request returned status ${statusStr}`);
  }
  return JSON.parse(text) as TResult;
}

/**
 * Perform a GET request with JSON headers using native fetch.
 * @param url - The URL to fetch.
 * @param extraHeaders - Additional HTTP headers.
 * @returns The parsed JSON response body.
 */
export async function fetchGet<TResult>(
  url: string,
  extraHeaders: Record<string, string>,
): Promise<TResult> {
  const jsonHeaders = getJsonHeaders();
  const merged = Object.assign(jsonHeaders, extraHeaders);
  const startMs = Date.now();
  const fetchResult = await fetch(url, {
    method: 'GET',
    headers: merged,
  });
  return parseFetchGetResponse<TResult>(fetchResult, url, startMs);
}

/** JSON-serializable value for API request/response bodies. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Perform a POST request with JSON body using native fetch.
 * @param url - The URL to post to.
 * @param data - The request body as a plain object.
 * @param extraHeaders - Additional HTTP headers.
 * @returns The parsed JSON response body.
 */
export async function fetchPost<TResult>(
  url: string,
  data: Record<string, JsonValue>,
  extraHeaders: Record<string, string> = {},
): Promise<TResult> {
  const request = {
    method: 'POST',
    headers: { ...getJsonHeaders(), ...extraHeaders },
    body: JSON.stringify(data),
  };
  const startMs = Date.now();
  const result = await fetch(url, request);
  logApiCall(`POST ${url.slice(-100)}`, result.status, Date.now() - startMs);
  const text = await result.text();
  const preview = text.substring(0, BODY_PREVIEW_LIMIT);
  LOG.debug({
    message: `response body: ${maskVisibleText(preview)}`,
  });
  return JSON.parse(text) as TResult;
}

/** Options for GraphQL fetch requests. */
export interface IFetchGraphqlOptions {
  variables?: Record<string, JsonValue>;
  extraHeaders?: Record<string, string>;
}

interface IGraphqlResponse<TResult> {
  data: TResult;
  errors?: { message: string }[];
}

/**
 * Perform a GraphQL query using fetchPost.
 * @param url - The GraphQL endpoint URL.
 * @param query - The GraphQL query string.
 * @param opts - Optional variables and extra headers.
 * @returns The parsed data field from the GraphQL response.
 */
export async function fetchGraphql<TResult>(
  url: string,
  query: string,
  opts: IFetchGraphqlOptions = {},
): Promise<TResult> {
  const { variables = {}, extraHeaders = {} } = opts;
  const result = await fetchPost<IGraphqlResponse<TResult>>(
    url,
    { operationName: '', query, variables },
    extraHeaders,
  );
  const firstError = result.errors?.[0];
  if (firstError) {
    throw new ScraperError(firstError.message);
  }
  return result.data;
}

// ── Within-page fetch (via page.evaluate — SPA pivot ensures correct origin) ──

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
  return context.evaluate(
    async (args: {
      url: string;
      headers: Record<string, string>;
    }): Promise<readonly [string, number]> => {
      const response = await fetch(args.url, { credentials: 'include', headers: args.headers });
      if (response.status === 204) return ['', response.status] as const;
      return [await response.text(), response.status] as const;
    },
    { url, headers },
  );
}

/** Options for parsing a GET-within-page response. */
export interface IParseGetOpts {
  result: string;
  status: number;
  url: string;
  shouldIgnoreErrors: boolean;
}

/**
 * Parse the text result of a GET-within-page call into JSON.
 * @param opts - The response text, status, URL, and error handling flag.
 * @returns The parsed JSON object, null if parse fails and errors are ignored, or empty object for empty responses.
 */
function parseGetResult(opts: IParseGetOpts): Nullable<Record<string, JsonValue>> {
  const { result, status, url, shouldIgnoreErrors } = opts;
  if (result === '') return {};
  try {
    return JSON.parse(result) as Record<string, JsonValue>;
  } catch (error) {
    return handleParseError({
      err: error as Error,
      shouldIgnore: shouldIgnoreErrors,
      url,
      status,
      context: 'fetchGetWithinPage',
    });
  }
}

/** Options for handling a JSON parse error. */
interface IParseErrorOpts {
  readonly err: Error;
  readonly shouldIgnore: boolean;
  readonly url: string;
  readonly status: number;
  readonly context: string;
}

/**
 * Handle a JSON parse error — throw ScraperError or return EMPTY_RESULT.
 * @param opts - Error details and handling options.
 * @returns EMPTY_RESULT when errors are ignored.
 */
function handleParseError(opts: IParseErrorOpts): Nullable<Record<string, JsonValue>> {
  if (opts.shouldIgnore) return EMPTY_RESULT;
  const msg = toErrorMessage(opts.err);
  const statusStr = String(opts.status);
  throw new ScraperError(
    `${opts.context} parse error: ${msg}, url: ${opts.url}, status: ${statusStr}`,
  );
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
  const elapsed = Date.now() - startMs;
  logApiCall(`GET(page) ${url.slice(-100)}`, status, elapsed);
  logResponseIssues(status, result, url);
  return parseGetResult({ result, status, url, shouldIgnoreErrors }) as TResult;
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
  const elapsed = Date.now() - startMs;
  logApiCall(`GET(page) ${url.slice(-100)}`, status, elapsed);
  logResponseIssues(status, result, url);
  return parseGetResult({ result, status, url, shouldIgnoreErrors: false }) as TResult;
}

/** Options for fetchPostWithinPage. */
export interface IFetchPostOptions {
  data: Record<string, JsonValue> | readonly JsonValue[];
  extraHeaders?: Record<string, string>;
  shouldIgnoreErrors?: boolean;
}

/** Arguments for POST requests via Playwright's API client. */
interface IPostEvaluateArgs {
  innerUrl: string;
  innerDataJson: string;
  innerExtraHeaders: Record<string, string>;
}

/**
 * POST fetch inside the browser context (cookies + CORS handled by browser).
 * @param args - The URL, data, and extra headers.
 * @returns [responseText, statusCode].
 */
async function doPostFetch(args: IPostEvaluateArgs): Promise<readonly [string, number]> {
  // No hardcoded headers: `args.innerExtraHeaders` (built by
  // `buildDiscoveredHeaders` from captured SPA traffic) is the
  // single source of truth for Content-Type / Referer / X-XSRF-
  // TOKEN / pageUuid / etc. Hapoalim rejects (302) any mismatch
  // between the SPA's captured shape and the replayed POST —
  // live evidence: run 15-05-2026 — hardcoded `Content-Type`
  // value collided with captured `content-type`; only the
  // captured value gets the API to 200.
  const response = await fetch(args.innerUrl, {
    method: 'POST',
    body: args.innerDataJson,
    credentials: 'include',
    headers: { ...args.innerExtraHeaders },
  });
  if (response.status === 204) return ['', 204] as const;
  return [await response.text(), response.status] as const;
}

/**
 * POST request via page.evaluate — runs inside the browser context.
 * The SPA pivot in ScrapePhase.PRE ensures the page is on the correct origin.
 * @param context - The Playwright page or frame to execute the fetch in.
 * @param args - The URL, data, and extra headers.
 * @returns A tuple of [responseBody, httpStatus].
 */
async function runPostEvaluate(
  context: Page | Frame,
  args: IPostEvaluateArgs,
): Promise<readonly [string, number]> {
  // Temporary diagnostic — Phase H'' VisaCal 401 investigation
  // 15-05-2026: print the EXACT header set we hand to the browser
  // fetch so we can compare against the SPA's captured request.
  const headerNames = Object.keys(args.innerExtraHeaders).sort((a, b): number =>
    a.localeCompare(b),
  );
  LOG.debug({
    event: 'doPostFetch.headers',
    url: args.innerUrl,
    headerNames,
    bodyLen: args.innerDataJson.length,
  });
  return context.evaluate(doPostFetch, args);
}

/** Options for parsing a POST-within-page response. */
export interface IParsePostOpts {
  text: string;
  status: number;
  url: string;
  opts: IFetchPostOptions;
}

/**
 * Parse the text result of a POST-within-page call into JSON.
 * @param pOpts - The response text, status, URL, and fetch options.
 * @returns The parsed JSON object, null if parse fails and errors are ignored, or empty object for empty responses.
 */
function parsePostResult(pOpts: IParsePostOpts): Nullable<Record<string, JsonValue>> {
  const { text, status, url, opts } = pOpts;
  const { shouldIgnoreErrors = false } = opts;
  if (text === '') return {};
  try {
    return JSON.parse(text) as Record<string, JsonValue>;
  } catch (error) {
    return handleParseError({
      err: error as Error,
      shouldIgnore: shouldIgnoreErrors,
      url,
      status,
      context: 'fetchPostWithinPage',
    });
  }
}

/**
 * Perform a POST request inside a Playwright page context (with cookies).
 * @param page - The Playwright page or frame context.
 * @param url - The URL to post to.
 * @param opts - Request body, optional extra headers, and error handling.
 * @returns The parsed JSON response body, or null on failure when errors are ignored.
 */
export async function fetchPostWithinPage<TResult>(
  page: Page | Frame,
  url: string,
  opts: IFetchPostOptions,
): Promise<Nullable<TResult>> {
  const { data, extraHeaders = {} } = opts;
  const startMs = Date.now();
  const [text, status] = await runPostEvaluate(page, {
    innerUrl: url,
    innerDataJson: JSON.stringify(data),
    innerExtraHeaders: extraHeaders,
  });
  const elapsed = Date.now() - startMs;
  logApiCall(`POST(page) ${url.slice(-100)}`, status, elapsed);
  logResponseIssues(status, text, url);
  return parsePostResult({ text, status, url, opts }) as TResult;
}
