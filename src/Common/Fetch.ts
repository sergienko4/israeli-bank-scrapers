import { type Page } from 'playwright';

import type { IFetchGraphqlOptions } from '../Interfaces/Common/FetchGraphqlOptions';
import type { FoundResult } from '../Interfaces/Common/FoundResult';
import type { IDoneResult } from '../Interfaces/Common/StepResult';
import { ScraperWebsiteChangedError } from '../Scrapers/Base/ScraperWebsiteChangedError';
import { getDebug } from './Debug';

export type { IFetchGraphqlOptions } from '../Interfaces/Common/FetchGraphqlOptions';

/**
 * Serialisable JSON POST body value — no unknown, no null, no circular refs.
 * Recursive to support nested objects (e.g. GraphQL variables).
 */
export type PostBody = string | number | boolean | null | PostBody[] | { [key: string]: PostBody };

const LOG = getDebug('fetch');

const JSON_CONTENT_TYPE = 'application/json';
const WAF_BLOCK_PATTERNS = [
  'block automation',
  'attention required',
  'just a moment',
  'access denied',
] as const;

/**
 * Returns the standard JSON Accept and Content-Type headers used for API requests.
 *
 * @returns a map of HTTP header names to their JSON media-type values
 */
function getJsonHeaders(): Record<string, string> {
  return {
    Accept: JSON_CONTENT_TYPE,
    'Content-Type': JSON_CONTENT_TYPE,
  };
}

/**
 * Inspects an HTTP response status and optional body text for signs of a WAF or IP block.
 * Returns a human-readable reason string when a block is detected, or undefined when clean.
 *
 * @param status - the HTTP response status code
 * @param body - the response body text, or empty string for empty responses
 * @returns a string describing the block reason, or empty string when no block is detected
 */
export function detectWafBlock(status: number, body: string): string {
  if (status === 403 || status === 429 || status === 503) {
    return `HTTP ${String(status)}`;
  }
  if (!body) return '';
  const lower = body.toLowerCase();
  const match = WAF_BLOCK_PATTERNS.find(pattern => lower.includes(pattern));
  return match ? `response contains "${match}"` : '';
}

/**
 * Logs a single API call with its HTTP status code and elapsed time.
 *
 * @param tag - a short label identifying the request (method + URL suffix)
 * @param status - the HTTP response status code
 * @param durationMs - the round-trip duration of the request in milliseconds
 * @returns a done result indicating the log entry was written
 */
function logApiCall(tag: string, status: number, durationMs: number): IDoneResult {
  LOG.info('%s → %d (%dms)', tag, status, durationMs);
  return { done: true };
}

/**
 * Logs diagnostic information about a response when it is non-200 or body indicates a WAF block.
 *
 * @param status - the HTTP response status code
 * @param text - the response body text, or empty string when the body is empty
 * @param url - the request URL, used to provide context in the log entry
 * @returns a done result indicating diagnostic logs were written
 */
function logResponseIssues(status: number, text: string, url: string): IDoneResult {
  if (text) {
    const bodySnippet = text.substring(0, 300);
    LOG.info('response body: %s', bodySnippet);
  }
  if (status !== 200 && status !== 204) {
    LOG.info('non-200: status=%d url=%s', status, url);
  }
  const wafReason = detectWafBlock(status, text);
  if (wafReason) {
    LOG.info('WAF block: %s url=%s', wafReason, url);
  }
  return { done: true };
}

/**
 * Asserts that a direct GET response has status 200, throwing on any other code.
 *
 * @param status - the HTTP response status code to validate
 * @throws ScraperWebsiteChangedError when status is not 200
 * @returns a done result indicating the status was valid
 */
function assertGetStatus200(status: number): IDoneResult {
  if (status !== 200) {
    throw new ScraperWebsiteChangedError(
      'Fetch',
      `request to institute server failed with status ${String(status)}`,
    );
  }
  return { done: true };
}

