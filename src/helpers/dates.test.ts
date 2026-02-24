import moment from 'moment';
import getAllMonthMoments from './dates';

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
    const start = moment().startOf('month');
    const result = getAllMonthMoments(start);
    expect(result).toHaveLength(1);
    expect(result[0].isSame(start, 'month')).toBe(true);
  });

  it('returns all months from start to current month', () => {
    const start = moment().subtract(3, 'months').startOf('month');
    const result = getAllMonthMoments(start);
    expect(result).toHaveLength(4);
    expect(result[0].format('YYYY-MM')).toBe('2024-03');
    expect(result[3].format('YYYY-MM')).toBe('2024-06');
  });

  it('includes future months when futureMonths is specified', () => {
    const start = moment().startOf('month');
    const result = getAllMonthMoments(start, 2);
    expect(result).toHaveLength(3);
    expect(result[2].format('YYYY-MM')).toBe('2024-08');
  });

  it('accepts string date input', () => {
    const result = getAllMonthMoments('2024-05-01');
    expect(result).toHaveLength(2);
    expect(result[0].format('YYYY-MM')).toBe('2024-05');
    expect(result[1].format('YYYY-MM')).toBe('2024-06');
  });

  it('returns empty array when start is in the future', () => {
    const start = moment().add(2, 'months').startOf('month');
    const result = getAllMonthMoments(start);
    expect(result).toHaveLength(0);
  });

  it('ignores futureMonths when zero', () => {
    const start = moment().startOf('month');
    const result = getAllMonthMoments(start, 0);
    expect(result).toHaveLength(1);
  });

  it('ignores futureMonths when negative', () => {
    const start = moment().startOf('month');
    const result = getAllMonthMoments(start, -1);
    expect(result).toHaveLength(1);
  });
});
