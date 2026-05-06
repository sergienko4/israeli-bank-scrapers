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
} from '../../Registry/WK/ScrapeWK.js';
import type { IFetchOpts } from '../../Strategy/Fetch/FetchStrategy.js';
import { getDebug } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { redactJsonBody, redactUrl, redactUrlFull } from '../../Types/PiiRedactor.js';
import { getNetworkDumpDir } from '../../Types/TraceConfig.js';
import { hasTxnArray } from '../Scrape/TxnShape.js';
import { discoverAuthThreeTier } from './AuthDiscovery.js';
import { createAuthFailureWatcher, createFrozenAuthFailureWatcher } from './AuthFailureWatcher.js';
import type { IDiscoveredEndpoint, INetworkDiscovery } from './NetworkDiscoveryTypes.js';

const LOG = getDebug(import.meta.url);

/** WK header names — imported from registry. */
const ORIGIN_HEADERS = PIPELINE_WELL_KNOWN_HEADERS.origin;
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

/**
 * Try to parse a response as a discovered endpoint.
 * @param response - Playwright response object.
 * @returns Discovered endpoint or false if not a JSON API response.
 */
async function parseResponse(response: Response): Promise<IDiscoveredEndpoint | false> {
  const meta = extractRequestMeta(response);
  if (!isJsonContentType(meta.contentType)) return false;
  try {
    const text = await response.text();
    const responseBody = JSON.parse(text) as unknown;
    const responseHeaders = response.headers();
    const captureIndex = dumpResponseBody({
      url: meta.url,
      method: meta.method,
      postData: meta.postData,
      text,
    });
    return { ...meta, responseHeaders, responseBody, timestamp: Date.now(), captureIndex };
  } catch {
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
  const dir = getNetworkDumpDir();
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
 * @returns True (always — fire-and-forget).
 */
function handleResponse(captured: IDiscoveredEndpoint[], response: Response): boolean {
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
type ShapeAwareTier = 'none' | 'postWithShape' | 'replayablePost' | 'shapePassing' | 'urlFallback';

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

/**
 * Picks the best endpoint among URL matches, preferring a replayable
 * POST template (so MatrixLoop has data to iterate) over a preview GET
 * even when the captured POST body was empty (e.g. current cycle not
 * yet charged).
 *
 * Emits one canonical `discover.shapeAware` event per call so the
 * picker's tier choice and selected URL are traceable from
 * `pipeline.log` alone. The `captureIndex` field on the log line
 * matches the on-disk filename prefix.
 *
 * @param captured - all captured endpoints.
 * @param patterns - WellKnown regex patterns.
 * @returns best endpoint, or false when no URL matches.
 */
function discoverShapeAware(
  captured: readonly IDiscoveredEndpoint[],
  patterns: readonly RegExp[],
): IDiscoveredEndpoint | false {
  const urlMatches = captured.filter((ep): boolean =>
    patterns.some((p): boolean => p.test(ep.url)),
  );
  if (urlMatches.length === 0) {
    logShapeAwarePick('none', false, 0);
    return false;
  }
  const matches = urlMatches.length;
  const shapePassing = urlMatches.filter((ep): boolean => hasTxnArray(ep.responseBody));
  const postWithShape = shapePassing.find(isReplayablePost);
  if (postWithShape) {
    logShapeAwarePick('postWithShape', postWithShape, matches);
    return postWithShape;
  }
  // Replayable POST without shape — its response was empty for the
  // captured card+month (e.g. current billing cycle not yet charged),
  // but the body template still drives MatrixLoop replay.
  const anyReplayablePost = urlMatches.find(isReplayablePost);
  if (anyReplayablePost) {
    logShapeAwarePick('replayablePost', anyReplayablePost, matches);
    return anyReplayablePost;
  }
  if (shapePassing.length > 0) {
    logShapeAwarePick('shapePassing', shapePassing[0], matches);
    return shapePassing[0];
  }
  const fallback = urlMatches[0] ?? false;
  logShapeAwarePick('urlFallback', fallback, matches);
  return fallback;
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

/** Type alias for endpoint discovery methods. */
type EndpointMethods = Pick<
  INetworkDiscovery,
  'discoverAccountsEndpoint' | 'discoverTransactionsEndpoint' | 'discoverBalanceEndpoint'
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
    discoverAccountsEndpoint: (): IDiscoveredEndpoint | false =>
      discoverByWellKnown(captured, PIPELINE_WELL_KNOWN_API.accounts),
    /** @inheritdoc */
    discoverTransactionsEndpoint: (): IDiscoveredEndpoint | false =>
      discoverShapeAware(captured, PIPELINE_WELL_KNOWN_API.transactions),
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

// ── Content-First Discovery ─────────────────────────────────

/**
 * Check if a JSON body contains any of the given field names.
 * Stringifies the body and checks for key presence — lightweight, no BFS.
 * @param body - Parsed JSON response body.
 * @param fieldNames - WK field names to search for.
 * @returns True if any field name found as a JSON key.
 */
function bodyHasFields(body: Record<string, string>, fieldNames: readonly string[]): boolean {
  const json = JSON.stringify(body);
  return fieldNames.some((f): boolean => json.includes(`"${f}"`));
}

/**
 * Content-First: find captured endpoint whose body contains WK field names.
 * Scans ALL captured JSON bodies — no URL matching needed.
 * @param captured - All captured endpoints.
 * @param fieldNames - WK field names (e.g. WK.accountId).
 * @returns First matching endpoint or false.
 */
function discoverByContent(
  captured: readonly IDiscoveredEndpoint[],
  fieldNames: readonly string[],
): IDiscoveredEndpoint | false {
  const hit = captured.find((ep): boolean => {
    if (!ep.responseBody) return false;
    return bodyHasFields(ep.responseBody as Record<string, string>, fieldNames);
  });
  if (!hit) return false;
  LOG.debug({
    message: `Content discovery: found field in ${maskVisibleText(hit.url)}`,
  });
  return hit;
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
/** Timeout for fire-and-forget POST interceptor (ms). */
const POST_INTERCEPT_TIMEOUT = 120_000;

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
    .waitForResponse(isWkApi, { timeout: POST_INTERCEPT_TIMEOUT })
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
function createNetworkDiscovery(page: Page): INetworkDiscovery {
  const captured: IDiscoveredEndpoint[] = [];
  page.on('response', (r: Response): boolean => handleResponse(captured, r));
  interceptPostResponses(page, captured);
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
      const extraHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      const auth = await cachedDiscoverAuth();
      if (auth) extraHeaders.authorization = auth;
      const origin = originDiscover.discoverOrigin();
      if (origin) extraHeaders.Origin = origin;
      if (origin) extraHeaders.Referer = origin;
      const siteId = originDiscover.discoverSiteId();
      if (siteId) extraHeaders['X-Site-Id'] = siteId;
      return { extraHeaders };
    },
  };
  const apiOrigin = {
    /** @inheritdoc */
    discoverApiOrigin: (): string | false => discoverApiOriginFromTraffic(captured),
  };
  const contentScan = {
    /** @inheritdoc */
    discoverEndpointByContent: (fieldNames: readonly string[]): IDiscoveredEndpoint | false =>
      discoverByContent(captured, fieldNames),
  };
  // Generic auth-failure watcher attached to the live page. The LoginPhase
  // owns the lifecycle: it consumes the watcher in POST and disposes it
  // before later phases run. See AuthFailureWatcher.ts for layer details.
  const authFailureWatcher = createAuthFailureWatcher(page);
  const failureGate = { authFailureWatcher };
  const base = { ...core, ...endpoints, ...originDiscover, ...urlBuilders };
  return { ...base, ...traffic, ...authCache, ...apiOrigin, ...contentScan, ...failureGate };
}

/**
 * Create a FROZEN INetworkDiscovery from a static endpoint snapshot.
 * All discovery methods operate on the frozen captured array — no live Page.
 * Auth methods return the pre-cached token. Traffic polling returns false.
 * Used by SCRAPE.ACTION to execute without browser access.
 * @param endpoints - Frozen copy of captured endpoints from PRE.
 * @param cachedAuth - Pre-cached auth token from DASHBOARD.
 * @returns Frozen INetworkDiscovery.
 */
function createFrozenNetwork(
  endpoints: readonly IDiscoveredEndpoint[],
  cachedAuth: string | false,
): INetworkDiscovery {
  const frozen = [...endpoints];
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
  };
  const apiOrigin = {
    /** @inheritdoc */
    discoverApiOrigin: (): string | false => discoverApiOriginFromTraffic(frozen),
  };
  const contentScan = {
    /** @inheritdoc */
    discoverEndpointByContent: (fieldNames: readonly string[]): IDiscoveredEndpoint | false =>
      discoverByContent(frozen, fieldNames),
  };
  // Frozen-network has no live Page, so the watcher is a no-op stub.
  const failureGate = { authFailureWatcher: createFrozenAuthFailureWatcher() };
  const base = { ...core, ...epMethods, ...frozenHeaders, ...urlBuilders };
  return { ...base, ...frozenTraffic, ...apiOrigin, ...contentScan, ...failureGate };
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
      const spaBase = extractSpaHeaders(captured);
      const extraHeaders: Record<string, string> = {
        ...spaBase,
        'Content-Type': 'application/json',
      };
      if (cachedAuth) extraHeaders.authorization = cachedAuth;
      const origin = discoverHeaderValue(captured, ORIGIN_HEADERS);
      if (origin) extraHeaders.Origin = origin;
      if (origin) extraHeaders.Referer = origin;
      const siteId = discoverHeaderValue(captured, SITE_ID_HEADERS);
      if (siteId) extraHeaders['X-Site-Id'] = siteId;
      return Promise.resolve({ extraHeaders });
    },
  };
}

export { distillHeaders } from '../Elements/HeaderDistillation.js';
export type { IDiscoveredEndpoint, INetworkDiscovery } from './NetworkDiscoveryTypes.js';
export { createFrozenNetwork, createNetworkDiscovery };
