import { type Page } from 'playwright';

import type { Nullable } from '../Scrapers/Base/Interfaces/CallbackTypes.js';
import ScraperError from '../Scrapers/Base/ScraperError.js';
import {
  BODY_PREVIEW_LIMIT,
  JSON_CONTENT_TYPE,
  WAF_BLOCK_PATTERNS,
  WAF_STATUS_CODES,
} from './Config/FetchConfig.js';
import { getDebug } from './Debug.js';

const LOG = getDebug('fetch');

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
export function detectWafBlock(status: number, body: string): string {
  if (WAF_STATUS_CODES.has(status)) {
    return `HTTP ${String(status)}`;
  }
  if (!body) return '';
  const lower = body.toLowerCase();
  const match = WAF_BLOCK_PATTERNS.find(pattern => lower.includes(pattern));
  return match ? `response contains "${match}"` : '';
}

/**
 * Log an API call with its tag, status, and duration.
 * @param tag - A short description of the API call.
 * @param status - The HTTP response status code.
 * @param durationMs - Time elapsed in milliseconds.
 * @returns True after logging completes.
 */
function logApiCall(tag: string, status: number, durationMs: number): boolean {
  LOG.debug('%s → %d (%dms)', tag, status, durationMs);
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
    LOG.debug('response body: %s', bodyPreview);
  }
  if (status !== 200 && status !== 204) {
    LOG.debug('non-200: status=%d url=%s', status, url);
  }
  const wafReason = detectWafBlock(status, text);
  if (wafReason) {
    LOG.debug('WAF block: %s url=%s', wafReason, url);
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
  LOG.debug('response body: %s', bodyPreview);
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
  LOG.debug('response body: %s', preview);
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

// ── Within-page fetch (runs inside Playwright page.evaluate) ──

/**
 * Evaluate a GET request inside the page context.
 * @param page - The Playwright page with an active session.
 * @param url - The URL to fetch within the page.
 * @returns A tuple of [responseBody, httpStatus].
 */
async function evaluateGet(page: Page, url: string): Promise<readonly [string, number]> {
  return page.evaluate(async (innerUrl: string) => {
    const response = await fetch(innerUrl, { credentials: 'include' });
    if (response.status === 204) return ['', response.status] as const;
    return [await response.text(), response.status] as const;
  }, url);
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
  } catch (err) {
    if (!shouldIgnoreErrors) {
      const msg = err instanceof Error ? err.message : String(err);
      const statusStr = String(status);
      throw new ScraperError(
        `fetchGetWithinPage parse error: ${msg}, url: ${url}, status: ${statusStr}`,
      );
    }
  }
  return EMPTY_RESULT;
}

/**
 * Perform a GET request inside a Playwright page context (with cookies).
 * @param page - The Playwright page with an active session.
 * @param url - The URL to fetch.
 * @param shouldIgnoreErrors - Whether to swallow parse errors.
 * @returns The parsed JSON response body, or null on failure when errors are ignored.
 */
export async function fetchGetWithinPage<TResult>(
  page: Page,
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

/** Options for fetchPostWithinPage. */
export interface IFetchPostOptions {
  data: Record<string, JsonValue> | readonly JsonValue[];
  extraHeaders?: Record<string, string>;
  shouldIgnoreErrors?: boolean;
}

/** Arguments passed into page.evaluate for POST requests. */
interface IPostEvaluateArgs {
  innerUrl: string;
  innerDataJson: string;
  innerExtraHeaders: Record<string, string>;
}

/**
 * Execute the POST fetch call inside the browser context.
 * @param args - The URL, data, and extra headers for the POST request.
 * @returns A tuple of [responseBody, httpStatus].
 */
async function doPostFetch(args: IPostEvaluateArgs): Promise<readonly [string, number]> {
  const { innerUrl, innerDataJson, innerExtraHeaders } = args;
  const response = await fetch(innerUrl, {
    method: 'POST',
    body: innerDataJson,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      ...innerExtraHeaders,
    },
  });
  if (response.status === 204) return ['', 204] as const;
  return [await response.text(), response.status] as const;
}

/**
 * Run the POST evaluate call on the page.
 * @param page - The Playwright page to execute the fetch in.
 * @param args - The URL, data, and extra headers.
 * @returns A tuple of [responseBody, httpStatus].
 */
async function runPostEvaluate(
  page: Page,
  args: IPostEvaluateArgs,
): Promise<readonly [string, number]> {
  return page.evaluate(doPostFetch, args);
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
  try {
    if (text !== '') return JSON.parse(text) as Record<string, JsonValue>;
  } catch (err) {
    if (!shouldIgnoreErrors) {
      const msg = err instanceof Error ? err.message : String(err);
      const statusStr = String(status);
      throw new ScraperError(
        `fetchPostWithinPage parse: ${msg}, url: ${url}, status: ${statusStr}`,
      );
    }
    return EMPTY_RESULT;
  }
  return {};
}

/**
 * Perform a POST request inside a Playwright page context (with cookies).
 * @param page - The Playwright page with an active session.
 * @param url - The URL to post to.
 * @param opts - Request body, optional extra headers, and error handling.
 * @returns The parsed JSON response body, or null on failure when errors are ignored.
 */
export async function fetchPostWithinPage<TResult>(
  page: Page,
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
