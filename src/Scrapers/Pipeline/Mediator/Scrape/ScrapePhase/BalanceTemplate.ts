/**
 * BalanceTemplate — discover the balance fetch template from the
 * captured pool of network endpoints.
 *
 * Inspects the request shapes SCRAPE / DASHBOARD already used and
 * picks the SMALLEST-arity per-bank-account call pattern. Detection
 * order: POST(body queryId), GET(query queryId), GET(path /<id>), bulk.
 *
 * Extracted from ScrapePhaseActions.ts in Phase 8.5b C4.
 */

import { PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS as WK_ACCT } from '../../../Registry/WK/ScrapeWK.js';
import {
  type IBalanceFetchTemplate,
  type IPipelineContext,
} from '../../../Types/PipelineContext.js';
import type { IDiscoveredEndpoint } from '../../Network/NetworkDiscoveryTypes.js';

/** Empty template sentinel — `url === ''` means "no template found". */
const EMPTY_BALANCE_TEMPLATE: IBalanceFetchTemplate = Object.freeze({ url: '', method: 'GET' });

/** Result wrapper for {@link tryParseJsonObject}. */
interface IJsonParseResult {
  readonly size: number;
  readonly record: Readonly<Record<string, unknown>>;
}

const EMPTY_JSON_PARSE: IJsonParseResult = Object.freeze({ size: 0, record: Object.freeze({}) });

/**
 * Narrow a JSON.parse result to a record. Arrays / nulls / primitives
 * collapse to the empty sentinel so {@link tryParseJsonObject} stays
 * flat (max-depth ≤ 1).
 *
 * @param parsed - JSON.parse result.
 * @returns Wrapped record (size=0 ⇒ non-object).
 */
function narrowParsedToResult(parsed: unknown): IJsonParseResult {
  if (parsed === null) return EMPTY_JSON_PARSE;
  if (typeof parsed !== 'object') return EMPTY_JSON_PARSE;
  if (Array.isArray(parsed)) return EMPTY_JSON_PARSE;
  const record = parsed as Record<string, unknown>;
  return { size: Object.keys(record).length || 1, record };
}

/**
 * Try to parse a JSON string and narrow to a plain object record.
 * @param raw - JSON string.
 * @returns Wrapped record + size (size=0 ⇒ parse failed or non-object).
 */
function tryParseJsonObject(raw: string): IJsonParseResult {
  try {
    const parsed: unknown = JSON.parse(raw);
    return narrowParsedToResult(parsed);
  } catch {
    return EMPTY_JSON_PARSE;
  }
}

/**
 * Populate a flat record from a parsed URL's searchParams.
 *
 * @param u - Parsed URL.
 * @returns Flat record of query params.
 */
function populateQueryRecord(u: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of u.searchParams.entries()) out[k] = v;
  return out;
}

/**
 * Parse the URL query string into a flat record.
 * @param url - URL.
 * @returns Query record.
 */
function parseQueryRecord(url: string): Record<string, string> {
  try {
    return populateQueryRecord(new URL(url));
  } catch {
    return {};
  }
}

/**
 * Extract the last URL path segment (the bit after the final `/` and
 * before any query string). Used by GET-path template detection.
 *
 * @param url - URL.
 * @returns Last path segment (after final `/`, before `?`).
 */
function pathTailSegment(url: string): string {
  const qIdx = url.indexOf('?');
  const noQuery = qIdx < 0 ? url : url.slice(0, qIdx);
  const slashIdx = noQuery.lastIndexOf('/');
  return slashIdx < 0 ? noQuery : noQuery.slice(slashIdx + 1);
}

/**
 * Strip the query string off a URL, returning the path-only prefix.
 *
 * @param url - URL.
 * @returns URL without the query string.
 */
function urlWithoutQuery(url: string): string {
  const i = url.indexOf('?');
  return i < 0 ? url : url.slice(0, i);
}

/**
 * Build a lowercase-key → original-key lookup so {@link pickQueryIdKey}
 * stays at depth 1 (max-depth rule).
 *
 * @param rec - Plain record.
 * @returns Lookup map.
 */
function buildLowerKeyMap(rec: Readonly<Record<string, unknown>>): Map<string, string> {
  const out = new Map<string, string>();
  /**
   * Add a single lowercase→original entry to the lookup.
   * @param k - Original key.
   * @returns Updated lookup map.
   */
  const setEntry = (k: string): Map<string, string> => {
    const lowerK = k.toLowerCase();
    return out.set(lowerK, k);
  };
  Object.keys(rec).forEach(setEntry);
  return out;
}

