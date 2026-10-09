/**
 * Per-bank E2E window override — a `<BANK>_E2E_DAYS_BACK` variable picks the
 * scrape start in whole days back from now, so a real run can prove a window
 * other than the 180-day default without editing the suite.
 *
 * <p>The value is checked while the scraper options are built, before any
 * login: anything but a whole number from 1 to the bank's history limit
 * throws, so a typo costs zero login attempts instead of a run against an
 * unintended window. Absent or empty, the shared {@link defaultStartDate}
 * applies.
 */

import ScraperError from '../../Scrapers/Base/ScraperError.js';
import { daysBackStartDate, defaultStartDate } from './Helpers.js';

/** A whole, unsigned number of days — no sign, fraction, unit or spaces. */
const WHOLE_DAYS = /^\d+$/;

/** Where a bank's override lives and how far back the bank serves. */
export interface IDaysBackOverride {
  /** Environment variable holding the override, e.g. `MIZRAHI_E2E_DAYS_BACK`. */
  readonly envName: string;
  /** Days of history the bank serves — the largest accepted override. */
  readonly maxDays: number;
}

/** Environment the override is read from. */
type Env = Readonly<Record<string, string | undefined>>;

/**
 * Parse an override value, refusing anything outside 1..maxDays.
 * @param raw - The variable's value.
 * @param override - The bank's variable and history limit.
 * @returns Whole days back.
 */
function parseDaysBack(raw: string, override: IDaysBackOverride): number {
  const days = WHOLE_DAYS.test(raw) ? Number(raw) : 0;
  if (days >= 1 && days <= override.maxDays) return days;
  const range = `from 1 to ${String(override.maxDays)}`;
  throw new ScraperError(`${override.envName} must be a whole number of days ${range}`);
}

/**
 * The happy-path start date, moved by the bank's days-back override.
 * @param override - The bank's variable and history limit.
 * @param env - Environment to read (default: `process.env`).
 * @returns The overridden start, or {@link defaultStartDate} when unset.
 */
export function overridableStartDate(override: IDaysBackOverride, env: Env = process.env): Date {
  const raw = env[override.envName] ?? '';
  if (raw === '') return defaultStartDate();
  const days = parseDaysBack(raw, override);
  return daysBackStartDate(days);
}
