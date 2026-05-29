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
  let s = '';
  if (typeof val === 'string') s = val;
  if (typeof val === 'number') s = String(val);
  if (s === '') return fallback;
  if (transform) return transform(s);
  return s;
}

/**
 * Coerce a field value to number with fallback.
 * @param val - Raw field value from findFieldValue.
 * @param fallback - Fallback when val is not a number.
 * @returns Coerced number.
 */
function coerceNumber(val: ScalarFieldHit, fallback: number): number {
  if (typeof val === 'number') return val;
  if (typeof val !== 'string') return fallback;
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
