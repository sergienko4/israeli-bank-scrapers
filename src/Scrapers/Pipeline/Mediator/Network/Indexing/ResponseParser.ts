/**
 * Network Indexing / ResponseParser — body-reading + capture-routing
 * half of the Playwright response pipeline. Extracted from
 * `Indexing.ts` per CR PR #276 #7: the previous 104-LoC
 * `parseResponse` exceeded Section 11's new per-function cap. Split
 * into three helpers:
 *
 *   • `parseResponse` — thin orchestrator (entry-log → gates →
 *     204 fast-path → body read).
 *   • `buildNoContentEndpoint` — 204 No Content fast-path; records
 *     the URL without calling `response.text()`.
 *   • `readAndParseBody` — happy-path body read + parse + dump.
 *   • `handleResponse` — `page.on('response')` adapter; lives here
 *     to avoid a circular import between `Indexing.ts` (predicates)
 *     and this file (parseResponse).
 *
 * Structured-log helpers live in {@link ./ResponseParserLogs.js}.
 */

import type { Response } from 'playwright-core';

import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { dumpResponseBody } from '../Debug/NetworkDump.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import {
  extractRequestMeta,
  type IRequestMeta,
  isUnsupportedUrl,
  parseTextOrNull,
  shouldRecordResponse,
} from './Indexing.js';
import {
  type IResponseMeta,
  logCaptureMiss,
  logHandleResponseError,
  logParseCatch,
  logParseDrop,
  logParseEntry,
  logTextRead,
} from './ResponseParserLogs.js';

const LOG = getDebug(import.meta.url);

/**
 * CR #7 — 204 No Content fast-path: record the URL without reading
 * the body. Calling `response.text()` on a no-body response can
 * throw in some Playwright runtime / Camoufox builds; the
 * short-circuit keeps the picker's `urlOnlyMatch` rescue tier
 * reachable for dormant-account dashboards.
 * @param meta - Request metadata.
 * @param response - Playwright response.
 * @returns Synthesised endpoint with `responseBody: null`.
 */
function buildNoContentEndpoint(meta: IRequestMeta, response: Response): IDiscoveredEndpoint {
  LOG.debug({ event: 'parseResponse.shortCircuit204', url: maskVisibleText(meta.url) });
  const responseHeaders = response.headers();
  const captureIndex = dumpResponseBody({
    url: meta.url,
    method: meta.method,
    postData: meta.postData,
    text: '',
  });
  return {
    ...meta,
    responseHeaders,
    responseBody: null,
    timestamp: Date.now(),
    captureIndex,
    status: 204,
  };
}

/** Bundled args for {@link buildBodyEndpoint} — keeps params ≤ 3. */
interface IBodyEndpointArgs {
  readonly meta: IRequestMeta;
  readonly text: string;
  readonly responseBody: unknown;
  readonly responseHeaders: Record<string, string>;
  readonly status: number;
}

/**
 * Construct the captured endpoint from a successfully-read body.
 * @param args - Bundled meta + body + status.
 * @returns Discovered endpoint with `captureIndex` set.
 */
function buildBodyEndpoint(args: IBodyEndpointArgs): IDiscoveredEndpoint {
  const captureIndex = dumpResponseBody({
    url: args.meta.url,
    method: args.meta.method,
    postData: args.meta.postData,
    text: args.text,
  });
  return {
    ...args.meta,
    responseHeaders: args.responseHeaders,
    responseBody: args.responseBody,
    timestamp: Date.now(),
    captureIndex,
    status: args.status,
  };
}

/**
 * CR #7 — happy-path body read + JSON parse + on-disk dump.
 * Empty / whitespace-only payloads normalise to `null` via
 * {@link parseTextOrNull} so the picker's `urlOnlyMatch` rescue
 * tier remains reachable.
 * @param meta - Request metadata.
 * @param response - Playwright response.
 * @returns Discovered endpoint or throws on malformed JSON.
 */
async function readAndParseBody(
  meta: IRequestMeta,
  response: Response,
): Promise<IDiscoveredEndpoint> {
  const text = await response.text();
  const status = response.status();
  logTextRead(meta, status, text.length);
  const responseBody = parseTextOrNull(text).value;
  const responseHeaders = response.headers();
  return buildBodyEndpoint({ meta, text, responseBody, responseHeaders, status });
}

/**
 * Try to parse a response as a discovered endpoint.
 *
 * <p>Exported for unit testing — the production handlers
 * (`handleResponse` / `interceptPostResponses`) consume it
 * internally but the live 204-drop debug procedure needs a direct
 * entry point.
 *
 * @param response - Playwright response object.
 * @returns Discovered endpoint or false if filtered / errored.
 */
async function parseResponse(response: Response): Promise<IDiscoveredEndpoint | false> {
  const meta = extractRequestMeta(response);
  const status = response.status();
  logParseEntry(meta, status);
  if (isUnsupportedUrl(meta.url)) return logParseDrop('unsupportedUrl', meta, status);
  if (!shouldRecordResponse(status, meta.contentType)) {
    return logParseDrop('shouldRecordResponse=false', meta, status);
  }
  if (status === 204) return buildNoContentEndpoint(meta, response);
  try {
    return await readAndParseBody(meta, response);
  } catch (error) {
    return logParseCatch(meta, status, error as Error);
  }
}

/**
 * Push the parsed endpoint into the live capture pool when present;
 * otherwise log the miss via {@link logCaptureMiss}.
 * @param captured - Mutable capture array.
 * @param endpoint - Parsed endpoint or false.
 * @param meta - Response metadata for the miss log.
 * @returns True when the endpoint was recorded.
 */
function recordCaptureIfPresent(
  captured: IDiscoveredEndpoint[],
  endpoint: IDiscoveredEndpoint | false,
  meta: IResponseMeta,
): boolean {
  if (!endpoint) {
    logCaptureMiss(meta);
    return false;
  }
  captured.push(endpoint);
  LOG.trace({ method: endpoint.method, url: maskVisibleText(endpoint.url) });
  return true;
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
  const request = response.request();
  const meta: IResponseMeta = {
    url: response.url(),
    status: response.status(),
    method: request.method(),
  };
  parseResponse(response)
    .then((endpoint): boolean => recordCaptureIfPresent(captured, endpoint, meta))
    .catch((error: unknown): boolean => logHandleResponseError(meta.url, error));
  return true;
}

export { buildNoContentEndpoint, handleResponse, parseResponse, readAndParseBody };
