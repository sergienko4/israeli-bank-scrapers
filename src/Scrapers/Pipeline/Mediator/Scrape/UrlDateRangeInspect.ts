/**
 * Inspection helpers for captured URLs carrying WK date-range params.
 *
 * <p>Split from {@link ./UrlDateRange.js} to keep that file within its
 * 150-line cap. Re-uses the same WK alias set + safe-parse seam so
 * inspection and patching agree on which params are "the" date range.
 *
 * <p>Used by SCRAPE strategies to distinguish endpoints whose captured
 * response represents only the SPA's chosen window (e.g. Hapoalim's
 * dashboard preview) from full-range endpoints — when the captured
 * window doesn't cover the user's `options.startDate`, the
 * DASHBOARD-side harvest is NOT reusable and SCRAPE must re-fetch.
 */

import moment from 'moment';

import {
  FROM_KEYS,
  ISO_DATE_PATTERN,
  safeParseUrl,
  urlAlreadyHasWkRange,
  YMD_PATTERN,
} from './UrlDateRange.js';

/**
 * Parse a WK date param value (YYYYMMDD or ISO `YYYY-MM-DD…`).
 * Returns false when the raw value matches neither shape or is invalid.
 * @param raw - Raw WK date param value extracted from a captured URL.
 * @returns Parsed Date or false.
 */
function parseWkDateValue(raw: string): Date | false {
  if (YMD_PATTERN.test(raw)) {
    const parsed = moment(raw, 'YYYYMMDD', true);
    return parsed.isValid() ? parsed.toDate() : false;
  }
  if (!ISO_DATE_PATTERN.test(raw)) return false;
  const iso = moment(raw);
  return iso.isValid() ? iso.toDate() : false;
}

/**
 * Result of inspecting whether a captured URL carries WK date-range
 * params. Object-typed return satisfies Rule #15 (no exported primitive
 * returns at Pipeline boundaries) while still exposing a single bool.
 */
export interface IUrlWkProbe {
  readonly hasWkDateRange: boolean;
}

/**
 * Probe a captured URL for WK fromDate + toDate aliases. Generic — no
 * bank-specific knowledge. Returns `{ hasWkDateRange: false }` on
 * malformed URL.
 *
 * @param input - Captured URL.
 * @returns Probe result; `hasWkDateRange` true only when URL carries both WK fromDate + toDate aliases.
 */
export function urlHasWkDateRange(input: string): IUrlWkProbe {
  const parsed = safeParseUrl(input);
  if (parsed === false) return { hasWkDateRange: false };
  return { hasWkDateRange: urlAlreadyHasWkRange(parsed.searchParams) };
}

/**
 * Read the first WK fromDate param value from a captured URL as a Date.
 * Returns false when URL is malformed, no WK fromDate alias is present,
 * or the captured value can't be parsed as YYYYMMDD or ISO.
 *
 * @param input - Captured URL.
 * @returns Captured fromDate as Date, or false.
 */
export function readCapturedFromDate(input: string): Date | false {
  const parsed = safeParseUrl(input);
  if (parsed === false) return false;
  const paramKeys = parsed.searchParams.keys();
  const keys = Array.from(paramKeys);
  const fromKey = keys.find((k): boolean => FROM_KEYS.has(k));
  if (fromKey === undefined) return false;
  const raw = parsed.searchParams.get(fromKey);
  return raw === null ? false : parseWkDateValue(raw);
}
