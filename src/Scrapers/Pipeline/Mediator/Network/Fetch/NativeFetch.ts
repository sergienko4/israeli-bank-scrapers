/**
 * Fetch sub-module — native `fetch()` calls (outside browser context).
 *
 * Three public entry points: `fetchGet`, `fetchPost`, `fetchGraphql`.
 * Every function ≤ 10 effective LoC; per-step helpers live alongside.
 */

import ScraperError from '../../../../Base/ScraperError.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { BODY_PREVIEW_LIMIT } from '../FetchConfig.js';
import { getJsonHeaders, type JsonValue } from './Headers.js';
import { LOG, logApiCall } from './Logging.js';

/** Options for GraphQL fetch requests. */
export interface IFetchGraphqlOptions {
  variables?: Record<string, JsonValue>;
  extraHeaders?: Record<string, string>;
}

/** GraphQL envelope returned by the server. */
interface IGraphqlResponse<TResult> {
  data: TResult;
  errors?: { message: string }[];
}

/**
 * Read a fetch response body and log a masked preview.
 * @param fetchResult - Native fetch response.
 * @returns The full response body text.
 */
async function readBodyWithPreview(fetchResult: Response): Promise<string> {
  const text = await fetchResult.text();
  const bodyPreview = text.substring(0, BODY_PREVIEW_LIMIT);
  LOG.debug({ message: `response body: ${maskVisibleText(bodyPreview)}` });
  return text;
}

/**
 * Validate a GET response status — throw on non-200.
 * Pulled out so {@link parseFetchGetResponse} fits the 10-LoC cap.
 * @param fetchResult - The fetch Response object.
 * @returns Always true on 200.
 */
function assertGetStatusOk(fetchResult: Response): true {
  if (fetchResult.status !== 200) {
    throw new ScraperError(`GET request returned status ${String(fetchResult.status)}`);
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
  logApiCall(`GET ${url.slice(-100)}`, fetchResult.status, Date.now() - startMs);
  const text = await readBodyWithPreview(fetchResult);
  assertGetStatusOk(fetchResult);
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
  const fetchResult = await fetch(url, { method: 'GET', headers: merged });
  return parseFetchGetResponse<TResult>(fetchResult, url, startMs);
}

/**
 * Build the POST request init shape from data + extra headers.
 * @param data - JSON-serialisable body payload.
 * @param extraHeaders - Additional HTTP headers.
 * @returns RequestInit ready for fetch().
 */
function buildPostInit(
  data: Record<string, JsonValue>,
  extraHeaders: Record<string, string>,
): RequestInit {
  return {
    method: 'POST',
    headers: { ...getJsonHeaders(), ...extraHeaders },
    body: JSON.stringify(data),
  };
}

/**
 * Send a POST + log + read body. Extracted so {@link fetchPost} fits cap.
 * @param url - Target URL.
 * @param postInit - Pre-built RequestInit.
 * @param startMs - Start timestamp for duration calculation.
 * @returns Raw response body text.
 */
async function sendPost(url: string, postInit: RequestInit, startMs: number): Promise<string> {
  const result = await fetch(url, postInit);
  logApiCall(`POST ${url.slice(-100)}`, result.status, Date.now() - startMs);
  return readBodyWithPreview(result);
}

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
  const startMs = Date.now();
  const postInit = buildPostInit(data, extraHeaders);
  const text = await sendPost(url, postInit, startMs);
  return JSON.parse(text) as TResult;
}

/**
 * Unwrap a GraphQL envelope — throw on first error, return data.
 * Extracted so {@link fetchGraphql} fits the 10-LoC cap.
 * @param result - GraphQL envelope from fetchPost.
 * @returns Underlying data field.
 */
function unwrapGraphqlResult<TResult>(result: IGraphqlResponse<TResult>): TResult {
  const firstError = result.errors?.[0];
  if (firstError) throw new ScraperError(firstError.message);
  return result.data;
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
  const body = { operationName: '', query, variables };
  const result = await fetchPost<IGraphqlResponse<TResult>>(url, body, extraHeaders);
  return unwrapGraphqlResult(result);
}
