import moment, { type Moment } from 'moment';

/**
 * Generates an array of moment objects, one per calendar month from startMoment up to and
 * including the current month (or beyond it when futureMonths is specified).
 *
 * @param startMoment - the first month to include; accepts a Moment or an ISO date string
 * @param futureMonths - optional number of additional months past the current month to include
 * @returns an ordered array of moment objects, each set to the start of its month
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
