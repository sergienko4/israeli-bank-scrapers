/**
 * Network DiscoveryEngine / PostInterceptor — Playwright-native
 * `page.waitForResponse` listener that captures POST/PUT API
 * responses from any frame (including cross-origin iframes that
 * `page.on('response')` would otherwise miss).
 *
 * Extracted from `DiscoveryEngine.ts` (PR #276 review — Section 11
 * 150 LoC cap; CR #2 method-aware dedupe; CR #3 error log).
 */

import type { Page, Response } from 'playwright-core';

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
 * Match POST/PUT requests against WellKnown patterns. Pure predicate
 * passed to `page.waitForResponse`.
 * @param r - Playwright response.
 * @returns True when method + URL pattern matches a WK API endpoint.
 */
function isWkApiPostOrPut(r: Response): boolean {
  const method = r.request().method();
  const isApiMethod = method === 'POST' || method === 'PUT';
  if (!isApiMethod) return false;
  const url = r.url();
  return WK_POST_INTERCEPT_PATTERNS.some((p): boolean => p.test(url));
}

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
 * the budget); other failures surface in `pipeline.log`.
 * @param err - Thrown value.
 * @returns False (the promise chain stays fire-and-forget).
 */
function logInterceptError(err: unknown): boolean {
  LOG.debug({ event: 'interceptPostResponses.error', error: String(err) });
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
