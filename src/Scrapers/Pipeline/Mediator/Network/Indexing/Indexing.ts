/**
 * Network Indexing — primitives for filtering, parsing, and recording
 * the JSON / no-content responses captured from the live browser page.
 *
 * Boundary: pure functions over a single Playwright Response; no
 * cross-talk with scoring, endpoint-state, or discovery facade.
 *
 *   • Header / content-type constants from the WK registry.
 *   • `parseTextOrNull` / `shouldRecordResponse` / `isUnsupportedUrl`
 *     — predicate gates that decide whether a response enters the
 *     captured pool.
 *   • `parseResponse` — read the body once, dump for trace, hand back
 *     an `IDiscoveredEndpoint`.
 *   • `handleResponse` — `page.on('response')` adapter that pushes
 *     into the mutable capture array.
 *   • `extractBaseUrl` — strip query params (used downstream by
 *     Scoring to find the most common base URL).
 *   • `isReplayablePost` — branch predicate used by Scoring's tier
 *     picker to recognise replayable POST templates.
 *
 * Extracted from NetworkDiscovery.ts (Phase 4 commit 3/9).
 */

import type { Response } from 'playwright-core';

import {
  PIPELINE_WELL_KNOWN_API,
  PIPELINE_WELL_KNOWN_HEADERS,
} from '../../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../../Types/Debug.js';
import { toErrorMessage } from '../../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { redactUrlFull } from '../../../Types/PiiRedactor.js';
import { dumpResponseBody } from '../Debug/NetworkDump.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';

const LOG = getDebug(import.meta.url);

/** WK header names — imported from registry. */
const ORIGIN_HEADERS = PIPELINE_WELL_KNOWN_HEADERS.origin;
const REFERER_HEADERS = PIPELINE_WELL_KNOWN_HEADERS.referer;
const SITE_ID_HEADERS = PIPELINE_WELL_KNOWN_HEADERS.siteId;
const BROWSER_STANDARD_HEADERS = PIPELINE_WELL_KNOWN_HEADERS.browserStandard;

/** Sentinel for missing content-type header. */
const NO_CONTENT_TYPE = 'none';

/** Sentinel for missing POST body. */
const NO_POST_DATA = '';

/** Content types that may contain a JSON API response. */
const JSON_CONTENT_TYPES = ['application/json', 'text/json', 'text/plain', 'text/html'];

/**
 * Check if a content-type header indicates JSON.
 * @param contentType - The content-type header value.
 * @returns True if JSON response.
 */
function isJsonContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return JSON_CONTENT_TYPES.some((jsonType): boolean => lower.includes(jsonType));
}

/**
 * Extract request metadata from a Playwright response.
 * @param response - Playwright response object.
 * @returns URL, method, postData, and contentType.
 */
function extractRequestMeta(response: Response): {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  postData: string;
  contentType: string;
  requestHeaders: Record<string, string>;
} {
  const headers = response.headers();
  const contentType = headers['content-type'] ?? NO_CONTENT_TYPE;
  const url = response.url();
  const method = response.request().method() as 'GET' | 'POST' | 'PUT';
  const rawPost = response.request().postData();
  const postData = rawPost ?? NO_POST_DATA;
  const requestHeaders = response.request().headers();
  return { url, method, postData, contentType, requestHeaders };
}

/** Parsed body wrapper — keeps the typed bag separate from raw `unknown`. */
interface IParsedBody {
  readonly value: unknown;
}

/**
 * Branded signal — true when the response should enter the captured
 * pool. Named so Rule #15 (no primitive returns from exports) sees
 * the intent at a glance.
 */
type ShouldRecordResponseSignal = boolean & {
  readonly __brand: 'ShouldRecordResponseSignal';
};

/**
 * Parse a response-text payload, normalising empty / whitespace-only
 * bodies to `null` so they survive the picker's `urlOnlyMatch` rescue
 * tier. Throws on malformed JSON — callers must wrap in try/catch.
 * Exported for unit testing.
 * @param text - Raw response text.
 * @returns Wrapper carrying the parsed value (`null` for empty payloads).
 */
function parseTextOrNull(text: string): IParsedBody {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { value: null };
  return { value: JSON.parse(trimmed) as unknown };
}

