/**
 * Network DiscoveryEngine / PostInterceptor — Playwright-native
 * `page.waitForResponse` listener that captures POST/PUT API
 * responses from any frame (including cross-origin iframes that
 * `page.on('response')` would otherwise miss).
 *
 * Extracted from `DiscoveryEngine.ts` (PR #276 review — Section 11
 * 150 LoC cap; CR #2 method-aware dedupe; CR #3 error log).
 */

import type { Page, Request, Response } from 'playwright-core';

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { NETWORK_POST_INTERCEPT_TIMEOUT_MS } from '../../Timing/TimingConfig.js';
import { parseResponse } from '../Indexing/Indexing.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';

const LOG = getDebug(import.meta.url);

/** All WK API patterns POST/PUT intercept watches. */
const WK_POST_INTERCEPT_PATTERNS = [
  ...PIPELINE_WELL_KNOWN_API.auth,
  ...PIPELINE_WELL_KNOWN_API.transactions,
  ...PIPELINE_WELL_KNOWN_API.accounts,
  ...PIPELINE_WELL_KNOWN_API.balance,
];

/**
 * Card-family (Amex / Isracard) auth proxy servlet. These banks submit
 * credentials through `/services/ProxyRequestHandler.ashx` (e.g.
 * `?reqName=performLogon`), which the shared {@link PIPELINE_WELL_KNOWN_API}
 * `auth` patterns — verified only for Beinleumi/Discount/Hapoalim/Max/VisaCal —
 * do not match. Kept module-local and used ONLY by the gated request trace so
 * the shared WK auth set and the `unsupported` `.ashx` response-drop stay
 * byte-identical. Structural URL match on a forensics path (not interaction
 * code) — the zero-CSS-selector rule does not apply.
 */
const TRACE_AUTH_SERVLET_PATTERNS = [/ProxyRequestHandler\.ashx/i];

/** WK auth patterns watched by request-level auth tracing. */
const WK_AUTH_POST_INTERCEPT_PATTERNS = [
  ...PIPELINE_WELL_KNOWN_API.auth,
  ...TRACE_AUTH_SERVLET_PATTERNS,
];

/**
 * Match a method against the WK POST/PUT capture policy.
 * @param method - HTTP method from Playwright.
 * @returns True when the method can submit auth/API payloads.
 */
function isPostOrPut(method: string): boolean {
  return method === 'POST' || method === 'PUT';
}

/**
 * Match POST/PUT requests against WellKnown patterns. Pure predicate
 * passed to `page.waitForResponse`.
 * @param r - Playwright response.
 * @returns True when method + URL pattern matches a WK API endpoint.
 */
function isWkApiPostOrPut(r: Response): boolean {
  const method = r.request().method();
  if (!isPostOrPut(method)) return false;
  const url = r.url();
  return WK_POST_INTERCEPT_PATTERNS.some((p): boolean => p.test(url));
}

/**
 * Match request-level auth submissions against WellKnown auth URL
 * patterns. Used only by gated auth-request tracing so analytics and
 * non-auth API calls never enter the forensic log.
 * @param request - Playwright request.
 * @returns True for WK auth POST/PUT requests.
 */
function isWkAuthPostOrPutRequest(request: Request): boolean {
  const method = request.method();
  if (!isPostOrPut(method)) return false;
  const url = request.url();
  const isAuthMatch = WK_AUTH_POST_INTERCEPT_PATTERNS.some((p): boolean => p.test(url));
  return isAuthMatch;
}

/** Request-level WK auth POST/PUT predicate surface. */
export const WK_AUTH_POST_OR_PUT_REQUEST = Object.freeze({
  matches: isWkAuthPostOrPutRequest,
});

/**
 * CR PR #276 #2 — dedupe must compare URL AND method so a GET and a
 * POST to the same URL stay distinct entries in the capture pool.
 * @param captured - Existing capture pool.
 * @param endpoint - Candidate endpoint to push.
 * @returns True when the endpoint is a duplicate of an existing one.
 */
function isDuplicateCapture(
  captured: readonly IDiscoveredEndpoint[],
  endpoint: IDiscoveredEndpoint,
): boolean {
  return captured.some((ep): boolean => ep.url === endpoint.url && ep.method === endpoint.method);
}

/**
 * Push the parsed endpoint into the capture pool when it isn't a
 * duplicate; emit one trace line per accepted capture.
 * @param captured - Mutable capture array.
 * @param endpoint - Parsed endpoint (or false from parseResponse).
 * @returns True when the endpoint was recorded.
 */
function recordInterceptedEndpoint(
  captured: IDiscoveredEndpoint[],
  endpoint: IDiscoveredEndpoint | false,
): boolean {
  if (!endpoint) return false;
  if (isDuplicateCapture(captured, endpoint)) return false;
  captured.push(endpoint);
  LOG.trace({ method: endpoint.method, url: maskVisibleText(endpoint.url) });
  return true;
}

/**
 * CR PR #276 #3 — log non-timeout parse / network errors so they're
 * not silently lost. Timeouts are expected (no WK POST fired within
 * the budget) — CR PR #276 post-review-fix #4 short-circuits the
 * Playwright `TimeoutError` (Error.name === 'TimeoutError') so the
 * expected branch stops adding noise to `pipeline.log`; other
 * failures still surface.
 * @param err - Thrown value.
 * @returns False (the promise chain stays fire-and-forget).
 */
function logInterceptError(err: unknown): boolean {
  const isExpectedTimeout = err instanceof Error && err.name === 'TimeoutError';
  if (!isExpectedTimeout) {
    LOG.debug({ event: 'interceptPostResponses.error', error: String(err) });
  }
  return false;
}

/**
 * Intercept POST/PUT responses matching WellKnown patterns from any
 * frame. `page.waitForResponse` captures cross-origin iframe traffic
 * that `page.on('response')` misses. Generic for all banks.
 *
 * @param page - Playwright page.
 * @param captured - Mutable captured endpoints array.
 * @returns True (fire-and-forget).
 */
function interceptPostResponses(page: Page, captured: IDiscoveredEndpoint[]): boolean {
  page
    .waitForResponse(isWkApiPostOrPut, { timeout: NETWORK_POST_INTERCEPT_TIMEOUT_MS })
    .then(async (resp): Promise<boolean> => {
      const endpoint = await parseResponse(resp);
      return recordInterceptedEndpoint(captured, endpoint);
    })
    .catch(logInterceptError);
  return true;
}

export default interceptPostResponses;
