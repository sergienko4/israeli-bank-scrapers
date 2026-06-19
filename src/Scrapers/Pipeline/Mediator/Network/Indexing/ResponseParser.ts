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
 *
 * SOAP/WCF (Broker.svc-style) envelope unwrap is a bank-specific
 * adapter concern, intentionally not on the shared response path; a
 * future SOAP-backed bank migration adds a thin bank-specific adapter
 * that unwraps before handing plain JSON to this generic parser.
 */

import type { Response } from 'playwright-core';

import { getDebug } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import { dumpResponseBody } from '../Debug/NetworkDump.js';
import type { IDiscoveredEndpoint } from '../NetworkDiscoveryTypes.js';
import {
  type DropReason,
  type IResponseMeta,
  logCaptureMiss,
  logHandleResponseError,
  logParseCatch,
  logParseDrop,
  logParseEntry,
  logTextRead,
} from './ResponseParserLogs.js';
import {
  extractRequestMeta,
  type IRequestMeta,
  isUnsupportedUrl,
  parseTextOrNull,
  shouldRecordResponse,
} from './ResponsePrimitives.js';

const LOG = getDebug(import.meta.url);

/**
 * Single-call wrapper around {@link dumpResponseBody} that pre-bundles
 * the meta-derived dump args. Keeps callers focused on body shape.
 * @param meta - Request metadata.
 * @param text - Body text (empty string for 204).
 * @returns Dump sequence index.
 */
function dumpEndpointBody(meta: IRequestMeta, text: string): number {
  return dumpResponseBody({ url: meta.url, method: meta.method, postData: meta.postData, text });
}

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
  return buildBodyEndpoint({ meta, text: '', responseBody: null, responseHeaders, status: 204 });
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
  const captureIndex = dumpEndpointBody(args.meta, args.text);
  const bag = {
    responseHeaders: args.responseHeaders,
    responseBody: args.responseBody,
    status: args.status,
  };
  return { ...args.meta, ...bag, timestamp: Date.now(), captureIndex };
}

/** Bundled args for {@link assembleBody} — keeps params ≤ 3. */
interface IAssembleBodyArgs {
  readonly meta: IRequestMeta;
  readonly text: string;
  readonly status: number;
  readonly responseHeaders: Record<string, string>;
}

/**
 * Parse the response text and build the captured endpoint.
 * @param args - Bundled meta + body + status + headers.
 * @returns Discovered endpoint.
 */
function assembleBody(args: IAssembleBodyArgs): IDiscoveredEndpoint {
  const parsed = parseTextOrNull(args.text);
  const responseBody = parsed.value;
  return buildBodyEndpoint({ ...args, responseBody });
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
  const responseHeaders = response.headers();
  return assembleBody({ meta, text, status, responseHeaders });
}

/**
 * Decide which (if any) drop reason fires for this response.
 * @param meta - Request metadata.
 * @param status - HTTP status code.
 * @returns Drop reason string or `false` to proceed.
 */
function decideDrop(meta: IRequestMeta, status: number): DropReason | false {
  if (isUnsupportedUrl(meta.url)) return 'unsupportedUrl';
  if (!shouldRecordResponse(status, meta.contentType)) return 'shouldRecordResponse=false';
  return false;
}

/** Bundled preflight result for {@link parseResponse}. */
interface IPreflight {
  readonly meta: IRequestMeta;
  readonly status: number;
  readonly drop: DropReason | false;
}

/**
 * Extract request meta + status, emit the entry log, and run the
 * drop-gate predicates. Pulled out of {@link parseResponse} so the
 * orchestrator stays within the Section 11 10-LoC cap while keeping
 * the body-read try / catch inline (an out-of-line `.catch(handler)`
 * chain would add one propagation microtask and starve fast unit
 * tests that await only twice).
 * @param response - Playwright response.
 * @returns Bundled meta + status + drop reason.
 */
function preflightParse(response: Response): IPreflight {
  const meta = extractRequestMeta(response);
  const status = response.status();
  logParseEntry(meta, status);
  const drop = decideDrop(meta, status);
  return { meta, status, drop };
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
  const { meta, status, drop } = preflightParse(response);
  if (drop !== false) return logParseDrop(drop, meta, status);
  if (status === 204) return buildNoContentEndpoint(meta, response);
  try {
    return await readAndParseBody(meta, response);
  } catch (error) {
    return logParseCatch(meta, status, error as Error);
  }
}

/**
 * Record a hit captured endpoint into the live pool and emit the
 * structured hit log.
 * @param captured - Mutable capture array.
 * @param endpoint - Parsed endpoint to record.
 * @returns Always true.
 */
function recordHit(captured: IDiscoveredEndpoint[], endpoint: IDiscoveredEndpoint): boolean {
  captured.push(endpoint);
  LOG.trace({
    event: 'recordCapture.hit',
    method: endpoint.method,
    url: maskVisibleText(endpoint.url),
  });
  return true;
}

/**
 * Record a capture miss — fires the structured miss log.
 * @param meta - Response metadata.
 * @returns Always false.
 */
function recordMiss(meta: IResponseMeta): boolean {
  logCaptureMiss(meta);
  return false;
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
  if (!endpoint) return recordMiss(meta);
  return recordHit(captured, endpoint);
}

/**
 * Build the response-meta bag (url, status, method) used by
 * downstream log helpers.
 * @param response - Playwright response.
 * @returns Bundled response meta.
 */
function buildResponseMeta(response: Response): IResponseMeta {
  const request = response.request();
  return { url: response.url(), status: response.status(), method: request.method() };
}

/**
 * Promise-chain glue between {@link parseResponse} and the capture
 * recorder + error logger.
 * @param captured - Mutable array to store discovered endpoints.
 * @param meta - Response metadata.
 * @param endpoint - Parsed endpoint or false (curried via bind).
 * @returns Recorder outcome (true on hit, false on miss).
 */
function onParseHit(
  captured: IDiscoveredEndpoint[],
  meta: IResponseMeta,
  endpoint: IDiscoveredEndpoint | false,
): boolean {
  return recordCaptureIfPresent(captured, endpoint, meta);
}

/**
 * Catch-side of the parse-promise chain — logs the failure.
 * @param meta - Response metadata.
 * @param error - Unknown thrown value.
 * @returns Always false.
 */
function onParseError(meta: IResponseMeta, error: unknown): boolean {
  return logHandleResponseError(meta.url, error);
}

/**
 * Dispatch the response into the parse pipeline; results land in
 * the capture pool or the structured log on failure.
 * @param captured - Mutable capture array.
 * @param response - Playwright response.
 * @param meta - Response metadata.
 * @returns Always true (fire-and-forget).
 */
function dispatchParse(
  captured: IDiscoveredEndpoint[],
  response: Response,
  meta: IResponseMeta,
): boolean {
  const onHit = onParseHit.bind(null, captured, meta);
  const onError = onParseError.bind(null, meta);
  parseResponse(response).then(onHit).catch(onError);
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
  const meta = buildResponseMeta(response);
  return dispatchParse(captured, response, meta);
}

export { buildNoContentEndpoint, handleResponse, parseResponse, readAndParseBody };
