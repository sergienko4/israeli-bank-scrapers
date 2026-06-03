/**
 * Dashboard date candidates — runtime date format generation for REVEAL probe.
 * Extracted from DashboardDiscoveryStep.ts to respect max-lines.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';

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
function getDateNumbers(now: Date): IDateNumbers {
  return { dayNum: now.getDate(), monthNum: now.getMonth() + 1, yearNum: now.getFullYear() };
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
function extractDateParts(now: Date): IDateParts {
  const nums = getDateNumbers(now);
  const day = buildDayStrings(nums.dayNum);
  const month = buildMonthStrings(nums.monthNum);
  const year = buildYearStrings(nums.yearNum);
  return { ...day, ...month, ...year };
}

/**
 * Build runtime date candidates for today in multiple formats.
 * @returns SelectorCandidate array with today's date.
 */
function buildDateCandidates(): readonly SelectorCandidate[] {
  const parts = extractDateParts(new Date());
  const sep = ['.', '/', '-'];
  const combos = sep.flatMap((s): string[] => [
    `${parts.dayPad}${s}${parts.monthPad}${s}${parts.yearShort}`,
    `${parts.dayRaw}${s}${parts.monthRaw}${s}${parts.yearShort}`,
    `${parts.dayPad}${s}${parts.monthPad}${s}${parts.yearFull}`,
  ]);
  return combos.map((fmt): SelectorCandidate => ({ kind: 'textContent', value: fmt }));
}

export default buildDateCandidates;
export { buildDateCandidates };
