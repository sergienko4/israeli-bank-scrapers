/**
 * Network Discovery — captures API traffic from browser page.
 * Black box: observes what the page's JavaScript does, stores endpoints.
 * SCRAPE phase can replay discovered patterns with different params.
 *
 * Generic for ALL banks — no bank-specific logic.
 * Captures JSON responses from page.on('response'), ignores HTML/images/fonts.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Page, Response } from 'playwright-core';

import {
  PIPELINE_WELL_KNOWN_API,
  PIPELINE_WELL_KNOWN_HEADERS,
  PIPELINE_WELL_KNOWN_TXN_FIELDS,
} from '../../Registry/WK/ScrapeWK.js';
import type { IFetchOpts } from '../../Strategy/Fetch/FetchStrategy.js';
import { getActivePhase, getActiveStage } from '../../Types/ActiveState.js';
import { getDebug } from '../../Types/Debug.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { redactJsonBody, redactUrl, redactUrlFull } from '../../Types/PiiRedactor.js';
import { getSubStepNetworkDumpDir } from '../../Types/TraceConfig.js';
import { hasTxnArray, isTxnWidgetUrl } from '../Scrape/TxnShape.js';
import { createPromise } from '../Timing/TimingActions.js';
import {
  NETWORK_POST_INTERCEPT_TIMEOUT_MS,
  NETWORK_WAIT_FIRST_ID_POLL_MS,
} from '../Timing/TimingConfig.js';
import { discoverAuthThreeTier } from './AuthDiscovery.js';
import { createAuthFailureWatcher, createFrozenAuthFailureWatcher } from './AuthFailureWatcher.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from './NetworkDiscoveryTypes.js';

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
export interface IParsedBody {
  readonly value: unknown;
}

/**
 * Branded signal — true when the response should enter the captured
 * pool. Named so Rule #15 (no primitive returns from exports) sees
 * the intent at a glance.
 */
