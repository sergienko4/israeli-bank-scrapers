/**
 * Dashboard date candidates — runtime date format generation for REVEAL probe.
 * Extracted from DashboardDiscoveryStep.ts to respect max-lines.
 */

import type { SelectorCandidate } from '../../../Base/Config/LoginConfig.js';

/** Zero-padded or raw date component string. */
type DatePartStr = string;

/** Bundled date parts for format generation. */
interface IDateParts {
  readonly dayPad: DatePartStr;
  readonly dayRaw: DatePartStr;
  readonly monthPad: DatePartStr;
  readonly monthRaw: DatePartStr;
  readonly yearShort: DatePartStr;
  readonly yearFull: DatePartStr;
}

/**
 * Extract formatted date parts from a Date.
 * @param now - Date to extract from.
 * @returns Padded and raw day/month/year strings.
 */
function extractDateParts(now: Date): IDateParts {
  const dayNum = now.getDate();
  const monthNum = now.getMonth() + 1;
  const yearNum = now.getFullYear();
  return {
    dayPad: String(dayNum).padStart(2, '0'),
    dayRaw: String(dayNum),
    monthPad: String(monthNum).padStart(2, '0'),
    monthRaw: String(monthNum),
    yearShort: String(yearNum).slice(2),
    yearFull: String(yearNum),
  };
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
