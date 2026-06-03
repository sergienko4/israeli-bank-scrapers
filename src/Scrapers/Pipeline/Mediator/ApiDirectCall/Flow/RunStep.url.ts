/**
 * URL + query-record helpers — hydrating step.queryTemplate,
 * resolving the WK url, and producing the canonical pathAndQuery.
 */

import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import { resolveWkUrl } from '../../../Registry/WK/UrlsWK.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../../Types/Procedure.js';
import { hydrate } from '../Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../Template/RefResolver.js';
import type {
  IParsedUrlParts,
  IPathAndQuery,
  IRunStepArgs,
  IStepConfig,
  JsonValue,
  QueryRecord,
} from './RunStep.types.js';

/**
 * Coerce a scalar into its string form or false when not scalar.
 * @param v - JsonValue to coerce.
 * @returns String form or false when unsupported.
 */
function scalarToString(v: JsonValue): string | false {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  return false;
}

/**
 * Convert the validated hydrated-query entries into a string-string record.
 * @param entries - Object entries from the hydrated query template.
 * @returns Procedure with the flat string-string map, or fail.
 */
function buildQueryFromEntries(entries: readonly [string, JsonValue][]): Procedure<QueryRecord> {
  const bad = entries.find(([, v]): boolean => scalarToString(v) === false);
  if (bad !== undefined) {
    return fail(ScraperErrorTypes.Generic, `queryTemplate[${bad[0]}] must be a scalar`);
  }
  const pairs = entries.map(([k, v]): [string, string] => [k, scalarToString(v) as string]);
  const out: Record<string, string> = Object.fromEntries(pairs);
  return succeed(out);
}

/**
 * Stringify a hydrated query record.
 * @param hydrated - JsonValue produced by hydrating step.queryTemplate.
 * @returns Procedure with a flat string-string map.
 */
function coerceQueryRecord(hydrated: JsonValue): Procedure<QueryRecord> {
  if (hydrated === null || typeof hydrated !== 'object' || Array.isArray(hydrated)) {
    return fail(ScraperErrorTypes.Generic, 'step.queryTemplate did not hydrate to an object');
  }
  const entries = Object.entries(hydrated);
  return buildQueryFromEntries(entries);
}

/**
 * Build the outbound URL query record by hydrating step.queryTemplate.
 * @param step - Step config.
 * @param scope - Template scope.
 * @returns Procedure with the query record (empty when absent).
 */
function buildQueryRecord(step: IStepConfig, scope: ITemplateScope): Procedure<QueryRecord> {
  if (step.queryTemplate === undefined) return succeed({});
  const hydrated = hydrate(step.queryTemplate, scope);
  if (!isOk(hydrated)) return hydrated;
  return coerceQueryRecord(hydrated.value);
}

/**
 * Parse a URL or return false when malformed.
 * @param resolvedUrl - Full URL string.
 * @returns Parsed parts or false on failure.
 */
function parseUrlOrFalse(resolvedUrl: string): IParsedUrlParts | false {
  try {
    const parsed = new URL(resolvedUrl);
    return { pathname: parsed.pathname, search: parsed.search };
  } catch {
    return false;
  }
}

/**
 * Encode and join query record pairs for URL appending.
 * @param extra - Extra query record.
 * @param keys - Keys to encode (in iteration order).
 * @returns `k1=v1&k2=v2` string.
 */
function encodeQueryPairs(extra: QueryRecord, keys: readonly string[]): string {
  const pairs = keys.map(key => `${encodeURIComponent(key)}=${encodeURIComponent(extra[key])}`);
  return pairs.join('&');
}

/**
 * Merge an existing URL's query string with an additional record.
 * @param resolvedUrl - Full URL resolved from WK.
 * @param extra - Additional query pairs.
 * @returns Path + final query string.
 */
function buildPathAndQuery(resolvedUrl: string, extra: QueryRecord): string {
  const parsed = parseUrlOrFalse(resolvedUrl);
  if (parsed === false) return resolvedUrl;
  const keys = Object.keys(extra);
  if (keys.length === 0) return `${parsed.pathname}${parsed.search}`;
  const joined = encodeQueryPairs(extra, keys);
  if (parsed.search.length === 0) return `${parsed.pathname}?${joined}`;
  return `${parsed.pathname}${parsed.search}&${joined}`;
}

/**
 * Resolve the URL + query string for the step's WK url tag.
 * @param args - Run-step args (step + scope + companyId).
 * @returns Procedure with the path-and-query bundle, or fail.
 */
function resolvePathAndQuery(args: IRunStepArgs): Procedure<IPathAndQuery> {
  const queryProc = buildQueryRecord(args.step, args.scope);
  if (!isOk(queryProc)) return queryProc;
  const urlProc = resolveWkUrl(args.step.urlTag, args.companyId);
  if (!isOk(urlProc)) return urlProc;
  const pathAndQuery = buildPathAndQuery(urlProc.value, queryProc.value);
  return succeed({ pathAndQuery, query: queryProc.value });
}

export default resolvePathAndQuery;

export { resolvePathAndQuery };
