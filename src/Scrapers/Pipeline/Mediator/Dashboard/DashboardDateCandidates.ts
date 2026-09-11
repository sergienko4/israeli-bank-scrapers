/**
 * Dashboard date candidates — runtime date format generation for REVEAL probe.
 * Extracted from DashboardDiscoveryStep.ts to respect max-lines.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';
import { getDebug } from '../../Logging/Debug.js';
import { bankDatePartsOfInstant } from '../Scrape/BankMonth.js';

const LOG = getDebug(import.meta.url);

/** Bundled date parts for format generation. */
interface IDateParts {
  readonly dayPad: string;
  readonly dayRaw: string;
  readonly monthPad: string;
  readonly monthRaw: string;
  readonly yearShort: string;
  readonly yearFull: string;
}

/** Numeric date components, pre-extraction. */
interface IDateNumbers {
  readonly dayNum: number;
  readonly monthNum: number;
  readonly yearNum: number;
}

/**
 * Pull day/month/year numeric components from a Date.
 * @param now - Date to extract from.
 * @returns Numeric parts.
 */
function getDateNumbers(now: Date): IDateNumbers | false {
  const parts = bankDatePartsOfInstant(now);
  if (parts === false) return false;
  return { dayNum: parts.day, monthNum: parts.month, yearNum: parts.year };
}

/**
 * Build day-shaped strings (padded + raw).
 * @param dayNum - Day-of-month integer.
 * @returns Padded + raw day strings.
 */
function buildDayStrings(dayNum: number): { dayPad: string; dayRaw: string } {
  return { dayPad: String(dayNum).padStart(2, '0'), dayRaw: String(dayNum) };
}

/**
 * Build month-shaped strings (padded + raw).
 * @param monthNum - 1-based month integer.
 * @returns Padded + raw month strings.
 */
function buildMonthStrings(monthNum: number): { monthPad: string; monthRaw: string } {
  return { monthPad: String(monthNum).padStart(2, '0'), monthRaw: String(monthNum) };
}

/**
 * Build year-shaped strings (4-digit + 2-digit).
 * @param yearNum - Full 4-digit year integer.
 * @returns Short + full year strings.
 */
function buildYearStrings(yearNum: number): { yearShort: string; yearFull: string } {
  return { yearShort: String(yearNum).slice(2), yearFull: String(yearNum) };
}

/**
 * Extract formatted date parts from a Date.
 * @param now - Date to extract from.
 * @returns Padded and raw day/month/year strings.
 */
function extractDateParts(now: Date): IDateParts | false {
  const nums = getDateNumbers(now);
  if (nums === false) return false;
  const day = buildDayStrings(nums.dayNum);
  const month = buildMonthStrings(nums.monthNum);
  const year = buildYearStrings(nums.yearNum);
  return { ...day, ...month, ...year };
}

/**
 * Build raw candidate values from projected bank-date parts.
 * @param parts - Formatted bank-date parts.
 * @returns Candidate text values.
 */
function buildCandidateValues(parts: IDateParts): readonly string[] {
  const sep = ['.', '/', '-'];
  return sep.flatMap((s): string[] => [
    `${parts.dayPad}${s}${parts.monthPad}${s}${parts.yearShort}`,
    `${parts.dayRaw}${s}${parts.monthRaw}${s}${parts.yearShort}`,
    `${parts.dayPad}${s}${parts.monthPad}${s}${parts.yearFull}`,
  ]);
}

/**
 * Build runtime date candidates for today in multiple formats.
 * @returns SelectorCandidate array with today's date.
 */
function buildDateCandidates(): readonly SelectorCandidate[] {
  const now = new Date();
  const parts = extractDateParts(now);
  if (parts === false) {
    LOG.warn({ message: 'Dashboard date candidates skipped for an invalid clock' });
    return [];
  }
  const combos = buildCandidateValues(parts);
  return combos.map((fmt): SelectorCandidate => ({ kind: 'textContent', value: fmt }));
}

export default buildDateCandidates;
export { buildDateCandidates };
