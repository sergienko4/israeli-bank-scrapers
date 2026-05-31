/**
 * Detect and decode Base64-encoded paging-context fields within
 * captured POST bodies; also detect whether a body is range-iterable
 * (either directly via from/to WK fields, or via decoded paging context).
 */

import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../Registry/WK/ScrapeWK.js';
import type { JsonRecord } from './JsonTypes.js';

/** Known paging context field names (case-insensitive). */
const PAGING_CONTEXT_KEYS = [
  'pagingcontext',
  'pagingContext',
  'pageContext',
  'pagecontext',
] as const;

/** Result of a paging-context lookup. */
interface IPagingContextHit {
  readonly key: string;
  readonly decoded: JsonRecord;
}

/**
 * Try decoding a Base64-encoded JSON string.
 * @param encoded - Potential Base64 string.
 * @returns Parsed object or false.
 */
function tryDecodeBase64(encoded: string): JsonRecord | false {
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    return JSON.parse(decoded) as JsonRecord;
  } catch {
    return false;
  }
}

/**
 * Re-encode a JSON object to Base64.
 * @param obj - Object to encode.
 * @returns Base64-encoded string.
 */
function encodeToBase64(obj: JsonRecord): string {
  const jsonStr = JSON.stringify(obj);
  return Buffer.from(jsonStr, 'utf-8').toString('base64');
}

/**
 * Check if a single body key is a paging context with Base64 JSON.
 * @param body - Parsed POST body.
 * @param bk - Body key to check.
 * @returns Decoded context or false.
 */
function tryDecodePagingKey(body: JsonRecord, bk: string): IPagingContextHit | false {
  const lowerBk = bk.toLowerCase();
  const isKnown = PAGING_CONTEXT_KEYS.some((pk): boolean => pk.toLowerCase() === lowerBk);
  if (!isKnown) return false;
  const val = body[bk];
  if (typeof val !== 'string') return false;
  const decoded = tryDecodeBase64(val);
  if (!decoded) return false;
  return { key: bk, decoded };
}

/**
 * Find a paging context field in the body.
 * @param body - Parsed POST body.
 * @returns Key name and decoded content, or false.
 */
function findPagingContext(body: JsonRecord): IPagingContextHit | false {
  const keys = Object.keys(body);
  const hits = keys.map((bk): IPagingContextHit | false => tryDecodePagingKey(body, bk));
  const firstHit = hits.find((h): h is IPagingContextHit => h !== false);
  return firstHit ?? false;
}

/**
 * Check if date range fields exist directly in body.
 * @param body - Parsed POST body.
 * @returns True if from+to WK fields are present.
 */
function hasDateRangeFields(body: JsonRecord): boolean {
  const lowerBodyKeySet = new Set(Object.keys(body).map((k): string => k.toLowerCase()));
  const lowerFrom = WK.fromDate.map((f): string => f.toLowerCase());
  const lowerTo = WK.toDate.map((f): string => f.toLowerCase());
  const hasFrom = lowerFrom.some((lf): boolean => lowerBodyKeySet.has(lf));
  const hasTo = lowerTo.some((lf): boolean => lowerBodyKeySet.has(lf));
  return hasFrom && hasTo;
}

/**
 * Check if a POST body has date range fields.
 * Searches direct body + Base64-encoded paging context.
 * @param body - Parsed POST body.
 * @returns True if both from and to WK fields are present.
 */
function isRangeIterable(body: JsonRecord): boolean {
  if (hasDateRangeFields(body)) return true;
  const ctx = findPagingContext(body);
  if (!ctx) return false;
  return hasDateRangeFields(ctx.decoded);
}

export type { IPagingContextHit };
export { encodeToBase64, findPagingContext, isRangeIterable };
