/**
 * Fetch sub-module — native `fetch()` calls (outside browser context).
 *
 * Three public entry points: `fetchGet`, `fetchPost`, `fetchGraphql`.
 * Every function ≤ 10 effective LoC; per-step helpers live alongside.
 */

import ScraperError from '../../../../Base/ScraperError.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { redactUrlFull } from '../../../Types/PiiRedactor.js';
import {
  BODY_PREVIEW_LIMIT,
  HTTP_STATUS_OK,
  NETWORK_FETCH_TIMEOUT_MS,
  URL_LOG_TAIL_CHARS,
} from '../FetchConfig.js';
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

/** Max length for sanitised GraphQL error message before truncation. */
const GRAPHQL_ERR_MAX = 200;

/** URL pattern stripped from sanitised messages to avoid PII leakage. */
const URL_PATTERN = /https?:\/\/\S+/g;

/** Whitespace-collapse pattern for {@link sanitizeGraphqlErrorMessage}. */
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Sanitise a GraphQL error message — collapse whitespace, mask any
 * URL-shaped substrings, truncate to {@link GRAPHQL_ERR_MAX}. Preserves
 * short tokens like "Unauthorized" / "bad query" so callers can still
 * pattern-match on them; only PII-leaking URLs and runaway whitespace
 * are removed.
 * @param raw - Raw `firstError.message` from the GraphQL envelope.
 * @returns Safe-to-log error message.
 */
function sanitizeGraphqlErrorMessage(raw: string): string {
  const masked = raw.replaceAll(URL_PATTERN, '[redacted-url]');
  const collapsed = masked.replaceAll(WHITESPACE_PATTERN, ' ').trim();
  if (collapsed.length <= GRAPHQL_ERR_MAX) return collapsed;
  return `${collapsed.slice(0, GRAPHQL_ERR_MAX)}...`;
}

/**
 * Wrap `fetch()` with a {@link NETWORK_FETCH_TIMEOUT_MS} timeout via the
 * Web-standard {@link AbortSignal.timeout} helper. Prevents indefinite
 * hangs when bank APIs stall mid-response. Uses the native signal API
 * (no `setTimeout` — architecture rule §11 forbids manual delays).
 * @param url - Target URL.
 * @param init - Native fetch init (caller MUST NOT set its own signal).
 * @returns Native Response.
 */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(NETWORK_FETCH_TIMEOUT_MS) });
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
  if (fetchResult.status !== HTTP_STATUS_OK) {
    throw new ScraperError(`GET request returned status ${String(fetchResult.status)}`);
  }
  return true;
}

/**
 * Build the masked-URL tag for native GET-call logs.
 * @param url - Raw URL.
 * @returns Tag with redacted URL tail.
 */
function buildGetCallTag(url: string): string {
  return `GET ${redactUrlFull(url).slice(-URL_LOG_TAIL_CHARS)}`;
}

/** Bundled args for {@link parseFetchGetResponse} — keeps the sig under the LoC cap. */
interface IParseGetResponseArgs {
  fetchResult: Response;
  url: string;
  startMs: number;
}

/**
 * Parse and log the response from a native fetch GET request.
 * @param args - Bundled fetch result + url + start timestamp.
 * @returns The parsed JSON response body.
 */
async function parseFetchGetResponse<TResult>(args: IParseGetResponseArgs): Promise<TResult> {
  const { fetchResult, url, startMs } = args;
  const tag = buildGetCallTag(url);
  logApiCall(tag, fetchResult.status, Date.now() - startMs);
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
  const fetchResult = await fetchWithTimeout(url, { method: 'GET', headers: merged });
  return parseFetchGetResponse<TResult>({ fetchResult, url, startMs });
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
  const result = await fetchWithTimeout(url, postInit);
  const tag = `POST ${redactUrlFull(url).slice(-URL_LOG_TAIL_CHARS)}`;
  logApiCall(tag, result.status, Date.now() - startMs);
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
 * The error message is routed through {@link sanitizeGraphqlErrorMessage}
 * so URL-shaped substrings and runaway whitespace cannot leak into logs.
 * @param result - GraphQL envelope from fetchPost.
 * @returns Underlying data field.
 */
function unwrapGraphqlResult<TResult>(result: IGraphqlResponse<TResult>): TResult {
  const firstError = result.errors?.[0];
  if (firstError) throw new ScraperError(sanitizeGraphqlErrorMessage(firstError.message));
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
