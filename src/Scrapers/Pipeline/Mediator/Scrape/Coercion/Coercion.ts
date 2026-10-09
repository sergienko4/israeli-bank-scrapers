/**
 * Coercion helpers — convert raw BFS field hits into typed
 * scalars consumable by the AutoMapper pipeline.
 *
 * Extracted from ScrapeAutoMapper as part of the Phase 5
 * pipeline-decoupling split (master plan
 * pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import { KNOWN_DATE_FORMATS } from '../../../Registry/WK/ScrapeWK.js';
import type { ScalarFieldHit } from '../AutoMapperFacade/AutoMapperTypes.js';
import { parseInBankZone } from '../BankCalendar.js';

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
 * Earliest calendar year a provider date can genuinely carry. An earlier year
 * is a "not set" placeholder: .NET providers send `DateTime.MinValue`
 * (`0001-01-01T00:00:00`) for an empty date, e.g. Mizrahi's value date
 * `MC02ErehTaaEZ` on a movement that has none.
 */
const MIN_PLAUSIBLE_YEAR = 1900;

/**
 * The identity transform — keeps a raw string as it is.
 * @param s - Raw string.
 * @returns The same string.
 */
function keepAsIs(s: string): string {
  return s;
}

/**
 * Coerce a field value to string, applying optional transform.
 * Numeric inputs are stringified so numeric YYYYMMDD dates survive.
 * @param val - Raw field value from findFieldValue.
 * @param transform - Optional string transform (e.g., parseAutoDate); an
 *   empty result means the transform rejected the value.
 * @param fallback - Fallback when val is missing or rejected by the transform.
 * @returns Coerced string.
 */
function coerceString(
  val: ScalarFieldHit,
  transform: (s: string) => string = keepAsIs,
  fallback = '',
): string {
  if (val === false) return fallback;
  const s = pickRawString(val);
  const out = s === '' ? '' : transform(s);
  return out === '' ? fallback : out;
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
 *
 * Resolved in the bank's calendar rather than the ambient zone: most Israeli
 * providers state a *day* with no time and no offset, so the instant we emit is
 * a choice, and leaving that choice to the host — or to whatever
 * `moment.tz.setDefault` a Legacy scraper set earlier in the process — made the
 * same row produce different public values on different machines and in
 * different scrape orders. See {@link parseInBankZone} and issue #545.
 *
 * A placeholder date (year before {@link MIN_PLAUSIBLE_YEAR}) parses to empty,
 * so a processed date falls back to the transaction date and a row dated only
 * by a placeholder can neither be mapped nor certify window coverage.
 *
 * @param dateStr - Raw date string from API response.
 * @returns ISO date string, empty for a placeholder, or original if no match.
 */
function parseAutoDate(dateStr: string): string {
  const parsed = parseInBankZone(dateStr, KNOWN_DATE_FORMATS, true);
  if (!parsed.isValid()) return dateStr;
  if (parsed.year() < MIN_PLAUSIBLE_YEAR) return '';
  return parsed.toISOString();
}

export { coerceNumber, coerceString, parseAutoDate };