/**
 * Phase H'' (2026-05-15): decision predicate for `parseResponse`.
 * 2xx-no-content responses (HTTP 204) carry no body and typically
 * have no `content-type` header — they fail the `isJsonContentType`
 * filter and would be dropped before `parseTextOrNull` ever runs,
 * making the picker's `urlOnlyMatch` rescue tier (which keys off
 * `responseBody === null`) unreachable for the exact captures it was
 * added to handle.
 *
 * <p>Bank's real Hapoalim txn URL fires `POST /current-account/
 * transactions?retrievalStartDate=X&retrievalEndDate=Y` and returns
 * 204 when the captured 30-day window is empty — this is the case
 * the rescue path was built for. Treat 204 as intrinsically
 * recordable regardless of content-type so the picker sees the URL.
 * Other non-JSON content types (HTML errors, redirects with body)
 * keep their existing JSON-only filter.
 *
 * <p>Exported for unit testing. Pure function.
 * @param status - HTTP status code.
 * @param contentType - Response content-type header (or `'none'`).
 * @returns True when the response should enter the captured pool.
 */
function shouldRecordResponse(status: number, contentType: string): ShouldRecordResponseSignal {
  if (status === 204) return true as ShouldRecordResponseSignal;
  return isJsonContentType(contentType) as ShouldRecordResponseSignal;
}

/** Branded boolean for the unsupported-URL gate. Rule #15 — exported
 *  functions never return raw primitives. */
type IsUnsupportedUrlSignal = boolean & {
  readonly __brand: 'IsUnsupportedUrlSignal';
};

/**
 * Test if a URL is on the unsupported-URL block list. WK-driven via
 * `PIPELINE_WELL_KNOWN_API.unsupported` — currently `.ashx` (Amex
 * legacy ProxyRequestHandler). Excluded URLs never enter the captured
 * pool, so no downstream picker / probe / extractor can ever see them.
 * Per user direction 15-05-2026: `.ashx` removal was completed long
 * ago — every bank goes through modern POST/GET. This is the
 * enforcement gate.
 *
 * <p>Exported for unit testing. Pure function.
 * @param url - Response URL.
 * @returns True when the URL matches a WK unsupported pattern.
 */
function isUnsupportedUrl(url: string): IsUnsupportedUrlSignal {
  const isMatch = PIPELINE_WELL_KNOWN_API.unsupported.some((p): boolean => p.test(url));
  return isMatch as IsUnsupportedUrlSignal;
}

/**
 * Try to parse a response as a discovered endpoint.
 *
 * <p>Exported for unit testing — the production handlers
 * (`handleResponse` / `interceptPostResponses`) consume it internally
 * but the live 204-drop debug procedure (per debugging-guidlines.md
 * §1.2 "failing test before fixing") needs a direct entry point.
 *
 * @param response - Playwright response object.
 * @returns Discovered endpoint or false if not a JSON API response.
 */
