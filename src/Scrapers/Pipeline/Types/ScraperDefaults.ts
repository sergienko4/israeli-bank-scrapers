/**
 * Single source of truth for pipeline scraper option defaults.
 * Null-aware resolution — explicit 0 is honored, undefined/null falls back.
 */

import type { ScraperOptions } from '../../Base/Interface.js';

/** Future-month count for the scrape window. */
type FutureMonthCount = number;

/** Default includes current billing cycle + next open cycle. */
export const DEFAULT_FUTURE_MONTHS: FutureMonthCount = 1;

/**
 * Resolve futureMonthsToScrape with null-aware fallback.
 * Explicit 0 is respected; undefined/null falls back to DEFAULT_FUTURE_MONTHS.
 * @param options - Scraper options.
 * @returns Number of future months to include in the scrape window.
 */
export function getFutureMonths(options: ScraperOptions): FutureMonthCount {
  return options.futureMonthsToScrape ?? DEFAULT_FUTURE_MONTHS;
}
