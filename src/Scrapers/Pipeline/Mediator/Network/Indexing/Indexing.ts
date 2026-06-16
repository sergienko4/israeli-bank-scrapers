/**
 * Network Indexing — header constants + captured-endpoint predicates
 * for the JSON / no-content responses captured from the live browser
 * page, plus the stable public facade for the indexing cluster.
 *
 * Boundary: pure functions over a single Playwright Response or a
 * captured endpoint; no cross-talk with scoring, endpoint-state, or
 * the discovery facade.
 *
 *   • Header / content-type constants from the WK registry.
 *   • `extractBaseUrl` — strip query params (used downstream by
 *     Scoring to find the most common base URL).
 *   • `isReplayablePost` — branch predicate used by Scoring's tier
 *     picker to recognise replayable POST templates.
 *   • Request-meta extraction + capture-gate predicates
 *     (`extractRequestMeta` / `parseTextOrNull` / `shouldRecordResponse`
 *     / `isUnsupportedUrl`) live in {@link ./ResponsePrimitives.js} and
 *     are re-exported here so the public-API surface stays stable.
 *   • `parseResponse` / `handleResponse` are re-exported from
 *     {@link ./ResponseParser.js} for the same reason.
 *
 * Extracted from NetworkDiscovery.ts (Phase 4 commit 3/9).
 * Split into Indexing + ResponseParser (PR #276 review — CR #7).
 * Primitives split into ResponsePrimitives (slice 12i-4) to dissolve
 * the Indexing ↔ ResponseParser ↔ ResponseParserLogs import cycle.
 */

import { PIPELINE_WELL_KNOWN_HEADERS } from '../../../Registry/WK/ScrapeWK.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';

/** WK header names — imported from registry. */
const ORIGIN_HEADERS = PIPELINE_WELL_KNOWN_HEADERS.origin;
const ORIGIN_KEY_HEADERS = PIPELINE_WELL_KNOWN_HEADERS.originKey;
const REFERER_HEADERS = PIPELINE_WELL_KNOWN_HEADERS.referer;
const SITE_ID_HEADERS = PIPELINE_WELL_KNOWN_HEADERS.siteId;
const BROWSER_STANDARD_HEADERS = PIPELINE_WELL_KNOWN_HEADERS.browserStandard;

/**
 * Extract the base URL (before query params) from a full URL.
 * @param fullUrl - Full URL with query params.
 * @returns Base URL without query string.
 */
function extractBaseUrl(fullUrl: string): string {
  const idx = fullUrl.indexOf('?');
  if (idx < 0) return fullUrl;
  return fullUrl.slice(0, idx);
}

/**
 * Returns true when the endpoint is a non-empty-body POST — the body
 * template is what MatrixLoop replays per-card / per-month.
 * @param ep - captured endpoint.
 * @returns true when method=POST and postData is non-empty.
 */
function isReplayablePost(ep: IDiscoveredEndpoint): boolean {
  if (ep.method !== 'POST') return false;
  return ep.postData.length > 0;
}

export { handleResponse, parseResponse } from './ResponseParser.js';
export type {
  AllowedMethod,
  IParsedBody,
  IRequestMeta,
  IsUnsupportedUrlSignal,
  ShouldRecordResponseSignal,
} from './ResponsePrimitives.js';
export {
  ALLOWED_METHODS,
  extractRequestMeta,
  isJsonContentType,
  isUnsupportedUrl,
  JSON_CONTENT_TYPES,
  NO_CONTENT_TYPE,
  NO_POST_DATA,
  parseTextOrNull,
  shouldRecordResponse,
} from './ResponsePrimitives.js';

export {
  BROWSER_STANDARD_HEADERS,
  extractBaseUrl,
  isReplayablePost,
  ORIGIN_HEADERS,
  ORIGIN_KEY_HEADERS,
  REFERER_HEADERS,
  SITE_ID_HEADERS,
};