/**
 * Performs a GET request with JSON headers and returns the parsed response body.
 * Throws ScraperWebsiteChangedError when the server responds with a non-200 status.
 *
 * @param url - the URL to fetch
 * @param extraHeaders - additional HTTP headers to merge with the JSON defaults
 * @returns the parsed JSON response body typed as TResult
 */
export async function fetchGet<TResult>(
  url: string,
  extraHeaders: Record<string, string>,
): Promise<TResult> {
  const jsonHeaders = getJsonHeaders();
  const headers = Object.assign(jsonHeaders, extraHeaders);
  const startMs = Date.now();
  const fetchResult = await fetch(url, { method: 'GET', headers });
  const durationMs = Date.now() - startMs;
  logApiCall(`GET ${url.slice(-100)}`, fetchResult.status, durationMs);
  const text = await fetchResult.text();
  const textSnippet = text.substring(0, 300);
  LOG.info('response body: %s', textSnippet);
  assertGetStatus200(fetchResult.status);
  return JSON.parse(text) as TResult;
}

/**
 * Performs a POST request with a JSON-serialised body and returns the parsed response body.
 *
 * @param url - the URL to post to
 * @param data - the request payload to JSON-serialise as the request body
 * @param extraHeaders - additional HTTP headers to merge with the JSON defaults
 * @returns the parsed JSON response body typed as TResult
 */
export async function fetchPost<TResult = PostBody>(
  url: string,
  data: PostBody,
  extraHeaders: Record<string, string> = {},
): Promise<TResult> {
  const jsonHeaders = getJsonHeaders();
  const request = {
    method: 'POST',
    headers: { ...jsonHeaders, ...extraHeaders },
    body: JSON.stringify(data),
  };
  const startMs = Date.now();
  const result = await fetch(url, request);
  const durationMs = Date.now() - startMs;
  logApiCall(`POST ${url.slice(-100)}`, result.status, durationMs);
  const text = await result.text();
  const textSnippet = text.substring(0, 300);
  LOG.info('response body: %s', textSnippet);
  return JSON.parse(text) as TResult;
}

/**
 * Executes a GraphQL query via fetchPost and unwraps the typed data field from the response.
 * Throws ScraperWebsiteChangedError when the GraphQL response contains errors.
 *
 * @param url - the GraphQL endpoint URL
 * @param query - the GraphQL query string to execute
 * @param opts - optional variables and extra HTTP headers to include in the request
 * @returns the parsed `data` field from the GraphQL response typed as TResult
 */
export async function fetchGraphql<TResult>(
  url: string,
  query: string,
  opts: IFetchGraphqlOptions = {},
): Promise<TResult> {
  const { variables = {}, extraHeaders = {} } = opts;
  const result = await fetchPost<{ data: TResult; errors?: { message: string }[] }>(
    url,
    { operationName: null, query, variables },
    extraHeaders,
  );
  if (result.errors?.length) {
    throw new ScraperWebsiteChangedError('Fetch', result.errors[0].message);
  }
  return result.data;
}

/**
 * Asserts that an in-page GET evaluation completed without a network error.
 * Throws ScraperWebsiteChangedError when the evaluation result indicates failure.
 *
 * @param result - the evaluation result object returned from the browser context
 * @param result.ok - true when the fetch succeeded, false on network error
 * @param result.err - optional error message when ok is false
 * @param result.status - the HTTP status code from the in-page fetch
 * @param url - the request URL, included in the error message for diagnostics
 * @returns a done result indicating the evaluation succeeded
 */
function assertEvalGetOk(
  result: { ok: boolean; err?: string; status: number },
  url: string,
): IDoneResult {
  if (!result.ok)
    throw new ScraperWebsiteChangedError(
      'Fetch',
      `fetchGetWithinPage error: ${result.err ?? ''}, url: ${url}, status: ${String(result.status)}`,
    );
  return { done: true };
}