/**
 * Resolve the original-case key for a lowercase WK alias, returning
 * empty when not present.
 *
 * @param lowerToKey - Lowercase → original key lookup.
 * @param alias - WK_ACCT.queryId alias to resolve.
 * @returns Original-case key, or empty string.
 */
function resolveOriginalKey(lowerToKey: Map<string, string>, alias: string): string {
  const lowerAlias = alias.toLowerCase();
  return lowerToKey.get(lowerAlias) ?? '';
}

/**
 * Find the first key in `rec` whose name matches any WK_ACCT.queryId
 * alias (case-insensitive).
 *
 * @param rec - Plain record.
 * @returns Matching key or empty.
 */
function pickQueryIdKey(rec: Readonly<Record<string, unknown>>): string {
  const lowerToKey = buildLowerKeyMap(rec);
  const lookups = WK_ACCT.queryId.map((alias): string => resolveOriginalKey(lowerToKey, alias));
  const match = lookups.find((k): boolean => k.length > 0);
  return match ?? '';
}

/**
 * Inspect one endpoint and return a POST template when its JSON body
 * carries a WK_ACCT.queryId field, else EMPTY_BALANCE_TEMPLATE.
 *
 * @param ep - One captured endpoint.
 * @returns POST template or {@link EMPTY_BALANCE_TEMPLATE}.
 */
function tryBuildPostTemplate(ep: IDiscoveredEndpoint): IBalanceFetchTemplate {
  if (ep.method !== 'POST' || ep.postData.length === 0) return EMPTY_BALANCE_TEMPLATE;
  const parsed = tryParseJsonObject(ep.postData);
  if (parsed.size === 0) return EMPTY_BALANCE_TEMPLATE;
  const key = pickQueryIdKey(parsed.record);
  if (!key) return EMPTY_BALANCE_TEMPLATE;
  return { url: urlWithoutQuery(ep.url), method: 'POST', postBodyKey: key };
}

/**
 * Locate a POST capture whose JSON body carries a WK_ACCT.queryId
 * field and return a POST template with that field as postBodyKey.
 *
 * @param pool - Captured endpoints.
 * @returns POST template or EMPTY_BALANCE_TEMPLATE.
 */
function findPostTemplate(pool: readonly IDiscoveredEndpoint[]): IBalanceFetchTemplate {
  const templates = pool.map(tryBuildPostTemplate);
  return templates.find((t): boolean => t.url !== '') ?? EMPTY_BALANCE_TEMPLATE;
}

/**
 * Inspect one endpoint and return a GET-query template when its URL
 * query carries a WK_ACCT.queryId key, else EMPTY_BALANCE_TEMPLATE.
 *
 * @param ep - One captured endpoint.
 * @returns GET template or {@link EMPTY_BALANCE_TEMPLATE}.
 */
function tryBuildGetQueryTemplate(ep: IDiscoveredEndpoint): IBalanceFetchTemplate {
  if (ep.method !== 'GET') return EMPTY_BALANCE_TEMPLATE;
  const query = parseQueryRecord(ep.url);
  const key = pickQueryIdKey(query);
  if (!key) return EMPTY_BALANCE_TEMPLATE;
  return { url: ep.url, method: 'GET', urlQueryKey: key };
}

/**
 * Locate a GET capture whose URL query carries a WK_ACCT.queryId
 * key and return a GET template with `urlQueryKey`.
 *
 * @param pool - Captured endpoints.
 * @returns GET template or EMPTY_BALANCE_TEMPLATE.
 */
function findGetQueryTemplate(pool: readonly IDiscoveredEndpoint[]): IBalanceFetchTemplate {
  const templates = pool.map(tryBuildGetQueryTemplate);
  return templates.find((t): boolean => t.url !== '') ?? EMPTY_BALANCE_TEMPLATE;
}

/**
 * Replace ONLY the final `/${tail}` segment of a URL path. Anchors at
 * the end of the path so an earlier occurrence is never replaced.
 * CR#281/CR-1. Caller MUST guarantee `url`'s path ends with `/${tail}`
 * (callers in this file verify via `ids.includes(pathTail)` upstream).
 *
 * @param url - URL string whose path ends with `/${tail}`.
 * @param tail - Final path segment to swap for `<ID>`.
 * @returns URL with last `/${tail}` swapped for `/<ID>`.
 */
function replaceLastPathSegment(url: string, tail: string): string {
  const qIdx = url.indexOf('?');
  const path = qIdx < 0 ? url : url.slice(0, qIdx);
  const needle = `/${tail}`;
  return `${path.slice(0, -needle.length)}/<ID>${qIdx < 0 ? '' : url.slice(qIdx)}`;
}

