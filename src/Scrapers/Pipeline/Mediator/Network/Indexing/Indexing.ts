/**
 * Network Indexing — primitives for filtering and parsing the JSON /
 * no-content responses captured from the live browser page.
 *
 * Boundary: pure functions over a single Playwright Response; no
 * cross-talk with scoring, endpoint-state, or discovery facade.
 *
 *   • Header / content-type constants from the WK registry.
 *   • `parseTextOrNull` / `shouldRecordResponse` / `isUnsupportedUrl`
 *     — predicate gates that decide whether a response enters the
 *     captured pool.
 *   • `extractRequestMeta` — validated meta bag (CR #6 — removes the
 *     unsafe `as 'GET' | 'POST' | 'PUT'` cast).
 *   • `extractBaseUrl` — strip query params (used downstream by
 *     Scoring to find the most common base URL).
 *   • `isReplayablePost` — branch predicate used by Scoring's tier
 *     picker to recognise replayable POST templates.
 *   • `parseResponse` / `handleResponse` are re-exported from
 *     `ResponseParser.ts` so the public-API surface stays stable.
 *
 * Extracted from NetworkDiscovery.ts (Phase 4 commit 3/9).
 * Split into Indexing + ResponseParser (PR #276 review — CR #7).
 */

import type { Response } from 'playwright-core';

import {
  PIPELINE_WELL_KNOWN_API,
  PIPELINE_WELL_KNOWN_HEADERS,
} from '../../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../../Types/Debug.js';
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

/** WK allowed HTTP methods — CR PR #276 #6 validates request().method(). */
const ALLOWED_METHODS = ['GET', 'POST', 'PUT'] as const;
type AllowedMethod = (typeof ALLOWED_METHODS)[number];

/**
 * Check if a content-type header indicates JSON.
 * @param contentType - The content-type header value.
 * @returns True if JSON response.
 */
function isJsonContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return JSON_CONTENT_TYPES.some((jsonType): boolean => lower.includes(jsonType));
}

/** Request metadata bag returned by {@link extractRequestMeta}. */
interface IRequestMeta {
  readonly url: string;
  readonly method: AllowedMethod;
  readonly postData: string;
  readonly contentType: string;
  readonly requestHeaders: Record<string, string>;
}

/**
 * Validate raw HTTP method against the allowed set; fall back to
 * `'GET'` for unsupported verbs (DELETE/PATCH/HEAD/OPTIONS). Logs
 * the fallback so unexpected verbs surface in trace logs.
 * CR PR #276 #6 — removes the unsafe `as 'GET'|'POST'|'PUT'` cast.
 * @param raw - Raw method string from Playwright request.
 * @returns Validated method or `'GET'` fallback.
 */
function validateMethod(raw: string): AllowedMethod {
  const isKnown = (ALLOWED_METHODS as readonly string[]).includes(raw);
  if (isKnown) return raw as AllowedMethod;
  LOG.trace({ event: 'extractRequestMeta.unsupportedMethod', method: raw });
  return 'GET';
}

/**
 * Extract request metadata from a Playwright response.
 * @param response - Playwright response object.
 * @returns Bundled URL, method, postData, contentType, requestHeaders.
 */
function extractRequestMeta(response: Response): IRequestMeta {
  const headers = response.headers();
  const contentType = headers['content-type'] ?? NO_CONTENT_TYPE;
  const url = response.url();
  const request = response.request();
  const rawMethod = request.method();
  const method = validateMethod(rawMethod);
  const postData = request.postData() ?? NO_POST_DATA;
  const requestHeaders = request.headers();
  return { url, method, postData, contentType, requestHeaders };
}

/** Parsed body wrapper — keeps the typed bag separate from raw `unknown`. */
interface IParsedBody {
  readonly value: unknown;
}

/** Branded signal — true when the response should enter the captured pool. */
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
 * Decision predicate for `parseResponse`. 2xx-no-content responses
 * (HTTP 204) carry no body and typically have no `content-type`
 * header — they fail the JSON filter and would be dropped before
 * `parseTextOrNull` ever runs, making the picker's `urlOnlyMatch`
 * rescue tier unreachable for the exact captures it was added to
 * handle. Treat 204 as intrinsically recordable.
 * @param status - HTTP status code.
 * @param contentType - Response content-type header (or `'none'`).
 * @returns True when the response should enter the captured pool.
 */
function shouldRecordResponse(status: number, contentType: string): ShouldRecordResponseSignal {
  if (status === 204) return true as ShouldRecordResponseSignal;
  return isJsonContentType(contentType) as ShouldRecordResponseSignal;
}

/** Branded boolean for the unsupported-URL gate. */
type IsUnsupportedUrlSignal = boolean & {
  readonly __brand: 'IsUnsupportedUrlSignal';
};

/**
 * Test if a URL is on the unsupported-URL block list. WK-driven via
 * `PIPELINE_WELL_KNOWN_API.unsupported` — currently `.ashx` (Amex
 * legacy ProxyRequestHandler). Excluded URLs never enter the captured
 * pool. Exported for unit testing.
 * @param url - Response URL.
 * @returns True when the URL matches a WK unsupported pattern.
 */
function isUnsupportedUrl(url: string): IsUnsupportedUrlSignal {
  const isMatch = PIPELINE_WELL_KNOWN_API.unsupported.some((p): boolean => p.test(url));
  return isMatch as IsUnsupportedUrlSignal;
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

export {
  ALLOWED_METHODS,
  BROWSER_STANDARD_HEADERS,
  extractBaseUrl,
  extractRequestMeta,
  isJsonContentType,
  isReplayablePost,
  isUnsupportedUrl,
  JSON_CONTENT_TYPES,
  NO_CONTENT_TYPE,
  NO_POST_DATA,
  ORIGIN_HEADERS,
  parseTextOrNull,
  REFERER_HEADERS,
  shouldRecordResponse,
  SITE_ID_HEADERS,
};
export type {
  AllowedMethod,
  IParsedBody,
  IRequestMeta,
  IsUnsupportedUrlSignal,
  ShouldRecordResponseSignal,
};
