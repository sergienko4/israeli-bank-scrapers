/**
 * Unit tests for Strategy/Scrape/Monthly/MonthGeneration — month array builder.
 */

import moment from 'moment';

import getAllMonthMoments from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Monthly/MonthGeneration.js';

describe('getAllMonthMoments', () => {
  it('returns 1 month when start == current month', () => {
    const start = moment().startOf('month');
    const months = getAllMonthMoments(start);
    expect(months.length).toBeGreaterThanOrEqual(1);
  });

  it('returns N+1 months across N months span', () => {
    const start = moment().subtract(2, 'months').startOf('month');
    const months = getAllMonthMoments(start);
    expect(months.length).toBe(3);
  });

  it('accepts string start input', () => {
    const formatResult1 = moment().subtract(1, 'month').format('YYYY-MM-DD');
    const months = getAllMonthMoments(formatResult1);
    expect(months.length).toBeGreaterThanOrEqual(1);
  });

  it('adds future months when requested', () => {
    const start = moment().startOf('month');
    const months = getAllMonthMoments(start, 2);
    expect(months.length).toBe(3);
  });

  it('returns empty array when start is in the future', () => {
    const start = moment().add(5, 'months').startOf('month');
    const months = getAllMonthMoments(start);
    expect(months.length).toBe(0);
  });
});