export type ShouldRecordResponseSignal = boolean & {
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
export function parseTextOrNull(text: string): IParsedBody {
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
export function shouldRecordResponse(
  status: number,
  contentType: string,
): ShouldRecordResponseSignal {
  if (status === 204) return true as ShouldRecordResponseSignal;
  return isJsonContentType(contentType) as ShouldRecordResponseSignal;
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
export async function parseResponse(response: Response): Promise<IDiscoveredEndpoint | false> {
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
 * Per-run dump counter — each response body that gets dumped is numbered so
 * the on-disk order matches the order they fired during the run. The dump
 * folder itself is owned by TraceConfig (single per-process root for logs,
 * network, and screenshots — gated by `LOG_LEVEL=trace`).
 */
let dumpCounter = 0;

/** Bundled args for `dumpResponseBody` — keeps the helper inside the
 *  3-param ceiling while exposing both the request body (POST payload)
 *  and the response body to the trace-mode dump file. */
interface IDumpArgs {
  readonly url: string;
  readonly method: string;
  readonly postData: string;
  readonly text: string;
}

/**
 * Debug hook: write each parsed response body to the trace-mode network
 * dump folder, alongside the captured POST request body so future audits
 * can replay the exact request shape (needed for `.ashx`-removal work
 * where we replace legacy reqName=… GETs with modern POST endpoints).
 * Returns immediately when not in trace mode (TraceConfig's
 * `getNetworkDumpDir` returns empty string off-trace). Silent failures
 * to avoid impacting the pipeline when the debug target is bad.
 * @param args - Bundled url/method/postData/responseText.
 * @returns Count of dumps so far.
 */
function dumpResponseBody(args: IDumpArgs): number {
  const phase = getActivePhase();
  const stage = getActiveStage();
  const dir = getSubStepNetworkDumpDir(phase, stage);
  // Always increment so `captureIndex` stays a stable per-process
  // counter even when trace artefacts aren't being written to disk —
  // the index is also the log-side correlation key.
  dumpCounter += 1;
  if (!dir) return dumpCounter;
  try {
    // Redact account / card IDs in path segments BEFORE the regex
    // safe-encoding pass so identifiers never reach the on-disk
    // filename. `redactUrl` (query) + `redactAccount` (per-segment)
    // is composed inside `redactUrlFull` — same masking we use in
    // structured discovery logs, single source of truth.
    const safeStub = redactUrlFull(args.url)
      .replaceAll(/[^\w.-]/g, '_')
      .slice(-80);
    const name = `${String(dumpCounter).padStart(4, '0')}-${args.method}-${safeStub}.json`;
    const filePath = path.join(dir, name);
    const safeUrl = redactUrl(args.url);
    const safePostData = redactJsonBody(args.postData);
    const safeText = redactJsonBody(args.text);
    const postSuffix = { true: '', false: `\n// POST_BODY: ${safePostData}` };
    const postLine = postSuffix[String(args.postData.length === 0) as 'true' | 'false'];
    fs.writeFileSync(filePath, `// ${args.method} ${safeUrl}${postLine}\n${safeText}`);
    return dumpCounter;
  } catch {
    return dumpCounter;
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
 * Find the most common base URL from captured endpoints.
 * @param endpoints - All captured endpoints.
 * @returns Most common base URL or false.
 */
function findCommonServicesUrl(endpoints: readonly IDiscoveredEndpoint[]): string | false {
  if (endpoints.length === 0) return false;
  const counts = new Map<string, number>();
  for (const ep of endpoints) {
    const base = extractBaseUrl(ep.url);
    const current = counts.get(base) ?? 0;
    counts.set(base, current + 1);
  }
  const entries = [...counts.entries()];
  entries.sort((a, b): number => b[1] - a[1]);
  return entries[0]?.[0] ?? '';
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

/** Tier label emitted on the canonical `discover.shapeAware` event. */
type ShapeAwareTier =
  | 'none'
  | 'postWithShape'
  | 'replayablePost'
  | 'shapePassing'
  | 'preClickFallback'
  | 'urlOnlyMatch'
  | 'windowParamsMatch';

/**
 * Phase H'' (2026-05-15): WK-aliased date-window param keys, joined
 * from the WK txn-field registry. Used by the {@link hasWindowParams}
 * picker probe so the `windowParamsMatch` tier can rescue Hapoalim
 * dormant-account dashboards where the SPA fires only a populated
 * `?type=totals&view=future` GET whose URL still exposes the canonical
 * `fromDate` / `toDate` aliases.
 */
const WINDOW_FROM_KEYS = new Set<string>(PIPELINE_WELL_KNOWN_TXN_FIELDS.fromDate);
const WINDOW_TO_KEYS = new Set<string>(PIPELINE_WELL_KNOWN_TXN_FIELDS.toDate);

/**
 * Safely parse a URL string. Returns false on any parse error so the
 * caller can fall through without try/catch noise.
 * @param input - Candidate URL.
 * @returns Parsed URL or false.
 */
function safeParseWindowUrl(input: string): URL | false {
  try {
    return new URL(input);
  } catch {
    return false;
  }
}

/**
 * True when the URL's searchParams carry both a fromDate alias AND a
 * toDate alias — signals that the captured endpoint is date-window
 * aware even when its body fails the txn-shape gate. Pass-through on
 * URL parse error.
 * @param url - Captured URL.
 * @returns True when both aliases are present in the query string.
 */
function hasWindowParams(url: string): boolean {
  const parsed = safeParseWindowUrl(url);
  if (parsed === false) return false;
  const keyIter = parsed.searchParams.keys();
  const keys = Array.from(keyIter);
  const hasFrom = keys.some((key): boolean => WINDOW_FROM_KEYS.has(key));
  if (!hasFrom) return false;
  const hasTo = keys.some((key): boolean => WINDOW_TO_KEYS.has(key));
  return hasTo;
}

/**
 * Emit one canonical structured event per `discoverShapeAware` call.
 * Named fields keep the log queryable in centralized stores; PII-safe
 * via `redactUrlFull`; `captureIndex` bridges the log line to the
 * exact on-disk capture file (`<runId>/network/NNNN-METHOD-…json`).
 * @param tier - Which match tier produced the pick.
 * @param picked - Endpoint chosen (or `false` for the no-match tier).
 * @param matches - URL-pattern match count.
 * @returns True (placeholder for chaining).
 */
function logShapeAwarePick(
  tier: ShapeAwareTier,
  picked: IDiscoveredEndpoint | false,
  matches: number,
): true {
  if (!picked) {
    LOG.debug({ event: 'discover.shapeAware', tier, matches });
    return true;
  }
  LOG.debug({
    event: 'discover.shapeAware',
    tier,
    picked: redactUrlFull(picked.url),
    method: picked.method,
    captureIndex: picked.captureIndex ?? 0,
    matches,
  });
  return true;
}

/** Bundled outcome of one tier-priority pass over a candidate pool. */
interface ITierPickOutcome {
  readonly endpoint: IDiscoveredEndpoint | false;
  readonly tier: ShapeAwareTier;
  readonly matches: number;
}

/**
 * Run the shape-aware tier preference over a single candidate pool
 * (post-click or pre-click). Returns the chosen endpoint with its
 * tier label, or `none` when the pool yields no URL match at all.
 * Rejects dashboard-widget URLs (M4.F2) via {@link isTxnWidgetUrl}
 * before scoring so widgets never reach SCRAPE.
 *
 * <p>Phase H' (2026-05-15, refined after live Hapoalim trace) —
 * the `urlOnlyMatch` tier (last-resort pick) is restricted to
 * <em>2xx-no-body</em> responses (e.g. 204 No Content for a dormant
 * 30-day window). A captured response with a populated body that
 * fails the txn-shape gate is NOT a transaction endpoint — it is a
 * sibling URL like Hapoalim's `?type=totals&view=future` summary
 * GET which matches the same WK pattern but carries no txn array.
 * Picking such a URL via `urlOnlyMatch` would commit the wrong
 * endpoint and silently produce zero-txn scrapes. The picker
 * therefore falls through to `tier:'none'` on populated-but-
 * non-matching bodies, letting DASHBOARD.FINAL fail loud per the
 * user-locked principle "the dashboard ensures it has the values;
 * if not, signal LOUD".
 *
 * @param pool - Candidate captured endpoints to consider.
 * @param patterns - WellKnown URL patterns to match.
 * @returns Tiered pick outcome — endpoint and tier label.
 */
function tierPick(
  pool: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): ITierPickOutcome {
  const urlMatches = pool.filter(
    (ep): boolean => patterns.some((p): boolean => p.test(ep.url)) && !isTxnWidgetUrl(ep.url),
  );
  if (urlMatches.length === 0) return { endpoint: false, tier: 'none', matches: 0 };
  const matches = urlMatches.length;
  const shapePassing = urlMatches.filter((ep): boolean => hasTxnArray(ep.responseBody));
  const postWithShape = shapePassing.find(isReplayablePost);
  if (postWithShape) return { endpoint: postWithShape, tier: 'postWithShape', matches };
  const anyReplayablePost = urlMatches.find(isReplayablePost);
  if (anyReplayablePost) {
    return { endpoint: anyReplayablePost, tier: 'replayablePost', matches };
  }
  if (shapePassing.length > 0) {
    return { endpoint: shapePassing[0], tier: 'shapePassing', matches };
  }
  const emptyBodyMatch = urlMatches.find((ep): boolean => ep.responseBody === null);
  if (emptyBodyMatch) {
    return { endpoint: emptyBodyMatch, tier: 'urlOnlyMatch', matches };
  }
  // Phase H'' (2026-05-15): Hapoalim dormant-account rescue — pick a
  // populated-body URL whose searchParams expose the canonical
  // fromDate/toDate WK aliases. SCRAPE then writes the live window
  // via `applyDateRangeToUrl`; the detector tuple supplied through
  // `fc.dateWindowParams` covers the APPEND case when aliases are
  // absent from the captured URL.
  const windowParamsHit = urlMatches.find((ep): boolean => hasWindowParams(ep.url));
  if (windowParamsHit) {
    return { endpoint: windowParamsHit, tier: 'windowParamsMatch', matches };
  }
  return { endpoint: false, tier: 'none', matches };
}

/**
 * Stamp the picker tier label and pre-click flag onto the chosen
 * endpoint so DASHBOARD.FINAL's resolver can carry them onto
 * `ITxnEndpointInternal`. Pure shape extension; preserves the rest
 * of the captured fields.
 *
 * @param endpoint - Picked endpoint.
 * @param tier - Tier label producing the pick.
 * @param capturedPreClick - True when the pick came from the pre-click pool.
 * @returns Endpoint with `pickerTier` + `capturedPreClick` populated.
 */
function stampTierMeta(
  endpoint: IDiscoveredEndpoint,
  tier: ShapeAwareTier,
  capturedPreClick: boolean,
): IDiscoveredEndpoint {
  return { ...endpoint, pickerTier: tier, capturedPreClick };
}

/**
 * Phase 7f — picks the best endpoint from the post-click pool first;
 * when the post-click pool yields zero matches, falls back to the
 * full captured pool with a `preClickFallback` tier label. The
 * fallback covers Visacal-class banks where the real TRX URL fires
 * at login-FINAL (before any dashboard click).
 *
 * <p>Emits one canonical `discover.shapeAware` event per call so the
 * picker's tier choice and selected URL are traceable from
 * `pipeline.log` alone. The `captureIndex` field on the log line
 * matches the on-disk filename prefix.
 *
 * @param postNav - Post-click captured endpoints (preferred pool).
 * @param fullPool - All captured endpoints (pre-click fallback).
 * @param patterns - WellKnown regex patterns.
 * @returns Best endpoint stamped with `pickerTier` + `capturedPreClick`,
 *   or false when no pool yields a match.
 */
function discoverShapeAware(
  postNav: readonly IDiscoveredEndpoint[],
  fullPool: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): IDiscoveredEndpoint | false {
  const postOutcome = tierPick(postNav, patterns);
  if (postOutcome.endpoint !== false) {
    const stamped = stampTierMeta(postOutcome.endpoint, postOutcome.tier, false);
    logShapeAwarePick(postOutcome.tier, stamped, postOutcome.matches);
    return stamped;
  }
  // Post-click pool yielded nothing — try the FULL pool. Any pre-click
  // hit is logged as `preClickFallback` so a Visacal-class capture
  // surfaces in telemetry as the documented exception.
  const fullOutcome = tierPick(fullPool, patterns);
  if (fullOutcome.endpoint !== false) {
    const stamped = stampTierMeta(fullOutcome.endpoint, 'preClickFallback', true);
    logShapeAwarePick('preClickFallback', stamped, fullOutcome.matches);
    return stamped;
  }
  // No shape-passing capture in either pool — surface as no-match.
  // DASHBOARD.FINAL escalates to F-DASH-1 so the pipeline halts before
  // SCRAPE inherits a URL whose body has zero transaction records.
  logShapeAwarePick('none', false, fullOutcome.matches);
  return false;
}

/**
 * Find the first endpoint matching any pattern in the list.
 * @param captured - All captured endpoints.
 * @param patterns - WellKnown regex patterns to try in order.
 * @returns First matching endpoint or false.
 */
function discoverByWellKnown(
  captured: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): IDiscoveredEndpoint | false {
  /**
   * Test if an endpoint URL matches a regex pattern.
   * @param ep - Captured endpoint.
   * @param p - Pattern to test.
   * @returns True if URL matches.
   */
  const urlMatchesPattern = (ep: IDiscoveredEndpoint, p: RegExp): boolean => p.test(ep.url);
  /**
   * Check if any captured endpoint URL matches a pattern.
   * @param p - Pattern to test against all captured endpoints.
   * @returns True if at least one URL matches.
   */
  const matchesAny = (p: RegExp): boolean =>
    captured.some((ep): boolean => urlMatchesPattern(ep, p));
  const match = patterns.find(matchesAny);
  if (!match) return false;
  const hit = captured.find((ep): boolean => match.test(ep.url));
  return hit ?? false;
}

/**
 * Check if an endpoint has a non-empty value for any of the header names.
 * @param ep - Captured endpoint.
 * @param headerNames - Header names to check.
 * @returns Header value or false.
 */
function extractHeader(ep: IDiscoveredEndpoint, headerNames: readonly string[]): string | false {
  const match = headerNames.find(
    (h): boolean => typeof ep.requestHeaders[h] === 'string' && ep.requestHeaders[h].length > 0,
  );
  if (!match) return false;
  return ep.requestHeaders[match];
}

/**
 * Find the first non-empty header value matching any WellKnown header name.
 * @param captured - All captured endpoints.
 * @param headerNames - Header names to search (lowercase).
 * @returns Header value or false.
 */
function discoverHeaderValue(
  captured: readonly IDiscoveredEndpoint[],
  headerNames: readonly string[],
): string | false {
  const ep = captured.find((e): boolean => extractHeader(e, headerNames) !== false);
  if (!ep) return false;
  return extractHeader(ep, headerNames);
}

/**
 * Build the low-level discovery methods bound to captured data.
 * @param captured - Mutable captured endpoints array.
 * @returns Low-level discovery methods.
 */
function buildCoreMethods(
  captured: IDiscoveredEndpoint[],
): Pick<
  INetworkDiscovery,
  'findEndpoints' | 'getServicesUrl' | 'getAllEndpoints' | 'discoverByPatterns' | 'discoverSpaUrl'
> {
  return {
    /** @inheritdoc */
    findEndpoints: (pattern: RegExp): readonly IDiscoveredEndpoint[] =>
      captured.filter((ep): boolean => pattern.test(ep.url)),
    /** @inheritdoc */
    getServicesUrl: (): string | false => findCommonServicesUrl(captured),
    /** @inheritdoc */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => [...captured],
    /** @inheritdoc */
    discoverByPatterns: (patterns: readonly RegExp[]): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, patterns),
    /** @inheritdoc */
    discoverSpaUrl: (currentOrigin?: string): string | false =>
      discoverSpaUrlFromTraffic(captured, currentOrigin),
  };
}

/** Type alias for endpoint discovery methods (txn + balance only). */
type EndpointMethods = Pick<
  INetworkDiscovery,
  'discoverTransactionsEndpoint' | 'discoverBalanceEndpoint'
>;

/** Type alias for header discovery methods. */
type HeaderMethods = Pick<
  INetworkDiscovery,
  'discoverAuthToken' | 'discoverOrigin' | 'discoverSiteId' | 'buildDiscoveredHeaders'
>;

/**
 * Build endpoint discovery methods via WellKnown patterns.
 * @param captured - Captured endpoints array.
 * @returns Endpoint discovery methods.
 */
function buildEndpointMethods(captured: readonly IDiscoveredEndpoint[]): EndpointMethods {
  return {
    /** @inheritdoc */
    discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false =>
      // Phase 7f: this base-table fallback is overridden by the live
      // network's post-click-first picker; it stays here as a safe
      // default for surfaces that do not own the post/pre-click
      // bucket split (e.g. some test mocks). Walks the full pool with
      // the same tier rules; the post-click vs pre-click distinction
      // is irrelevant when only one pool is available.
      discoverShapeAware(captured, captured, PIPELINE_WELL_KNOWN_API.transactions),
    /** @inheritdoc */
    discoverBalanceEndpoint: (): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.balance),
  };
}

/**
 * Discover the SPA URL from captured API traffic.
 * Finds a captured endpoint on an API domain and extracts its referer header.
 * The referer is the SPA page that made the API call.
 * @param captured - All captured endpoints.
 * @returns SPA URL or false.
 */
/**
 * Tier 1: Find SPA URL from cross-domain referer on WellKnown API endpoints.
 * @param captured - All captured endpoints.
 * @returns SPA URL or false.
 */
function findByReferer(captured: readonly IDiscoveredEndpoint[]): string | false {
  const apiPatterns = [
    ...PIPELINE_WELL_KNOWN_API.transactions,
    ...PIPELINE_WELL_KNOWN_API.accounts,
    ...PIPELINE_WELL_KNOWN_API.balance,
    ...PIPELINE_WELL_KNOWN_API.auth,
  ];
  const apiEndpoint = captured.find((ep): boolean => {
    const isApi = apiPatterns.some((p): boolean => p.test(ep.url));
    if (!isApi) return false;
    const referer = ep.requestHeaders.referer;
    if (!referer) return false;
    const epOrigin = new URL(ep.url).origin;
    const refOrigin = new URL(referer).origin;
    return epOrigin !== refOrigin;
  });
  if (!apiEndpoint) return false;
  const ref = apiEndpoint.requestHeaders.referer;
  if (!ref) return false;
  LOG.debug({
    message:
      `SPA Tier1 (referer): ${maskVisibleText(ref)} ` + `from ${maskVisibleText(apiEndpoint.url)}`,
  });
  return ref;
}

/**
 * Tier 2: Find SPA URL from CORS access-control-allow-origin response header.
 * Generic W3C standard — every cross-origin API returns this header.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin for filtering.
 * @returns SPA URL or false.
 */
/**
 * Check if a CORS header reveals a cross-domain SPA.
 * @param ep - Captured endpoint.
 * @param pageOrigin - Current page origin.
 * @returns SPA URL or false.
 */
function checkCorsHeader(ep: IDiscoveredEndpoint, pageOrigin: string): string | false {
  const cors = ep.responseHeaders['access-control-allow-origin'];
  if (!cors || cors === '*') return false;
  const corsOrigin = new URL(cors).origin;
  const epOrigin = new URL(ep.url).origin;
  const isCross = corsOrigin !== epOrigin && corsOrigin !== pageOrigin;
  if (!isCross) return false;
  LOG.debug({
    message: `SPA Tier2 (CORS): ${maskVisibleText(cors)} from ${maskVisibleText(ep.url)}`,
  });
  return cors;
}

/**
 * Tier 2: Find SPA URL from CORS allow-origin response header.
 * @param captured - All captured endpoints.
 * @param pageOrigin - Current page origin for filtering.
 * @returns SPA URL or false.
 */
function findByCorsOrigin(
  captured: readonly IDiscoveredEndpoint[],
  pageOrigin: string,
): string | false {
  const hit = captured.find((ep): boolean => checkCorsHeader(ep, pageOrigin) !== false);
  if (!hit) return false;
  return checkCorsHeader(hit, pageOrigin);
}

/**
 * Discover SPA URL from traffic — 2-tier: referer → CORS allow-origin.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin (optional).
 * @returns SPA URL or false.
 */
/** URL pattern in JSON config bodies — matches https://sub.domain.co.il paths. */
const CONFIG_URL_REGEX = /https:\/\/[\w-]+\.[\w.-]+\.\w{2,}/g;

/**
 * Tier 3: Scan captured JSON response bodies for cross-subdomain URLs.
 * Config files (config.prod.json) often contain the SPA dashboard URL.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin.
 * @returns SPA URL or false.
 */
/** Subdomains that are infrastructure, not SPA dashboards. */
const INFRA_PREFIXES = ['api.', 'connect.', 'css.', 'cdn.', 'login.'];

/**
 * Check if a URL is a candidate SPA on the same parent domain.
 * @param url - Discovered URL.
 * @param currentHost - Current page hostname.
 * @param parentDomain - Parent domain suffix.
 * @returns True if candidate SPA.
 */
function isSpaCandidate(url: string, currentHost: string, parentDomain: string): boolean {
  const host = new URL(url).hostname;
  const isSameParent = host.endsWith(parentDomain);
  const isDifferent = host !== currentHost;
  const isNotInfra = !INFRA_PREFIXES.some((p): boolean => host.startsWith(p));
  return isSameParent && isDifferent && isNotInfra;
}

/**
 * Scan a single config endpoint body for SPA URLs.
 * @param ep - Config endpoint.
 * @param currentHost - Current hostname.
 * @param parentDomain - Parent domain suffix.
 * @returns SPA URL or false.
 */
function scanConfigBody(
  ep: IDiscoveredEndpoint,
  currentHost: string,
  parentDomain: string,
): string | false {
  const body = JSON.stringify(ep.responseBody);
  const urls = body.match(CONFIG_URL_REGEX);
  if (!urls) return false;
  const hit = urls.find((u): boolean => isSpaCandidate(u, currentHost, parentDomain));
  if (!hit) return false;
  LOG.debug({
    message: `SPA Tier3 (config): ${maskVisibleText(hit)} from ${maskVisibleText(ep.url)}`,
  });
  return hit;
}

/**
 * Tier 3: Scan captured JSON config bodies for cross-subdomain URLs.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin.
 * @returns SPA URL or false.
 */
function findByConfigBody(
  captured: readonly IDiscoveredEndpoint[],
  currentOrigin: string,
): string | false {
  const currentHost = new URL(currentOrigin).hostname;
  const parentDomain = currentHost.split('.').slice(-3).join('.');
  const configEps = captured.filter(
    (ep): boolean => ep.url.includes('config') || ep.url.includes('settings'),
  );
  const hit = configEps.find(
    (ep): boolean => scanConfigBody(ep, currentHost, parentDomain) !== false,
  );
  if (!hit) return false;
  return scanConfigBody(hit, currentHost, parentDomain);
}

/**
 * Discover SPA URL — 3-tier: referer → CORS → config body scan.
 * @param captured - All captured endpoints.
 * @param currentOrigin - Current page origin (optional).
 * @returns SPA URL or false.
 */
function discoverSpaUrlFromTraffic(
  captured: readonly IDiscoveredEndpoint[],
  currentOrigin?: string,
): string | false {
  const byReferer = findByReferer(captured);
  if (byReferer) return byReferer;
  if (!currentOrigin) return false;
  const byCors = findByCorsOrigin(captured, currentOrigin);
  if (byCors) return byCors;
  return findByConfigBody(captured, currentOrigin);
}

// ── API Origin Discovery (Pre-Emptive Forensic) ─────────────

/** URL pattern for API paths in JSON config bodies. */
const API_PATH_REGEX = /https:\/\/[^"]+\/api\//gi;

/**
 * Tier 1: Scan config body for API URLs.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
/**
 * Extract API origin from a single config endpoint body.
 * @param ep - Config endpoint.
 * @returns API origin or false.
 */
function extractApiFromBody(ep: IDiscoveredEndpoint): string | false {
  const body = JSON.stringify(ep.responseBody);
  const urls = body.match(API_PATH_REGEX);
  if (!urls || urls.length === 0) return false;
  const origin = new URL(urls[0]).origin;
  LOG.debug({
    message: `apiOrigin Tier1 (config): ${maskVisibleText(origin)} from ${maskVisibleText(ep.url)}`,
  });
  return origin;
}

/**
 * Tier 1: Scan config body for API URLs.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromConfig(captured: readonly IDiscoveredEndpoint[]): string | false {
  const configEps = captured.filter(
    (ep): boolean => ep.url.includes('config') || ep.url.includes('settings'),
  );
  const hit = configEps.find((ep): boolean => extractApiFromBody(ep) !== false);
  if (!hit) return false;
  return extractApiFromBody(hit);
}

/**
 * Tier 2: Find API origin from api.* subdomain endpoints.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromSubdomain(captured: readonly IDiscoveredEndpoint[]): string | false {
  const hit = captured.find((ep): boolean => new URL(ep.url).hostname.startsWith('api.'));
  if (!hit) return false;
  const origin = new URL(hit.url).origin;
  LOG.debug({
    message: `apiOrigin Tier2 (subdomain): ${maskVisibleText(origin)}`,
  });
  return origin;
}

/**
 * Tier 3: Find API origin from any captured POST with /api/ in URL.
 * @param captured - All captured endpoints.
 * @returns API origin or false.
 */
function discoverApiFromPath(captured: readonly IDiscoveredEndpoint[]): string | false {
  const hit = captured.find((ep): boolean => ep.method === 'POST' && ep.url.includes('/api/'));
  if (!hit) return false;
  const origin = new URL(hit.url).origin;
  LOG.debug({
    message: `apiOrigin Tier3 (path): ${maskVisibleText(origin)}`,
  });
  return origin;
}

/**
 * Discover API origin — 3-tier: config body → api.* subdomain → /api/ path.
 * @param captured - All captured endpoints.
 * @returns API origin URL or false.
 */
function discoverApiOriginFromTraffic(captured: readonly IDiscoveredEndpoint[]): string | false {
  const fromConfig = discoverApiFromConfig(captured);
  if (fromConfig) return fromConfig;
  const fromSubdomain = discoverApiFromSubdomain(captured);
  if (fromSubdomain) return fromSubdomain;
  return discoverApiFromPath(captured);
}

// ── Origin Utilities ────────────────────────────────────────

/**
 * Check if a header name is browser-standard (should be excluded from SPA merge).
 * @param name - Lowercase header name.
 * @returns True if standard browser header.
 */
function isBrowserStandard(name: string): boolean {
  const lower = name.toLowerCase();
  return BROWSER_STANDARD_HEADERS.has(lower);
}

/**
 * Extract SPA-specific headers from the transaction endpoint.
 * Filters out browser-standard headers, keeps custom SPA headers (SID, CID, etc.).
 * @param captured - Captured endpoints.
 * @returns SPA-specific headers or empty object.
 */
function extractSpaHeaders(captured: readonly IDiscoveredEndpoint[]): Record<string, string> {
  const txnEp = discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.transactions);
  if (!txnEp) return {};
  const entries = Object.entries(txnEp.requestHeaders);
  const spaOnly = entries.filter(([name]): boolean => !isBrowserStandard(name));
  const count = String(spaOnly.length);
  LOG.debug({ message: `spaHeaders: ${count} custom headers from txn endpoint` });
  return Object.fromEntries(spaOnly);
}

/**
 * Case-insensitive presence check: does the SPA-extracted header set
 * already carry ANY of the names in `headerNames`? Used to gate the
 * bank-specific fallback layers (Referer / X-Site-Id from
 * `discoverHeaderValue`) so they skip themselves when the captured
 * pool already provides the header — avoiding duplicate-header
 * rejection (VisaCal 401 regression, 15-05-2026 run `14093991`:
 * SCRAPE sent both `x-site-id` and `X-Site-Id` → 401 Unauthorized;
 * Hapoalim's 302 fix proved Referer needs the same guard).
 *
 * `headerNames` MUST come from WK (`REFERER_HEADERS` / `SITE_ID_HEADERS`)
 * — never hardcode literals. Captures arrive lowercase (HTTP/2 wire
 * shape); explicit overrides use mixed case; both must be observed.
 *
 * @param spaBase - SPA-extracted headers.
 * @param headerNames - WK alias list to check against (any-of).
 * @returns True when any case-variant of any listed name is present.
 */
function spaHasAny(
  spaBase: Readonly<Record<string, string>>,
  headerNames: readonly string[],
): boolean {
  const lowered = headerNames.map((n): string => n.toLowerCase());
  const targets = new Set(lowered);
  const spaKeys = Object.keys(spaBase);
  return spaKeys.some((k): boolean => {
    const keyLower = k.toLowerCase();
    return targets.has(keyLower);
  });
}

/** WellKnown transaction URL query params for full history. */
const FULL_TXN_PARAMS = [
  'IsCategoryDescCode=True',
  'IsTransactionDetails=True',
  'IsEventNames=True',
  'IsFutureTransactionFlag=True',
];

/**
 * Find the first captured endpoint that BOTH contains the account ID
 * AND matches a WK transactions URL pattern. Filters out unrelated
 * endpoints (e.g. `general/getUserPilotInfo/<accountId>`) that share
 * the account ID by coincidence but are not transaction fetchers —
 * picking such a URL produced malformed reconstructed URLs in the
 * earlier implementation.
 * @param captured - Captured endpoints.
 * @param accountId - Account ID to search for in URLs.
 * @returns First matching txn-pattern endpoint or false.
 */
function findTxnUrlWithAccountId(
  captured: readonly IDiscoveredEndpoint[],
  accountId: string,
): IDiscoveredEndpoint | false {
  const txnPatterns = PIPELINE_WELL_KNOWN_API.transactions;
  const hit = captured.find((ep): boolean => {
    if (!ep.url.includes(accountId)) return false;
    return txnPatterns.some((p): boolean => p.test(ep.url));
  });
  return hit ?? false;
}

/**
 * Build a full transaction URL from a captured txn endpoint that
 * already contains the account ID. Preserves the captured path
 * structure verbatim — everything up to the first occurrence of the
 * accountId becomes the URL prefix, and `<accountId>/Date?<params>`
 * is appended. PURE GENERIC across banks regardless of how many path
 * segments sit between the API root and the account ID. Replaces an
 * earlier greedy `lastTransactions` regex strip that assumed
 * `/lastTransactions/<accountId>` was the canonical shape and lost
 * intermediate path segments such as Discount's new
 * `/lastTransactions/transactions/<accountId>/forHomePage`.
 *
 * @param captured - Captured endpoints.
 * @param accountId - Account number.
 * @param startDate - Formatted start date.
 * @returns Full transaction URL or false.
 */
function buildTxnUrlFromTraffic(
  captured: readonly IDiscoveredEndpoint[],
  accountId: string,
  startDate: string,
): string | false {
  const hit = findTxnUrlWithAccountId(captured, accountId);
  if (!hit) return false;
  const parts = hit.url.split(accountId);
  if (parts.length < 2) return false;
  const prefix = parts[0];
  const params = [...FULL_TXN_PARAMS, `FromDate=${startDate}`].join('&');
  return `${prefix}${accountId}/Date?${params}`;
}

/**
 * Build a balance URL from discovered traffic pattern.
 * @param captured - Captured endpoints.
 * @param accountId - Account number.
 * @returns Balance URL or false.
 */
function buildBalUrlFromTraffic(
  captured: readonly IDiscoveredEndpoint[],
  accountId: string,
): string | false {
  const balanceHits = captured.filter((ep): boolean =>
    PIPELINE_WELL_KNOWN_API.balance.some((p): boolean => p.test(ep.url)),
  );
  if (balanceHits.length === 0) return false;
  const templateUrl = balanceHits[0].url;
  const pathOnly = templateUrl.split('?')[0];
  const segments = pathOnly.split('/');
  const lastSegMaybe = segments.at(-1);
  if (lastSegMaybe === undefined) return false;
  const isAccountInUrl = /^\d{5,}$/.test(lastSegMaybe);
  if (isAccountInUrl) {
    segments[segments.length - 1] = accountId;
    return segments.join('/');
  }
  return `${pathOnly}/${accountId}`;
}

/**
 * Check if any captured endpoint matches the patterns.
 * @param captured - Live captured endpoints.
 * @param patterns - WellKnown regex patterns.
 * @returns First matching endpoint or false.
 */
function findTrafficHit(
  captured: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): IDiscoveredEndpoint | false {
  const hit = captured.find(
    (ep): boolean =>
      ep.responseBody !== undefined &&
      ep.responseBody !== null &&
      patterns.some((p): boolean => p.test(ep.url)),
  );
  return hit ?? false;
}

/** Predicate signature — caller-owned shape detector. */
type FirstIdPredicate = (pool: readonly IDiscoveredEndpoint[]) => IDiscoveredEndpoint | false;

/** Args bundle for the recursive id-wait poll. */
interface IPollFirstIdArgs {
  readonly captured: readonly IDiscoveredEndpoint[];
  readonly deadline: number;
  readonly predicate: FirstIdPredicate;
}

/**
 * Wait one poll-interval tick. Uses `createPromise` (Reflect-built
 * Promise) so the no-`new Promise` lint rule stays satisfied and the
 * sleep-ban (`sleep()` keyword forbidden by the project lint set)
 * doesn't apply to the local helper.
 * @returns Resolved promise after `NETWORK_WAIT_FIRST_ID_POLL_MS` ms.
 */
function pollTick(): Promise<true> {
  /**
   * Schedule the resolve via setTimeout (callback returns true).
   * @param resolve - Promise resolver.
   * @returns True after the timer is armed.
   */
  const arm = (resolve: (value: true) => boolean): boolean => {
    /**
     * Timer callback — resolves the promise.
     * @returns True to satisfy the typed resolver signature.
     */
    const fire = (): boolean => resolve(true);
    globalThis.setTimeout(fire, NETWORK_WAIT_FIRST_ID_POLL_MS);
    return true;
  };
  return createPromise<true>(arm);
}

/**
 * Recursive poll for the first id-bearing capture — replaces the
 * banned `while + await-in-loop` pattern. Each tick inspects the
 * live capture array by reference; additions made by the page
 * listener between ticks are visible on the next call.
 * @param args - Captured pool (by reference) + absolute deadline ms.
 * @returns First id-bearing endpoint or false on timeout.
 */
async function pollFirstId(args: IPollFirstIdArgs): Promise<IDiscoveredEndpoint | false> {
  const hit = args.predicate(args.captured);
  if (hit !== false) return hit;
  if (Date.now() >= args.deadline) return false;
  await pollTick();
  return pollFirstId(args);
}

/**
 * Block until `predicate(captured)` yields a match or the budget
 * elapses. Captures are inspected by reference so additions made
 * by the page listener while we sleep are visible on the next
 * iteration. The predicate is caller-supplied (typically
 * AccountResolve's wrapper around `discoverAccountsInPool`) so
 * Network has zero AccountResolve knowledge.
 *
 * @param captured - Live capture array (read by reference each tick).
 * @param timeoutMs - Max wait budget in ms.
 * @param predicate - Caller-owned shape detector.
 * @returns First matching endpoint or false on timeout.
 */
function awaitFirstId(
  captured: readonly IDiscoveredEndpoint[],
  timeoutMs: number,
  predicate: FirstIdPredicate,
): Promise<IDiscoveredEndpoint | false> {
  const deadline = Date.now() + timeoutMs;
  return pollFirstId({ captured, deadline, predicate });
}

/** Bundled args for traffic waiting. */
interface ITrafficWaitArgs {
  readonly page: Page;
  readonly captured: readonly IDiscoveredEndpoint[];
  readonly patterns: readonly RegExp[];
}

/**
 * Wait for a response matching WellKnown patterns via Playwright.
 * Non-polling: uses Playwright's native event-driven response matching.
 * @param args - Page, captured endpoints, and patterns.
 * @param timeoutMs - Max wait time.
 * @returns First matching endpoint or false on timeout.
 */
async function awaitTraffic(
  args: ITrafficWaitArgs,
  timeoutMs: number,
): Promise<IDiscoveredEndpoint | false> {
  const immediate = findTrafficHit(args.captured, args.patterns);
  if (immediate) return immediate;
  /**
   * Match response URL against WellKnown patterns.
   * @param r - Playwright response.
   * @returns True if URL matches.
   */
  const matchUrl = (r: Response): boolean => {
    const url = r.url();
    return args.patterns.some((p): boolean => p.test(url));
  };
  await args.page.waitForResponse(matchUrl, { timeout: timeoutMs }).catch((): false => false);
  return findTrafficHit(args.captured, args.patterns);
}

/**
 * Create a network discovery instance bound to a page.
 * Starts capturing immediately on creation.
 * @param page - Playwright page to observe.
 * @returns Network discovery interface.
 */
/**
 * Intercept POST responses matching WellKnown patterns from any frame.
 * `page.waitForResponse` captures cross-origin iframe traffic that
 * `page.on('response')` misses. Generic for all banks.
 * @param page - Playwright page.
 * @param captured - Mutable captured endpoints array.
 * @returns True (fire-and-forget).
 */
function interceptPostResponses(page: Page, captured: IDiscoveredEndpoint[]): boolean {
  const allPatterns = [
    ...PIPELINE_WELL_KNOWN_API.auth,
    ...PIPELINE_WELL_KNOWN_API.transactions,
    ...PIPELINE_WELL_KNOWN_API.accounts,
    ...PIPELINE_WELL_KNOWN_API.balance,
  ];
  /**
   * Match POST requests against WellKnown patterns.
   * @param r - Playwright response.
   * @returns True if POST + URL matches.
   */
  /**
   * Match POST/PUT requests against WellKnown patterns.
   * @param r - Playwright response.
   * @returns True if API method + URL matches.
   */
  const isWkApi = (r: Response): boolean => {
    const method = r.request().method();
    const isApiMethod = method === 'POST' || method === 'PUT';
    const url = r.url();
    return isApiMethod && allPatterns.some((p): boolean => p.test(url));
  };
  page
    .waitForResponse(isWkApi, { timeout: NETWORK_POST_INTERCEPT_TIMEOUT_MS })
    .then(async (resp): Promise<boolean> => {
      const endpoint = await parseResponse(resp);
      if (!endpoint) return false;
      const isDupe = captured.some((ep): boolean => ep.url === endpoint.url);
      if (isDupe) return false;
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
 * Create a network discovery instance bound to a page.
 * Starts capturing immediately on creation.
 * @param page - Playwright page to observe.
 * @returns Network discovery interface.
 */
/**
 * Mutable click-at slot — the only piece of state shared between
 * DASHBOARD.ACTION (writes) and DASHBOARD.FINAL / SCRAPE.PRE
 * (reads). Encapsulated in an interface so the closure that owns
 * it can hand the same handle to multiple builders.
 */
interface IDashboardClickState {
  readonly mark: (timestampMs: number) => true;
  readonly read: () => number | false;
}

/**
 * Build the dashboard-click marker + reader pair backed by a single
 * mutable cell. Bank-agnostic — the timestamp is just a number.
 * @param initial - Initial value (false means "no click yet").
 * @returns Mark + read accessors.
 */
function buildDashboardClickState(initial: number | false): IDashboardClickState {
  let value: number | false = initial;
  /**
   * Set the dashboard-click timestamp on the closure cell.
   * @param timestampMs - Click timestamp.
   * @returns True after writing.
   */
  const mark = (timestampMs: number): true => {
    value = timestampMs;
    return true;
  };
  /**
   * Read the dashboard-click timestamp from the closure cell.
   * @returns Click timestamp or false when not yet set.
   */
  const read = (): number | false => value;
  return { mark, read };
}

/**
 * Mutable state pair for the live recording gate — the writer
 * (`flip`) is what the lifecycle interceptor calls between phases;
 * the reader (`read`) is consulted on every captured response so the
 * page listener can short-circuit during pre-auth phases without
 * tearing the listener down.
 */
interface ICollectionState {
  readonly flip: (active: boolean) => true;
  readonly read: () => boolean;
}

/**
 * Build the recording-gate accessors backed by a single mutable cell.
 * Default `true` preserves legacy behaviour for any caller that never
 * gates the network (API-direct banks, tests).
 * @param initial - Initial recording state.
 * @returns Flip + read accessors.
 */
function buildCollectionState(initial: boolean): ICollectionState {
  let isActive = initial;
  /**
   * Apply the recording state to the closure cell.
   * @param active - True to record captures.
   * @returns True after writing.
   */
  const flip = (active: boolean): true => {
    isActive = active;
    return true;
  };
  /**
   * Read the recording state from the closure cell.
   * @returns True when captures should be stored.
   */
  const read = (): boolean => isActive;
  return { flip, read };
}

/**
 * Build the click-aware capture-bucketing helpers shared by live and
 * frozen networks. The split is timestamp-driven when a dashboard
 * click has been dispatched (`markDashboardClickAt`); when no click
 * was issued — Visacal-class banks where login-FINAL already lands
 * the dashboard data, no SPA navigation needed — both buckets fall
 * back to the full captured pool. The full-pool fallback restores
 * symmetry with `getPreNavCaptures` (which already widens to full
 * when no click) and lets {@link discoverShapeAware} see the txn
 * URLs the bank fired during login-FINAL.
 * @param captured - Captures array (live or frozen).
 * @param clickState - Shared click-at state.
 * @returns Bucketing accessors for the INetworkDiscovery contract.
 */
function buildBucketingMethods(
  captured: readonly IDiscoveredEndpoint[],
  clickState: IDashboardClickState,
): Pick<
  INetworkDiscovery,
  'markDashboardClickAt' | 'getDashboardClickAt' | 'getPreNavCaptures' | 'getPostNavCaptures'
> {
  return {
    /** @inheritdoc */
    markDashboardClickAt: clickState.mark,
    /** @inheritdoc */
    getDashboardClickAt: clickState.read,
    /** @inheritdoc */
    getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => {
      const clickAt = clickState.read();
      if (clickAt === false) return captured;
      return captured.filter((ep): boolean => ep.timestamp < clickAt);
    },
    /** @inheritdoc */
    getPostNavCaptures: (): readonly IDiscoveredEndpoint[] => {
      const clickAt = clickState.read();
      if (clickAt === false) return captured;
      return captured.filter((ep): boolean => ep.timestamp >= clickAt);
    },
  };
}

/**
 * Optional behaviour modifiers for {@link createNetworkDiscovery}.
 */
interface INetworkDiscoveryOpts {
  /**
   * When true, `page.on('response')` and `interceptPostResponses`
   * are NOT attached at construction. Listeners attach lazily on
   * the first `setCollectionActive(true)` call from the trace-
   * lifecycle interceptor. Used by the production pipeline to
   * keep the homepage / WAF-check window listener-free (I-3
   * experiment 2026-05-13 — hCaptcha may observe pre-attached
   * Playwright `page.on(...)` via the browser's CDP-mode signals).
   * Default: false (eager attach — backwards-compatible with the
   * 200+ unit tests that exercise `createNetworkDiscovery`
   * directly without going through the interceptor).
   */
  readonly isDeferAttach?: boolean;
}

/**
 * Build the live INetworkDiscovery instance bound to a Playwright Page.
 * Captures responses, exposes WK-pattern discovery, and tracks the
 * dashboard-click moment so DASHBOARD.FINAL / SCRAPE.PRE can split
 * captures into pre-nav and post-nav buckets.
 *
 * @param page - Playwright page to capture responses from.
 * @param opts - Optional behaviour modifiers (see
 *   {@link INetworkDiscoveryOpts}). Defaults preserve eager attach
 *   so existing tests stay green.
 * @returns The live network-discovery instance.
 */
function createNetworkDiscovery(page: Page, opts: INetworkDiscoveryOpts = {}): INetworkDiscovery {
  const captured: IDiscoveredEndpoint[] = [];
  const isDeferAttach = opts.isDeferAttach === true;
  // Initial collection state: false when deferring (no listeners
  // yet, no captures), true when eager (legacy test-friendly path).
  const collectionState = buildCollectionState(!isDeferAttach);
  let isAttached = false;
  /**
   * Idempotent listener attachment. Eager mode calls this once
   * synchronously; deferred mode invokes it from the first
   * `setCollectionActive(true)` triggered by the trace-lifecycle
   * interceptor at the post-AUTH phase boundary.
   *
   * @returns True when THIS call attached the listeners; false on
   *   the repeat-call no-op (so the two branches differ — satisfies
   *   sonarjs/no-invariant-returns).
   */
  const attachListenersOnce = (): boolean => {
    if (isAttached) return false;
    page.on('response', (r: Response): boolean =>
      handleResponse(captured, r, collectionState.read),
    );
    interceptPostResponses(page, captured);
    isAttached = true;
    return true;
  };
  if (!isDeferAttach) attachListenersOnce();
  /**
   * Wrap collectionState.flip so deferred-mode lazy-attaches on
   * first flip-to-active. Eager mode is a thin pass-through.
   *
   * @param active - True to record captures.
   * @returns True after the flag is set.
   */
  const flipAndMaybeAttach = (active: boolean): true => {
    if (active) attachListenersOnce();
    return collectionState.flip(active);
  };
  const clickState = buildDashboardClickState(false);
  const bucketing = buildBucketingMethods(captured, clickState);
  const lifecycle = {
    /** @inheritdoc */
    setCollectionActive: flipAndMaybeAttach,
  };
  const core = buildCoreMethods(captured);
  const endpoints = buildEndpointMethods(captured);
  const originDiscover = {
    /** @inheritdoc */
    discoverOrigin: (): string | false => discoverHeaderValue(captured, ORIGIN_HEADERS),
    /** @inheritdoc */
    discoverSiteId: (): string | false => discoverHeaderValue(captured, SITE_ID_HEADERS),
  };
  const urlBuilders = {
    /** @inheritdoc */
    buildTransactionUrl: (accountId: string, startDate: string): string | false =>
      buildTxnUrlFromTraffic(captured, accountId, startDate),
    /** @inheritdoc */
    buildBalanceUrl: (accountId: string): string | false =>
      buildBalUrlFromTraffic(captured, accountId),
  };
  const traffic = {
    /** @inheritdoc */
    waitForTraffic: (
      patterns: readonly RegExp[],
      timeoutMs: number,
    ): Promise<IDiscoveredEndpoint | false> =>
      awaitTraffic({ page, captured, patterns }, timeoutMs),
    /** @inheritdoc */
    waitForTransactionsTraffic: (timeoutMs: number): Promise<IDiscoveredEndpoint | false> =>
      awaitTraffic({ page, captured, patterns: PIPELINE_WELL_KNOWN_API.transactions }, timeoutMs),
    /** @inheritdoc */
    waitForFirstId: (
      timeoutMs: number,
      predicate: FirstIdPredicate,
    ): Promise<IDiscoveredEndpoint | false> => awaitFirstId(captured, timeoutMs, predicate),
  };
  const authState = { cached: false as string | false, discovered: false };
  /**
   * Discover auth with cache support. Caches BOTH positive and negative
   * results so banks whose auth lives in cookies (not sessionStorage) don't
   * pay `pollForAuthModule`'s 10 s timeout on every scrape iteration.
   * @returns Token or false.
   */
  const cachedDiscoverAuth = async (): Promise<string | false> => {
    if (authState.discovered) return authState.cached;
    authState.cached = await discoverAuthThreeTier(captured, page);
    authState.discovered = true;
    return authState.cached;
  };
  const authCache = {
    /** @inheritdoc */
    cacheAuthToken: async (): Promise<string | false> => {
      const token = await discoverAuthThreeTier(captured, page);
      authState.cached = token;
      authState.discovered = true;
      if (token) {
        const truncated = token.slice(0, 20);
        const preview = maskVisibleText(truncated);
        LOG.trace({ message: preview });
      }
      return authState.cached;
    },
    /** @inheritdoc */
    discoverAuthToken: cachedDiscoverAuth,
    /**
     * Build headers with cached auth.
     * @returns Fetch options with auth + origin + site-id.
     */
    buildDiscoveredHeaders: async (): Promise<IFetchOpts> => {
      // Captured SPA headers are the SINGLE source of truth — no
      // hardcoded Content-Type, no defaults. extractSpaHeaders now
      // preserves the captured `content-type` and `referer` so the
      // request shape replays exactly as the SPA sent it. The bank-
      // specific Origin / Site-Id / authorization layers stack on
      // top only when the SPA didn't capture an equivalent value.
      const spaBase = extractSpaHeaders(captured);
      const extraHeaders: Record<string, string> = { ...spaBase };
      const auth = await cachedDiscoverAuth();
      if (auth) extraHeaders.authorization = auth;
      const origin = originDiscover.discoverOrigin();
      if (origin) extraHeaders.Origin = origin;
      if (origin && !spaHasAny(spaBase, REFERER_HEADERS)) extraHeaders.Referer = origin;
      const siteId = originDiscover.discoverSiteId();
      if (siteId && !spaHasAny(spaBase, SITE_ID_HEADERS)) extraHeaders['X-Site-Id'] = siteId;
      return { extraHeaders };
    },
  };
  const apiOrigin = {
    /** @inheritdoc */
    discoverApiOrigin: (): string | false => discoverApiOriginFromTraffic(captured),
  };
  // Generic auth-failure watcher attached to the live page. The LoginPhase
  // owns the lifecycle: it consumes the watcher in POST and disposes it
  // before later phases run. See AuthFailureWatcher.ts for layer details.
  const authFailureWatcher = createAuthFailureWatcher(page);
  const failureGate = { authFailureWatcher };
  /**
   * Phase 7f — pick the txn endpoint from the post-click pool first,
   * then fall back to the full captured pool when the post-click pool
   * is empty. Discount-class banks click "All Transactions" and the
   * real txn URL fires after the click — strict post-click discipline
   * keeps preview-widget URLs (Discount's `/forHomePage`) out of the
   * picker. Visacal-class banks fire `/getFilteredTransactions` at
   * login-FINAL (before any click); the fall-back tier
   * `preClickFallback` recovers those without compromising the
   * discipline elsewhere.
   * @returns Discovered txn endpoint stamped with `pickerTier` +
   *   `capturedPreClick`, or false.
   */
  const discoverTxnPostClickFirst = (): IDiscoveredEndpoint | false => {
    const postNav = bucketing.getPostNavCaptures();
    return discoverShapeAware(postNav, captured, PIPELINE_WELL_KNOWN_API.transactions);
  };
  const txnDiscovery = {
    /** @inheritdoc */
    discoverTransactionsEndpoint: discoverTxnPostClickFirst,
  };
  const base = { ...core, ...endpoints, ...originDiscover, ...urlBuilders };
  return {
    ...base,
    ...bucketing,
    ...lifecycle,
    ...txnDiscovery,
    ...traffic,
    ...authCache,
    ...apiOrigin,
    ...failureGate,
  };
}

/**
 * Create a FROZEN INetworkDiscovery from a static endpoint snapshot.
 * All discovery methods operate on the frozen captured array — no live Page.
 * Auth methods return the pre-cached token. Traffic polling returns false.
 * Used by SCRAPE.ACTION to execute without browser access.
 *
 * @param endpoints - Frozen copy of captured endpoints from PRE.
 * @param cachedAuth - Pre-cached auth token from DASHBOARD.
 * @param dashboardClickAt - Click timestamp inherited from the live
 *   network at freeze time. `false` for tests / synthetic frozen
 *   replays — bucketing methods then expose the full pool, which is
 *   the safe default when no nav-click occurred. SCRAPE.PRE callers
 *   should always pass the real value through `IScrapeDiscovery`.
 * @returns Frozen INetworkDiscovery.
 */
function createFrozenNetwork(
  endpoints: readonly IDiscoveredEndpoint[],
  cachedAuth: string | false,
  dashboardClickAt: number | false = false,
): INetworkDiscovery {
  const frozen = [...endpoints];
  const clickState = buildDashboardClickState(dashboardClickAt);
  const bucketing = buildBucketingMethods(frozen, clickState);
  const core = buildCoreMethods(frozen);
  const epMethods = buildEndpointMethods(frozen);
  const frozenHeaders = buildFrozenHeaders(frozen, cachedAuth);
  const urlBuilders = {
    /** @inheritdoc */
    buildTransactionUrl: (accountId: string, startDate: string): string | false =>
      buildTxnUrlFromTraffic(frozen, accountId, startDate),
    /** @inheritdoc */
    buildBalanceUrl: (accountId: string): string | false =>
      buildBalUrlFromTraffic(frozen, accountId),
  };
  const frozenTraffic = {
    /** @inheritdoc */
    waitForTraffic: (): Promise<IDiscoveredEndpoint | false> => Promise.resolve(false),
    /** @inheritdoc */
    waitForTransactionsTraffic: (): Promise<IDiscoveredEndpoint | false> => Promise.resolve(false),
    /** @inheritdoc */
    waitForFirstId: (
      _timeoutMs: number,
      predicate: FirstIdPredicate,
    ): Promise<IDiscoveredEndpoint | false> => {
      const hit = predicate(frozen);
      return Promise.resolve(hit);
    },
  };
  const apiOrigin = {
    /** @inheritdoc */
    discoverApiOrigin: (): string | false => discoverApiOriginFromTraffic(frozen),
  };
  // Frozen-network has no live Page, so the watcher is a no-op stub.
  const failureGate = { authFailureWatcher: createFrozenAuthFailureWatcher() };
  /**
   * Phase 7f — frozen replay applies the same post-click-first
   * discipline as the live network. The frozen bucketing surface
   * exposes `getPostNavCaptures()` filtered by the `dashboardClickAt`
   * timestamp captured at freeze time; the picker walks that pool
   * first and falls back to the FULL frozen pool when post-click
   * yields nothing. Visacal-class banks recover via the
   * `preClickFallback` tier, just as in the live picker.
   * @returns Discovered txn endpoint or false.
   */
  const discoverTxnFromFrozenPool = (): IDiscoveredEndpoint | false => {
    const postNav = bucketing.getPostNavCaptures();
    return discoverShapeAware(postNav, frozen, PIPELINE_WELL_KNOWN_API.transactions);
  };
  const txnDiscovery = {
    /** @inheritdoc */
    discoverTransactionsEndpoint: discoverTxnFromFrozenPool,
  };
  // Frozen replays have no listener, so the lifecycle gate is a
  // no-op — accepting the call lets callers stay live-vs-frozen
  // agnostic without runtime branching.
  const lifecycle = {
    /** @inheritdoc */
    setCollectionActive: (): true => true,
  };
  const base = { ...core, ...epMethods, ...frozenHeaders, ...urlBuilders };
  return {
    ...base,
    ...bucketing,
    ...lifecycle,
    ...txnDiscovery,
    ...frozenTraffic,
    ...apiOrigin,
    ...failureGate,
  };
}

/**
 * Build frozen header methods — no Page, uses cached auth.
 * @param captured - Frozen endpoints.
 * @param cachedAuth - Pre-cached auth token.
 * @returns Header discovery methods with cached auth.
 */
function buildFrozenHeaders(
  captured: readonly IDiscoveredEndpoint[],
  cachedAuth: string | false,
): HeaderMethods & Pick<INetworkDiscovery, 'cacheAuthToken' | 'buildDiscoveredHeaders'> {
  return {
    /** @inheritdoc */
    discoverAuthToken: (): Promise<string | false> => Promise.resolve(cachedAuth),
    /** @inheritdoc */
    discoverOrigin: (): string | false => discoverHeaderValue(captured, ORIGIN_HEADERS),
    /** @inheritdoc */
    discoverSiteId: (): string | false => discoverHeaderValue(captured, SITE_ID_HEADERS),
    /** @inheritdoc */
    cacheAuthToken: (): Promise<string | false> => Promise.resolve(cachedAuth),
    /** @inheritdoc */
    buildDiscoveredHeaders: (): Promise<IFetchOpts> => {
      // Captured SPA headers are the SINGLE source of truth — see
      // LIVE counterpart for rationale. No hardcoded Content-Type:
      // the captured `content-type` (Hapoalim:
      // `application/json;charset=UTF-8`) and `referer` (full SPA
      // path) survive extractSpaHeaders and replay exactly.
      const spaBase = extractSpaHeaders(captured);
      const extraHeaders: Record<string, string> = { ...spaBase };
      if (cachedAuth) extraHeaders.authorization = cachedAuth;
      const origin = discoverHeaderValue(captured, ORIGIN_HEADERS);
      if (origin) extraHeaders.Origin = origin;
      if (origin && !spaHasAny(spaBase, REFERER_HEADERS)) extraHeaders.Referer = origin;
      const siteId = discoverHeaderValue(captured, SITE_ID_HEADERS);
      if (siteId && !spaHasAny(spaBase, SITE_ID_HEADERS)) extraHeaders['X-Site-Id'] = siteId;
      return Promise.resolve({ extraHeaders });
    },
  };
}

export { distillHeaders } from '../Elements/HeaderDistillation.js';
export type { IDiscoveredEndpoint, INetworkDiscovery } from './NetworkDiscoveryTypes.js';
export { createFrozenNetwork, createNetworkDiscovery };