/**
 * Inspect one endpoint and return a GET-path template when its URL
 * path ends in `/<id>` where id is one of the iter accountIds.
 *
 * @param ep - One captured endpoint.
 * @param ids - Iter accountIds.
 * @returns GET template or {@link EMPTY_BALANCE_TEMPLATE}.
 */
function tryBuildGetPathTemplate(
  ep: IDiscoveredEndpoint,
  ids: readonly string[],
): IBalanceFetchTemplate {
  if (ep.method !== 'GET') return EMPTY_BALANCE_TEMPLATE;
  const pathTail = pathTailSegment(ep.url);
  if (!ids.includes(pathTail)) return EMPTY_BALANCE_TEMPLATE;
  const templateUrl = replaceLastPathSegment(ep.url, pathTail);
  return { url: templateUrl, method: 'GET', urlPathInterpolation: true };
}

/**
 * Locate a GET capture whose URL path ends in `/<id>` where id is one
 * of the accountDiscovery ids.
 *
 * @param pool - Captured endpoints.
 * @param ids - Account discovery iter ids.
 * @returns GET template or EMPTY_BALANCE_TEMPLATE.
 */
function findGetPathTemplate(
  pool: readonly IDiscoveredEndpoint[],
  ids: readonly string[],
): IBalanceFetchTemplate {
  const templates = pool.map((ep): IBalanceFetchTemplate => tryBuildGetPathTemplate(ep, ids));
  return templates.find((t): boolean => t.url !== '') ?? EMPTY_BALANCE_TEMPLATE;
}

/**
 * Final fallback: emit a bulk template using the first POST or GET
 * in the pool (no per-account key).
 *
 * @param pool - Captured endpoints.
 * @returns Bulk template, or {@link EMPTY_BALANCE_TEMPLATE} for empty pool.
 */
function findBulkTemplate(pool: readonly IDiscoveredEndpoint[]): IBalanceFetchTemplate {
  const ep = pool.find((e): boolean => e.method === 'POST' || e.method === 'GET');
  if (ep === undefined) return EMPTY_BALANCE_TEMPLATE;
  const method = ep.method === 'POST' ? 'POST' : 'GET';
  const url = urlWithoutQuery(ep.url);
  return { url, method };
}

/**
 * Build the keyed-template candidates in detection-priority order
 * (POST body queryId → GET query queryId → GET path /<id>).
 *
 * @param pool - Captured endpoints.
 * @param ids - Iter accountIds.
 * @returns Three-element candidate array.
 */
function buildKeyedCandidates(
  pool: readonly IDiscoveredEndpoint[],
  ids: readonly string[],
): readonly IBalanceFetchTemplate[] {
  return [findPostTemplate(pool), findGetQueryTemplate(pool), findGetPathTemplate(pool, ids)];
}

/**
 * Sequential finder chain — first non-empty template wins. Hoisted
 * out of {@link discoverBalanceFetchTemplate} so that function stays
 * ≤10 effective lines (C6-ready).
 *
 * @param pool - Captured endpoints.
 * @param ids - Iter accountIds.
 * @returns First matching template, or {@link EMPTY_BALANCE_TEMPLATE}.
 */
function tryFinderChain(
  pool: readonly IDiscoveredEndpoint[],
  ids: readonly string[],
): IBalanceFetchTemplate {
  const candidates = buildKeyedCandidates(pool, ids);
  const match = candidates.find((t): boolean => t.url !== '');
  return match ?? findBulkTemplate(pool);
}

/**
 * Discover the balance fetch template from the captured pool.
 *
 * @param pool - All captured endpoints.
 * @param ids - accountDiscovery iter ids (used by GET-path detection).
 * @returns Template, or {@link EMPTY_BALANCE_TEMPLATE} when pool empty.
 */
function discoverBalanceFetchTemplate(
  pool: readonly IDiscoveredEndpoint[],
  ids: readonly string[],
): IBalanceFetchTemplate {
  if (pool.length === 0) return EMPTY_BALANCE_TEMPLATE;
  return tryFinderChain(pool, ids);
}

/**
 * Read network captures and discover the balance fetch template.
 * Returns the empty sentinel when mediator absent.
 *
 * @param input - Pipeline context.
 * @returns Template or EMPTY_BALANCE_TEMPLATE.
 */
function buildTemplateForScrape(input: IPipelineContext): IBalanceFetchTemplate {
  if (!input.mediator.has) return EMPTY_BALANCE_TEMPLATE;
  const pool = input.mediator.value.network.getAllEndpoints();
  const ids = input.accountDiscovery.has ? input.accountDiscovery.value.ids : [];
  return discoverBalanceFetchTemplate(pool, ids);
}

export { buildTemplateForScrape, discoverBalanceFetchTemplate, EMPTY_BALANCE_TEMPLATE };
