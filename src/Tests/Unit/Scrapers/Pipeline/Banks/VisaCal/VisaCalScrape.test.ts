/**
 * Unit tests for VisaCalScrape — buildMonths date range logic.
 * Pure function tests — no browser, no network.
 */

import moment from 'moment';

import { buildMonths } from '../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalScrape.js';

describe('buildMonths', () => {
  it.each([
    {
      label: 'mid-month start includes that month',
      start: '2026-03-15',
      futureMonths: 0,
      expectFirst: '2026-03-01',
    },
    {
      label: '1st-of-month start includes that month',
      start: '2026-03-01',
      futureMonths: 0,
      expectFirst: '2026-03-01',
    },
    {
      label: 'last day of month includes that month',
      start: '2026-01-31',
      futureMonths: 0,
      expectFirst: '2026-01-01',
    },
  ] as const)(
    /**
     * Verify first month is always included regardless of day.
     * @param label - Test case description.
     * @param start - ISO date string for start date.
     * @param futureMonths - Extra months ahead.
     * @param expectFirst - Expected first month (start of month ISO).
     */
    '$label',
    ({ start, futureMonths, expectFirst }) => {
      const startMoment = moment(start);
      const result = buildMonths(startMoment, futureMonths);
      const firstFormatted = result[0].format('YYYY-MM-DD');
      expect(firstFormatted).toBe(expectFirst);
    },
  );

  it('returns at least 1 month when start is current month', () => {
    const start = moment().startOf('month');
    const result = buildMonths(start, 0);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('includes future months when requested', () => {
    const start = moment().startOf('month');
    const result = buildMonths(start, 2);
    const lastMonth = result.at(-1);
    const expectedMonth = moment().add(2, 'month').startOf('month');
    const expectedStr = expectedMonth.format('YYYY-MM');
    expect(lastMonth?.format('YYYY-MM')).toBe(expectedStr);
  });

  it('iterates forward from start to end', () => {
    const start = moment('2026-01-15');
    const result = buildMonths(start, 0);
    const months = result.map(m => m.format('YYYY-MM'));
    const now = moment().format('YYYY-MM');
    expect(months[0]).toBe('2026-01');
    expect(months).toContain(now);
    /** Verify ascending order. */
    for (let i = 1; i < months.length; i++) {
      expect(months[i] > months[i - 1]).toBe(true);
    }
  });
});