/**
 * Runs a GET fetch inside the browser's page context so the request carries the page's cookies.
 * Returns the response body text and status code as a readonly tuple.
 *
 * @param page - the Playwright Page whose browser context (and cookies) should be used
 * @param url - the URL to fetch from within the page context
 * @returns a tuple of [body text or empty string for 204, HTTP status code]
 */
async function evaluateGet(page: Page, url: string): Promise<readonly [string, number]> {
  // Use `as const` on ok: so TypeScript infers the discriminated union — no top-level type needed.
  const evalResult = await page.evaluate(async (innerUrl: string) => {
    try {
      const response = await fetch(innerUrl, { credentials: 'include' });
      const s = response.status;
      if (s === 204) return { ok: true as const, text: '', status: s };
      return { ok: true as const, text: await response.text(), status: s };
    } catch (e) {
      const errMsg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      return { ok: false as const, err: errMsg, status: 0 };
    }
  }, url);
  assertEvalGetOk(evalResult, url);
  return [evalResult.text ?? '', evalResult.status] as const;
}

/**
 * Formats a JSON parse error with full context and throws it as a ScraperWebsiteChangedError.
 *
 * @param e - the original parse exception
 * @param ctx - contextual information including the URL, raw response text, and HTTP status
 * @param ctx.url - the URL of the request that returned the unparseable response
 * @param ctx.result - the raw response body text that could not be parsed
 * @param ctx.status - the HTTP status code of the response
 * @returns never — always throws
 */
function throwGetParseError(
  e: unknown,
  ctx: { url: string; result: string; status: number },
): never {
  const errMsg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  throw new ScraperWebsiteChangedError(
    'Fetch',
    `fetchGetWithinPage parse error: ${errMsg}, ` +
      `url: ${ctx.url}, result: ${ctx.result}, status: ${String(ctx.status)}`,
  );
}

/**
 * Attempts to JSON-parse a GET response body, handling null and parse errors gracefully.
 * When shouldIgnoreErrors is false a parse failure throws ScraperWebsiteChangedError.
 *
 * @param opts - options including the raw result text, status code, URL, and error suppression flag
 * @param opts.result - the raw response body text, or empty string for empty responses
 * @param opts.status - the HTTP status code of the response
 * @param opts.url - the request URL, included in any thrown error for diagnostics
 * @param opts.shouldIgnoreErrors - when true, JSON parse failures return an empty string instead of throwing
 * @returns the parsed JSON value, or empty string when the result is empty or parsing is suppressed
 */
function parseGetResult(opts: {
  result: string;
  status: number;
  url: string;
  shouldIgnoreErrors: boolean;
}): PostBody {
  const { result, status, url, shouldIgnoreErrors } = opts;
  if (!result) return '';
  try {
    return JSON.parse(result) as PostBody;
  } catch (e) {
    if (!shouldIgnoreErrors) throwGetParseError(e, { url, result, status });
  }
  return '';
}

/**
 * Executes a GET request within the browser page context so session cookies are included.
 * Logs the response, detects WAF blocks, and returns the parsed JSON body or null.
 *
 * @param page - the Playwright Page whose session cookies should be sent with the request
 * @param url - the URL to fetch
 * @param shouldIgnoreErrors - when true, JSON parse failures return undefined instead of throwing
 * @returns a FoundResult wrapping the parsed JSON response, or isFound: false when the body is empty
 */
export async function fetchGetWithinPage<TResult>(
  page: Page,
  url: string,
  shouldIgnoreErrors = false,
): Promise<FoundResult<TResult>> {
  const startMs = Date.now();
  const [result, status] = await evaluateGet(page, url);
  const durationMs = Date.now() - startMs;
  logApiCall(`GET(page) ${url.slice(-100)}`, status, durationMs);
  logResponseIssues(status, result, url);
  const parsed = parseGetResult({ result, status, url, shouldIgnoreErrors });
  if (parsed === '') return { isFound: false };
  return { isFound: true, value: parsed as TResult };
}

