/**
 * Fetch sub-module — in-page POST requests (Playwright page.evaluate).
 *
 * Cookies + CORS handled by the browser context. The SPA pivot in
 * ScrapePhase.PRE ensures the page is on the correct origin.
 */

import type { Frame, Page } from 'playwright-core';

import type { Nullable } from '../../../../Base/Interfaces/CallbackTypes.js';
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

/**
 * Emit the doPostFetch.headers diagnostic line for VisaCal/Hapoalim debug.
 * @param args - Post-evaluate args (url + headers + body).
 * @returns True after emission completes.
 */
function logDoPostFetchHeaders(args: IPostEvaluateArgs): boolean {
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

/**
 * Build the post-evaluate args bundle from the public options.
 * @param url - Target URL.
 * @param opts - Public fetch options.
 * @returns Args ready for runPostEvaluate.
 */
function buildPostArgs(url: string, opts: IFetchPostOptions): IPostEvaluateArgs {
  const { data, extraHeaders = {} } = opts;
  return { innerUrl: url, innerDataJson: JSON.stringify(data), innerExtraHeaders: extraHeaders };
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
  logApiCall(`POST(page) ${url.slice(-100)}`, status, Date.now() - startMs);
  logResponseIssues(status, text, url);
  return parsePostResult({ text, status, url, opts }) as TResult;
}
