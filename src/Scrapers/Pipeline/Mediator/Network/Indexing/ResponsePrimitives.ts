/**
 * Network Indexing / ResponsePrimitives — pure request-meta extraction
 * and capture-gate predicates over a single Playwright Response.
 *
 * Boundary: a true leaf — depends only on the WK registry, Debug, and
 * playwright types. Holds NO reference to `ResponseParser.ts` (the
 * orchestrator) so the parser/logs half can import these primitives
 * without re-entering `Indexing.ts`.
 *
 * Extracted from `Indexing.ts` (slice 12i-4) to dissolve the
 * Indexing ↔ ResponseParser ↔ ResponseParserLogs import cycle:
 * `Indexing.ts` re-exports every symbol here, so the public facade
 * stays byte-identical for downstream consumers (Scoring, Discovery).
 */

import type { Request, Response } from 'playwright-core';

import { PIPELINE_WELL_KNOWN_API } from '../../../Registry/WK/ScrapeWK.js';
import { getDebug } from '../../../Types/Debug.js';

const LOG = getDebug(import.meta.url);

/** Sentinel for missing content-type header. */
const NO_CONTENT_TYPE = 'none';

/** Sentinel for missing POST body. */
const NO_POST_DATA = '';

/** Content types that may contain a JSON API response. */
const JSON_CONTENT_TYPES = ['application/json', 'text/json', 'text/plain', 'text/html'];

/** Content type shared by bank JSON-over-HTML APIs and page documents. */
const HTML_CONTENT_TYPE = 'text/html';

/**
 * Resource types whose body is an API payload rather than a rendered
 * page document. Playwright reports `xhr` / `fetch` for programmatic
 * traffic and `document` for navigations, so this is the discriminator
 * that keeps the Leumi / Isracard JSON-over-HTML captures (see
 * `LeumiShape.ts` and `IsracardShape.ts`) while excluding SPA pages.
 */
const API_RESOURCE_TYPES = ['xhr', 'fetch'] as const;

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
  readonly resourceType: string;
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

/** Bundled args for {@link extractRequestParts} return-type alias. */
type RequestParts = Pick<IRequestMeta, 'method' | 'postData' | 'requestHeaders' | 'resourceType'>;

/**
 * Read `request.resourceType()` defensively. Playwright's real
 * `Request` always implements it; the fallback is reachable only from
 * hand-rolled test doubles, and resolves to an API type so those
 * fixtures keep their pre-existing capture behaviour.
 * @param request - Playwright request behind the response.
 * @returns Resource type string.
 */
function readResourceType(request: Request): string {
  if (typeof request.resourceType !== 'function') return API_RESOURCE_TYPES[0];
  return request.resourceType();
}

/**
 * Extract the method + postData + requestHeaders triple from the
 * response's request. Pulled out of {@link extractRequestMeta} so the
 * orchestrator stays under the per-function 10-LoC cap.
 * @param response - Playwright response (for `response.request()`).
 * @returns Bundled method (validated), postData, requestHeaders.
 */
function extractRequestParts(response: Response): RequestParts {
  const request = response.request();
  const rawMethod = request.method();
  const method = validateMethod(rawMethod);
  const postData = request.postData() ?? NO_POST_DATA;
  const requestHeaders = request.headers();
  const resourceType = readResourceType(request);
  return { method, postData, requestHeaders, resourceType };
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
  const parts = extractRequestParts(response);
  return { url, contentType, ...parts };
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
 * Detect an HTML *page document* — a navigation body that only ever
 * fails `JSON.parse`. Admitting these made `response.text()` pull whole
 * SPA documents across the CDP bridge into Node on every navigation,
 * the unbounded allocation path behind the production OOM (13 GB to
 * retrieve 3 transactions). Bank JSON-over-HTML APIs arrive as
 * `xhr` / `fetch` and are unaffected.
 * @param contentType - Response content-type header.
 * @param resourceType - Playwright resource type of the request.
 * @returns True when the body is a page document and must not be read.
 */
function isPageDocumentHtml(contentType: string, resourceType: string): boolean {
  if (!contentType.toLowerCase().includes(HTML_CONTENT_TYPE)) return false;
  return !(API_RESOURCE_TYPES as readonly string[]).includes(resourceType);
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
 * @param resourceType - Playwright resource type; gates `text/html`
 *   so page documents never reach `response.text()`.
 * @returns True when the response should enter the captured pool.
 */
function shouldRecordResponse(
  status: number,
  contentType: string,
  resourceType: string = API_RESOURCE_TYPES[0],
): ShouldRecordResponseSignal {
  if (status === 204) return true as ShouldRecordResponseSignal;
  if (isPageDocumentHtml(contentType, resourceType)) return false as ShouldRecordResponseSignal;
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

export {
  ALLOWED_METHODS,
  API_RESOURCE_TYPES,
  extractRequestMeta,
  isJsonContentType,
  isPageDocumentHtml,
  isUnsupportedUrl,
  JSON_CONTENT_TYPES,
  NO_CONTENT_TYPE,
  NO_POST_DATA,
  parseTextOrNull,
  shouldRecordResponse,
};
export type {
  AllowedMethod,
  IParsedBody,
  IRequestMeta,
  IsUnsupportedUrlSignal,
  ShouldRecordResponseSignal,
};
