/**
 * Coercion helpers — convert raw BFS field hits into typed
 * scalars consumable by the AutoMapper pipeline.
 *
 * Extracted from ScrapeAutoMapper as part of the Phase 5
 * pipeline-decoupling split (master plan
 * pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import moment from 'moment';

import { KNOWN_DATE_FORMATS } from '../../../Registry/WK/ScrapeWK.js';
import type { ScalarFieldHit } from '../AutoMapperFacade/AutoMapperTypes.js';

/**
 * Pick the raw string from a {@link ScalarFieldHit}, stringifying numbers.
 * @param val - Raw field value.
 * @returns Empty string when not stringifiable.
 */
function pickRawString(val: ScalarFieldHit): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return '';
}

/**
 * Coerce a field value to string, applying optional transform.
 * Numeric inputs are stringified so numeric YYYYMMDD dates survive.
 * @param val - Raw field value from findFieldValue.
 * @param transform - Optional string transform (e.g., parseAutoDate).
 * @param fallback - Fallback when val is missing.
 * @returns Coerced string.
 */
function coerceString(
  val: ScalarFieldHit,
  transform?: (s: string) => string,
  fallback = '',
): string {
  if (val === false) return fallback;
  const s = pickRawString(val);
  if (s === '') return fallback;
  return transform ? transform(s) : s;
}

/**
 * Coerce a field value to number with fallback.
 *
 * Treats empty strings and whitespace-only strings as invalid —
 * `Number('')` returns 0, which would silently record a missing
 * amount field as a zero-value transaction. Per CodeRabbit PR #277
 * review, explicit `.trim() === ''` guard returns the fallback
 * before parsing.
 * @param val - Raw field value from findFieldValue.
 * @param fallback - Fallback when val is not a parseable number.
 * @returns Coerced number.
 */
function coerceNumber(val: ScalarFieldHit, fallback: number): number {
  if (typeof val === 'number') return val;
  if (typeof val !== 'string') return fallback;
  if (val.trim() === '') return fallback;
  const parsed = Number(val);
  if (Number.isNaN(parsed)) return fallback;
  return parsed;
}

/**
 * Parse a date string using known bank formats.
 * @param dateStr - Raw date string from API response.
 * @returns ISO date string, or original if no match.
 */
function parseAutoDate(dateStr: string): string {
  const parsed = moment(dateStr, KNOWN_DATE_FORMATS, true);
  if (parsed.isValid()) return parsed.toISOString();
  return dateStr;
}

export { coerceNumber, coerceString, parseAutoDate };
