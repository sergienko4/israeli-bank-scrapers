import { jest } from '@jest/globals';
import * as fc from 'fast-check';
import moment from 'moment';

import getAllMonthMoments from '../../Common/Dates.js';

// Pin time to mid-month to avoid flakiness at month boundaries
const NOW = new Date('2024-06-15T12:00:00.000Z');

describe('getAllMonthMoments', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('returns current month when start is current month', () => {
    const nowMoment = moment();
    const start = nowMoment.startOf('month');
    const result = getAllMonthMoments(start);
    expect(result).toHaveLength(1);
    const isSameMonth = result[0].isSame(start, 'month');
    expect(isSameMonth).toBe(true);
  });

  it('returns all months from start to current month', () => {
    const threeMonthsAgo = moment().subtract(3, 'months');
    const start = threeMonthsAgo.startOf('month');
    const result = getAllMonthMoments(start);
    expect(result).toHaveLength(4);
    const firstMonth = result[0].format('YYYY-MM');
    const lastMonth = result[3].format('YYYY-MM');
    expect(firstMonth).toBe('2024-03');
    expect(lastMonth).toBe('2024-06');
  });

  it('includes future months when futureMonths is specified', () => {
    const nowMoment = moment();
    const start = nowMoment.startOf('month');
    const result = getAllMonthMoments(start, 2);
    expect(result).toHaveLength(3);
    const lastMonth = result[2].format('YYYY-MM');
    expect(lastMonth).toBe('2024-08');
  });

  it('accepts string date input', () => {
    const result = getAllMonthMoments('2024-05-01');
    expect(result).toHaveLength(2);
    const firstMonth = result[0].format('YYYY-MM');
    const secondMonth = result[1].format('YYYY-MM');
    expect(firstMonth).toBe('2024-05');
    expect(secondMonth).toBe('2024-06');
  });

  it('returns empty array when start is in the future', () => {
    const twoMonthsAhead = moment().add(2, 'months');
    const start = twoMonthsAhead.startOf('month');
    const result = getAllMonthMoments(start);
    expect(result).toHaveLength(0);
  });

  it('ignores futureMonths when zero', () => {
    const nowMoment = moment();
    const start = nowMoment.startOf('month');
    const result = getAllMonthMoments(start, 0);
    expect(result).toHaveLength(1);
  });

  it('ignores futureMonths when negative', () => {
    const nowMoment = moment();
    const start = nowMoment.startOf('month');
    const result = getAllMonthMoments(start, -1);
    expect(result).toHaveLength(1);
  });

  it('always returns months in ascending order for any past start', () => {
    const intArb = fc.integer({ min: -24, max: 0 });
    const orderProperty = fc.property(intArb, monthsBack => {
      const baseMoment = moment(NOW).add(monthsBack, 'months');
      const start = baseMoment.startOf('month');
      const result = getAllMonthMoments(start);
      for (let i = 1; i < result.length; i++) {
        const isAfterPrevious = result[i].isAfter(result[i - 1]);
        expect(isAfterPrevious).toBe(true);
      }
    });
    fc.assert(orderProperty);
  });

  it('never returns months after current month for any past start', () => {
    const nowMoment = moment(NOW);
    const intArb = fc.integer({ min: -24, max: -1 });
    const boundProperty = fc.property(intArb, monthsBack => {
      const baseMoment = moment(NOW).add(monthsBack, 'months');
      const start = baseMoment.startOf('month');
      const result = getAllMonthMoments(start);
      result.forEach(m => {
        const isBeforeNow = m.isSameOrBefore(nowMoment, 'month');
        expect(isBeforeNow).toBe(true);
      });
    });
    fc.assert(boundProperty);
  });
});
