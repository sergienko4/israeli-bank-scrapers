/**
 * Window-params detector for the `windowParamsMatch` picker tier.
 *
 * <p>Whether a captured URL exposes a COMPLETE date window — a `fromDate` alias
 * AND a `toDate` alias (from {@link PIPELINE_WELL_KNOWN_TXN_FIELDS}). Aliases are
 * matched against top-level query keys AND keys nested inside any JSON-valued
 * query param, so Max's `filterData={…"dates":{"startDate","endDate"}…}` (the
 * window embedded in a JSON blob) is recognised the same as a flat
 * `?fromDate&toDate`. A one-sided window (e.g. a summary URL exposing only
 * `retrievalStartDate`) is rejected, keeping summary endpoints out of the tier.
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS } from '../../../Registry/WK/ScrapeWK.js';
import type { Brand } from '../../../Types/Brand.js';
import safeParseWindowUrl from './SafeUrl.js';

/** Branded result of {@link hasWindowParams} (Rule #15 — no bare primitive return). */
type HasWindowParams = Brand<boolean, 'HasWindowParams'>;

const WINDOW_FROM_KEYS = new Set<string>(PIPELINE_WELL_KNOWN_TXN_FIELDS.fromDate);
const WINDOW_TO_KEYS = new Set<string>(PIPELINE_WELL_KNOWN_TXN_FIELDS.toDate);

/**
 * Narrow a parsed JSON value to a plain object, or false.
 * @param parsed - Result of {@link JSON.parse}.
 * @returns The object, or false.
 */
function asObjectOrFalse(parsed: unknown): Record<string, unknown> | false {
  const isObject = parsed !== null && typeof parsed === 'object';
  return isObject ? (parsed as Record<string, unknown>) : false;
}

/**
 * Parse a query-param value as a JSON object, or false when it is not one.
 * @param value - Raw (decoded) query-param value.
 * @returns Parsed object, or false.
 */
function tryParseJsonObject(value: string): Record<string, unknown> | false {
  if (!value.startsWith('{')) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return asObjectOrFalse(parsed);
  } catch {
    return false;
  }
}

/**
 * Prepend the key of one JSON entry to its child's own deep keys.
 * @param entry - `[key, childValue]` pair from `Object.entries`.
 * @returns The key plus every key nested under the child.
 */
function entryKeys(entry: readonly [string, unknown]): readonly string[] {
  const [key, child] = entry;
  return [key, ...collectJsonKeys(child)];
}

/**
 * Depth-first collect every object key from a parsed JSON value.
 * @param value - Parsed JSON value (object, array, or scalar).
 * @returns Flat list of nested keys ([] for non-objects).
 */
function collectJsonKeys(value: unknown): readonly string[] {
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(entryKeys);
}

/**
 * Candidate keys for one query param — its own key plus, when the value is a
 * JSON object, every key nested inside it (e.g. Max `filterData`).
 * @param entry - `[key, value]` pair from `URLSearchParams.entries`.
 * @returns The param key plus any nested JSON keys.
 */
function paramKeys(entry: readonly [string, string]): readonly string[] {
  const [key, value] = entry;
  const nested = tryParseJsonObject(value);
  return nested === false ? [key] : [key, ...collectJsonKeys(nested)];
}

/**
 * All window-alias candidate keys across every query param.
 * @param searchParams - Parsed URL search params.
 * @returns Flat list of candidate keys.
 */
function windowCandidateKeys(searchParams: URLSearchParams): readonly string[] {
  const iter = searchParams.entries();
  const entries = Array.from(iter);
  return entries.flatMap(paramKeys);
}

/**
 * True when a captured URL carries BOTH a fromDate alias AND a toDate alias —
 * flat in the query string or nested inside a JSON-valued param. Pass-through
 * on URL parse error.
 * @param url - Captured URL.
 * @returns True when a complete date window is present.
 */
export function hasWindowParams(url: string): HasWindowParams {
  const parsed = safeParseWindowUrl(url);
  if (parsed === false) return false as HasWindowParams;
  const keys = windowCandidateKeys(parsed.searchParams);
  const hasFrom = keys.some((key): boolean => WINDOW_FROM_KEYS.has(key));
  const hasTo = keys.some((key): boolean => WINDOW_TO_KEYS.has(key));
  return (hasFrom && hasTo) as HasWindowParams;
}

export default hasWindowParams;
