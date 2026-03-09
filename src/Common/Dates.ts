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
  let monthMoment = moment(startMoment).startOf('month');

  const allMonths: Moment[] = [];
  let lastMonth = moment().startOf('month');
  if (futureMonths && futureMonths > 0) {
    lastMonth = lastMonth.add(futureMonths, 'month');
  }
  while (monthMoment.isSameOrBefore(lastMonth)) {
    allMonths.push(monthMoment);
    monthMoment = moment(monthMoment).add(1, 'month');
  }

  return allMonths;
}