async function parseResponse(response: Response): Promise<IDiscoveredEndpoint | false> {
  const meta = extractRequestMeta(response);
  const status = response.status();
  // Permanent diagnostic trace — keep for future investigations of
  // capture-pool drops. Logs every parseResponse entry with the
  // sync-extracted status + contentType so any divergence between
  // handleResponse's local capture and parseResponse's re-read is
  // visible side-by-side in `pipeline.log`. Per debugging-
  // guidlines.md §3 "Stage-Level Observability".
  LOG.debug({
    event: 'parseResponse.entry',
    status,
    contentType: meta.contentType,
    method: meta.method,
    url: redactUrlFull(meta.url),
  });
  // Unsupported-URL enforcement gate (Amex `.ashx` removal, 2026-05-15
  // per user direction). Drop the response BEFORE any other logic so
  // the URL never enters the captured pool and no downstream tier can
  // pick it. WK-driven via `PIPELINE_WELL_KNOWN_API.unsupported`.
  if (isUnsupportedUrl(meta.url)) {
    LOG.debug({
      event: 'parseResponse.drop',
      reason: 'unsupportedUrl',
      status,
      url: redactUrlFull(meta.url),
    });
    return false;
  }
  if (!shouldRecordResponse(status, meta.contentType)) {
    LOG.debug({
      event: 'parseResponse.drop',
      reason: 'shouldRecordResponse=false',
      status,
      contentType: meta.contentType,
      url: redactUrlFull(meta.url),
    });
    return false;
  }
  // Phase H'' (2026-05-15): 204 No Content has no body. Calling
  // `response.text()` on a no-body response can throw in some
  // Playwright runtime / Camoufox builds, dropping the endpoint
  // back at the catch below. Short-circuit BEFORE the read: we
  // already know the body is null, so record the URL directly
  // and bypass `response.text()` entirely.
  if (status === 204) {
    LOG.debug({ event: 'parseResponse.shortCircuit204', url: redactUrlFull(meta.url) });
    const responseHeadersForNoContent = response.headers();
    const captureIndexForNoContent = dumpResponseBody({
      url: meta.url,
      method: meta.method,
      postData: meta.postData,
      text: '',
    });
    return {
      ...meta,
      responseHeaders: responseHeadersForNoContent,
      responseBody: null,
      timestamp: Date.now(),
      captureIndex: captureIndexForNoContent,
      status,
    };
  }
  try {
    const text = await response.text();
    LOG.debug({
      event: 'parseResponse.textRead',
      status,
      textLen: text.length,
      url: redactUrlFull(meta.url),
    });
    // CodeRabbit 2026-05-15: a true 204 / empty-body response has
    // `text === ''` — `JSON.parse('')` throws and the catch below
    // would drop the endpoint. Normalise empty / whitespace-only
    // payloads to `null` so the picker sees the URL.
    const responseBody = parseTextOrNull(text).value;
    const responseHeaders = response.headers();
    const captureIndex = dumpResponseBody({
      url: meta.url,
      method: meta.method,
      postData: meta.postData,
      text,
    });
    return {
      ...meta,
      responseHeaders,
      responseBody,
      timestamp: Date.now(),
      captureIndex,
      status,
    };
  } catch (error) {
    // Permanent diagnostic — surface which captures get dropped by
    // an internal throw (response.text() rejection, JSON parse
    // failure, etc.) so we don't fly blind on future regressions.
    LOG.debug({
      event: 'parseResponse.catch',
      status,
      contentType: meta.contentType,
      url: redactUrlFull(meta.url),
      errorMessage: toErrorMessage(error as Error),
    });
    return false;
  }
}

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
 * Handle a response event — parse and store if JSON API.
 * @param captured - Mutable array to store discovered endpoints.
 * @param response - Playwright response.
 * @param isCollectionActive - Predicate gating capture storage so the
 *   listener can stay attached for the whole run while the
 *   discovery pool is silenced during pre-auth phases.
 * @returns True (always — fire-and-forget).
 */
function handleResponse(
  captured: IDiscoveredEndpoint[],
  response: Response,
  isCollectionActive: () => boolean,
): boolean {
  if (!isCollectionActive()) return false;
  const url = response.url();
  const status = response.status();
  const method = response.request().method();
  parseResponse(response)
    .then((endpoint): boolean => {
      const isInteresting = method === 'POST' || url.includes('/col-rest/');
      if (!endpoint && isInteresting) {
        LOG.trace({ method, url: maskVisibleText(url), status });
      }
      if (!endpoint) return false;
      captured.push(endpoint);
      LOG.trace({
        method: endpoint.method,
        url: maskVisibleText(endpoint.url),
      });
      return true;
    })
    .catch((): boolean => false);
  return true;
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

export {
  BROWSER_STANDARD_HEADERS,
  extractBaseUrl,
  extractRequestMeta,
  handleResponse,
  isJsonContentType,
  isReplayablePost,
  isUnsupportedUrl,
  JSON_CONTENT_TYPES,
  NO_CONTENT_TYPE,
  NO_POST_DATA,
  ORIGIN_HEADERS,
  parseResponse,
  parseTextOrNull,
  REFERER_HEADERS,
  shouldRecordResponse,
  SITE_ID_HEADERS,
};
export type { IParsedBody, IsUnsupportedUrlSignal, ShouldRecordResponseSignal };
