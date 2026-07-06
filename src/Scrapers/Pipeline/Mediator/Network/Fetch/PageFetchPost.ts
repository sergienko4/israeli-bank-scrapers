/**
 * Fetch sub-module — in-page POST requests (Playwright page.evaluate).
 *
 * Cookies + CORS handled by the browser context. The SPA pivot in
 * ScrapePhase.PRE ensures the page is on the correct origin.
 */

import type { Frame, Page } from 'playwright-core';

import type { Nullable } from '../../../../Base/Interfaces/CallbackTypes.js';
import { redactUrlFull } from '../../../Types/PiiRedactor.js';
import { JSON_CONTENT_TYPE } from '../FetchConfig.js';
import type { JsonValue } from './Headers.js';
import { LOG, logApiCall, logResponseIssues } from './Logging.js';
import { parsePostResult } from './ParseResult.js';

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

/** Pino payload shape for the doPostFetch.headers diagnostic. */
interface IDoPostFetchHeadersPayload {
  event: string;
  url: string;
  headerNames: string[];
  bodyLen: number;
}

/**
 * Sort header names alphabetically — pulled out so the payload builder
 * fits the 10-LoC cap.
 * @param headers - Captured extra-headers map.
 * @returns Alphabetically sorted header names.
 */
function sortHeaderNames(headers: Record<string, string>): string[] {
  return Object.keys(headers).sort((a, b): number => a.localeCompare(b));
}

/**
 * Build the doPostFetch.headers diagnostic payload — pulled out so
 * {@link logDoPostFetchHeaders} fits the 10-LoC cap.
 * @param args - Post-evaluate args (url + headers + body).
 * @returns Pino debug payload.
 */
function buildDoPostFetchHeadersPayload(args: IPostEvaluateArgs): IDoPostFetchHeadersPayload {
  return {
    event: 'doPostFetch.headers',
    url: args.innerUrl,
    headerNames: sortHeaderNames(args.innerExtraHeaders),
    bodyLen: args.innerDataJson.length,
  };
}

/**
 * Emit the doPostFetch.headers diagnostic line for VisaCal/Hapoalim debug.
 * @param args - Post-evaluate args (url + headers + body).
 * @returns True after emission completes.
 */
function logDoPostFetchHeaders(args: IPostEvaluateArgs): boolean {
  const payload = buildDoPostFetchHeadersPayload(args);
  LOG.debug(payload);
  return true;
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
  logDoPostFetchHeaders(args);
  return context.evaluate(doPostFetch, args);
}

/** Conservative defaults used ONLY when the caller omitted `extraHeaders`. */
const DEFAULT_JSON_HEADERS: Record<string, string> = {
  'content-type': JSON_CONTENT_TYPE,
  accept: JSON_CONTENT_TYPE,
};

/**
 * True when the header map already declares a Content-Type (any casing) — so a
 * captured SPA value (Hapoalim rejects a mismatched Content-Type) is never
 * shadowed by the JSON default filled in below.
 * @param headers - Caller-supplied header map.
 * @returns True when a content-type key (any casing) is present.
 */
function hasContentType(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((k): boolean => k.toLowerCase() === 'content-type');
}

/**
 * Guarantee a POST — whose body is ALWAYS JSON-stringified below — advertises a
 * JSON Content-Type. Captured SPA headers stay the source of truth: an omitted
 * header set falls back to the minimal JSON default; a partial set WITHOUT a
 * Content-Type (FIBI `appsng` BFF, which otherwise serves the SPA shell at 200)
 * gains only `application/json`; an already-present Content-Type (Hapoalim) is
 * forwarded verbatim.
 * @param extraHeaders - Caller-supplied headers, or undefined.
 * @returns Header map guaranteed to carry a Content-Type.
 */
function withJsonContentType(extraHeaders?: Record<string, string>): Record<string, string> {
  if (!extraHeaders) return DEFAULT_JSON_HEADERS;
  if (hasContentType(extraHeaders)) return extraHeaders;
  return { ...extraHeaders, 'content-type': JSON_CONTENT_TYPE };
}

/**
 * Build the post-evaluate args bundle from the public options. Headers pass
 * through {@link withJsonContentType} so every JSON POST advertises a
 * Content-Type without shadowing a captured SPA value.
 * @param url - Target URL.
 * @param opts - Public fetch options.
 * @returns Args ready for runPostEvaluate.
 */
function buildPostArgs(url: string, opts: IFetchPostOptions): IPostEvaluateArgs {
  const innerExtraHeaders = withJsonContentType(opts.extraHeaders);
  return { innerUrl: url, innerDataJson: JSON.stringify(opts.data), innerExtraHeaders };
}

/** Bundled args for {@link finalisePagePost} — keeps the sig under max-params. */
interface IFinalisePagePostArgs {
  text: string;
  status: number;
  url: string;
  startMs: number;
  opts: IFetchPostOptions;
}

/**
 * Common tail for {@link fetchPostWithinPage} — log + parse.
 * @param args - Bundled response text + status + url + start + opts.
 * @returns Parsed JSON or EMPTY_RESULT on swallowed parse error.
 */
function finalisePagePost<TResult>(args: IFinalisePagePostArgs): Nullable<TResult> {
  const { text, status, url, startMs, opts } = args;
  logApiCall(`POST(page) ${redactUrlFull(url).slice(-100)}`, status, Date.now() - startMs);
  logResponseIssues(status, text, url);
  return parsePostResult({ text, status, url, opts }) as TResult;
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
  const startMs = Date.now();
  const postArgs = buildPostArgs(url, opts);
  const [text, status] = await runPostEvaluate(page, postArgs);
  return finalisePagePost<TResult>({ text, status, url, startMs, opts });
}