/**
 * Compact serialisable args forwarded to doPostFetch inside page.evaluate().
 * body is a pre-serialised JSON string — avoids recursive PostBody depth issues in TypeScript.
 */
interface IDoPostFetchArgs {
  url: string;
  body: string;
  headers: Record<string, string>;
}

// NOTE: doPostFetch runs inside page.evaluate() (browser context).
// Must be entirely self-contained — no external function references allowed.
// Returns a plain object so the result can be JSON-serialised across the evaluate boundary.
/**
 * Self-contained POST fetch executed inside the browser's page context so session cookies are sent.
 * Must not reference any external module symbols — it is serialised and run in the browser VM.
 *
 * @param args - a compact argument object with URL, pre-serialised body, and extra headers
 * @param args.url - the URL to POST to
 * @param args.body - the pre-serialised JSON body string to send directly
 * @param args.headers - additional HTTP headers to merge with the Content-Type header
 * @returns a plain object with ok/text/status fields ready for JSON serialisation across the evaluate boundary
 */
async function doPostFetch(
  args: IDoPostFetchArgs,
): Promise<{ ok: boolean; text: string; status: number; err?: string }> {
  let response: Response;
  const contentTypeHeader = 'application/x-www-form-urlencoded; charset=UTF-8';
  try {
    response = await fetch(args.url, {
      method: 'POST',
      body: args.body,
      credentials: 'include',
      headers: { 'Content-Type': contentTypeHeader, ...args.headers },
    });
  } catch (e) {
    const errMsg = `fetchPost error: ${String(e)}, url: ${args.url}`;
    return { ok: false, text: '', status: 0, err: errMsg };
  }
  if (response.status === 204) return { ok: true, text: '', status: 204 };
  return { ok: true, text: await response.text(), status: response.status };
}

/**
 * Evaluates doPostFetch inside the Playwright page and extracts the body text and status code.
 * Throws ScraperWebsiteChangedError when the in-page fetch itself fails with a network error.
 *
 * @param page - the Playwright Page to run the evaluation in
 * @param args - the compact argument object forwarded to doPostFetch
 * @returns a tuple of [response body text or empty string for 204, HTTP status code]
 */
async function runPostEvaluate(
  page: Page,
  args: IDoPostFetchArgs,
): Promise<readonly [string, number]> {
  const evalResult = await page.evaluate(doPostFetch, args);
  if (!evalResult.ok) {
    const errMsg = `fetchPostWithinPage error: ${evalResult.err ?? ''}`;
    throw new ScraperWebsiteChangedError('Fetch', errMsg);
  }
  return [evalResult.text, evalResult.status] as const;
}

/**
 * Constructs a detailed Error from a JSON parse failure during a POST response, including
 * the original error message, URL, serialised request data, headers, raw body, and status.
 *
 * @param e - the parse exception that triggered this error
 * @param url - the URL of the POST request
 * @param errCtx - additional context with request data, headers, HTTP status, and raw body text
 * @param errCtx.data - the original POST payload that was sent
 * @param errCtx.extraHeaders - the HTTP headers that were sent with the request
 * @param errCtx.status - the HTTP status code of the response
 * @param errCtx.text - the raw response body text that could not be parsed
 * @returns an Error instance with a diagnostic message and the original parse error as its cause
 */
function buildParseError(
  e: unknown,
  url: string,
  errCtx: {
    data: PostBody;
    extraHeaders: Record<string, string>;
    status: number;
    text: string;
  },
): Error {
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  const dataStr = JSON.stringify(errCtx.data);
  const headersStr = JSON.stringify(errCtx.extraHeaders);
  return new Error(
    `fetchPostWithinPage parse error: ${msg}, url: ${url}, data: ${dataStr}, ` +
      `extraHeaders: ${headersStr}, result: ${errCtx.text}, status: ${String(errCtx.status)}`,
    { cause: e },
  );
}

