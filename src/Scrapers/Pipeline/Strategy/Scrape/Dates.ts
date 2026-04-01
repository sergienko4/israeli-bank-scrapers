import moment, { type Moment } from 'moment';

/**
 * Generate an array of month-start Moment objects from startMoment to current month.
 * @param startMoment - The starting date (inclusive).
 * @param futureMonths - Optional number of future months to include.
 * @returns An array of Moment objects at the start of each month.
 */
export default function getAllMonthMoments(
  startMoment: Moment | string,
  futureMonths?: number,
): Moment[] {
  const first = moment(startMoment).startOf('month');
  const last = computeLastMonth(futureMonths);
  const totalMonths = last.diff(first, 'months') + 1;
  const count = Math.max(0, totalMonths);
  return Array.from({ length: count }, (_, i): Moment => moment(first).add(i, 'month'));
}

/**
 * Compute the last month boundary for the date range.
 * @param futureMonths - Optional number of future months to include.
 * @returns Moment at the start of the final month.
 */
function computeLastMonth(futureMonths?: number): Moment {
  const base = moment().startOf('month');
  if (futureMonths && futureMonths > 0) return base.add(futureMonths, 'month');
  return base;
}