/**
 * Attempts to JSON-parse a POST response body text, handling null and parse errors gracefully.
 * When shouldIgnoreErrors is false a parse failure re-throws as a detailed Error.
 *
 * @param text - the raw response body text, or empty string for empty bodies
 * @param url - the POST URL, included in any error for diagnostics
 * @param ctx - context holding request data, extra headers, error-suppression flag, and HTTP status
 * @param ctx.data - the original POST payload that was sent
 * @param ctx.extraHeaders - the HTTP headers that were sent with the request
 * @param ctx.shouldIgnoreErrors - when true, parse failures return empty string instead of re-throwing
 * @param ctx.status - the HTTP status code of the response
 * @returns the parsed JSON value, or empty string when the text is empty or parsing is suppressed
 */
function parsePostResult(
  text: string,
  url: string,
  ctx: {
    data: PostBody;
    extraHeaders: Record<string, string>;
    shouldIgnoreErrors: boolean;
    status: number;
  },
): PostBody {
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as PostBody;
    // JSON null means the server returned a null body — treat as empty (no data)
    return (parsed ?? '') as PostBody;
  } catch (e) {
    if (!ctx.shouldIgnoreErrors) throw buildParseError(e, url, { ...ctx, text });
    return '';
  }
}

/** Arguments for runAndLogPost — groups url, data, and extraHeaders to stay within max-params. */
interface IRunAndLogPostArgs {
  url: string;
  data: PostBody;
  extraHeaders: Record<string, string>;
}

/**
 * Runs the page-evaluate POST, logs timing and response issues, and returns the raw body tuple.
 *
 * @param page - the Playwright Page to run the request in
 * @param args - the URL, POST payload, and extra headers for the request
 * @returns a tuple of [response body text, status, elapsed ms]
 */
async function runAndLogPost(
  page: Page,
  args: IRunAndLogPostArgs,
): Promise<readonly [string, number, number]> {
  const { url, data, extraHeaders } = args;
  const startMs = Date.now();
  const serialisedBody = JSON.stringify(data);
  const evalArgs = { url, body: serialisedBody, headers: extraHeaders };
  const [text, status] = await runPostEvaluate(page, evalArgs);
  const durationMs = Date.now() - startMs;
  logApiCall(`POST(page) ${url.slice(-100)}`, status, durationMs);
  logResponseIssues(status, text, url);
  return [text, status, durationMs] as const;
}

/**
 * Executes a POST request within the browser page context so session cookies are included.
 * Logs the response, detects WAF blocks, and returns the parsed JSON body.
 *
 * @param page - the Playwright Page whose session cookies should be sent with the request
 * @param url - the URL to post to
 * @param opts - request options including POST data, optional extra headers, and error suppression flag
 * @param opts.data - the POST payload to send as the request body
 * @param opts.extraHeaders - optional additional HTTP headers to include in the request
 * @param opts.shouldIgnoreErrors - when true, JSON parse failures return isFound: false instead of throwing
 * @returns a FoundResult wrapping the parsed JSON response, or isFound: false when the body is empty
 */
export async function fetchPostWithinPage<TResult>(
  page: Page,
  url: string,
  opts: {
    data: PostBody;
    extraHeaders?: Record<string, string>;
    shouldIgnoreErrors?: boolean;
  },
): Promise<FoundResult<TResult>> {
  const { data, extraHeaders = {}, shouldIgnoreErrors = false } = opts;
  const [text, status] = await runAndLogPost(page, { url, data, extraHeaders });
  const ctx = { data, extraHeaders, shouldIgnoreErrors, status };
  const parsed = parsePostResult(text, url, ctx);
  if (parsed === '') return { isFound: false };
  return { isFound: true, value: parsed as TResult };
}
