import moment from 'moment';
import { TransactionTypes, TransactionStatuses, type Transaction } from '../transactions';
import { fixInstallments, sortTransactionsByDate, filterOldTransactions, getRawTransaction } from './transactions';

function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    type: TransactionTypes.Normal,
    date: '2024-01-15T00:00:00.000Z',
    processedDate: '2024-01-15T00:00:00.000Z',
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    chargedCurrency: 'ILS',
    description: 'Test Transaction',
    status: TransactionStatuses.Completed,
    ...overrides,
  };
}

describe('fixInstallments', () => {
  it('does not modify normal transactions', () => {
    const txns = [createTransaction()];
    const result = fixInstallments(txns);
    expect(result[0].date).toBe('2024-01-15T00:00:00.000Z');
  });

  it('does not modify first installment', () => {
    const txns = [
      createTransaction({
        type: TransactionTypes.Installments,
        installments: { number: 1, total: 3 },
      }),
    ];
    const result = fixInstallments(txns);
    expect(result[0].date).toBe('2024-01-15T00:00:00.000Z');
  });

  it('shifts date for non-initial installments', () => {
    const txns = [
      createTransaction({
        type: TransactionTypes.Installments,
        date: '2024-01-15T00:00:00.000Z',
        installments: { number: 3, total: 6 },
      }),
    ];
    const result = fixInstallments(txns);
    const expected = moment('2024-01-15').add(2, 'month');
    expect(moment(result[0].date).isSame(expected, 'month')).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(fixInstallments([])).toEqual([]);
  });

  it('does not mutate original transaction', () => {
    const original = createTransaction({
      type: TransactionTypes.Installments,
      date: '2024-01-15T00:00:00.000Z',
      installments: { number: 2, total: 3 },
    });
    fixInstallments([original]);
    expect(original.date).toBe('2024-01-15T00:00:00.000Z');
  });
});

describe('sortTransactionsByDate', () => {
  it('sorts transactions by date ascending', () => {
    const txns = [
      createTransaction({ date: '2024-03-01T00:00:00.000Z' }),
      createTransaction({ date: '2024-01-01T00:00:00.000Z' }),
      createTransaction({ date: '2024-02-01T00:00:00.000Z' }),
    ];
    const result = sortTransactionsByDate(txns);
    expect(result[0].date).toBe('2024-01-01T00:00:00.000Z');
    expect(result[1].date).toBe('2024-02-01T00:00:00.000Z');
    expect(result[2].date).toBe('2024-03-01T00:00:00.000Z');
  });

  it('returns empty array for empty input', () => {
    expect(sortTransactionsByDate([])).toEqual([]);
  });

  it('handles single transaction', () => {
    const txns = [createTransaction()];
    const result = sortTransactionsByDate(txns);
    expect(result).toHaveLength(1);
  });
});

describe('filterOldTransactions', () => {
  const startMoment = moment('2024-02-01');

  it('filters out transactions before start date when combineInstallments is false', () => {
    const txns = [
      createTransaction({ date: '2024-01-01T00:00:00.000Z' }),
      createTransaction({ date: '2024-02-15T00:00:00.000Z' }),
      createTransaction({ date: '2024-03-01T00:00:00.000Z' }),
    ];
    const result = filterOldTransactions(txns, startMoment, false);
    expect(result).toHaveLength(2);
  });

  it('keeps transactions on the start date', () => {
    const txns = [createTransaction({ date: '2024-02-01T00:00:00.000Z' })];
    const result = filterOldTransactions(txns, startMoment, false);
    expect(result).toHaveLength(1);
  });

  it('with combineInstallments keeps normal and initial installments only', () => {
    const txns = [
      createTransaction({ date: '2024-02-15T00:00:00.000Z', type: TransactionTypes.Normal, description: 'Normal' }),
      createTransaction({
        date: '2024-02-15T00:00:00.000Z',
        type: TransactionTypes.Installments,
        installments: { number: 1, total: 3 },
        description: 'Installment 1',
      }),
      createTransaction({
        date: '2024-02-15T00:00:00.000Z',
        type: TransactionTypes.Installments,
        installments: { number: 2, total: 3 },
        description: 'Installment 2',
      }),
    ];
    const result = filterOldTransactions(txns, startMoment, true);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe(TransactionTypes.Normal);
    expect(result[1].installments?.number).toBe(1);
  });

  it('with combineInstallments still filters old normal transactions', () => {
    const txns = [
      createTransaction({ date: '2024-01-01T00:00:00.000Z', type: TransactionTypes.Normal }),
    ];
    const result = filterOldTransactions(txns, startMoment, true);
    expect(result).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(filterOldTransactions([], startMoment, false)).toEqual([]);
  });
});

describe('getRawTransaction', () => {
  it('returns cleaned data when called with one argument', () => {
    const data = { key: 'value', empty: '', nil: null };
    const result = getRawTransaction(data) as Record<string, unknown>;
    expect(result).toEqual({ key: 'value' });
  });

  it('removes undefined and empty arrays from data', () => {
    const data = { key: 'value', undef: undefined, arr: [] };
    const result = getRawTransaction(data) as Record<string, unknown>;
    expect(result).toEqual({ key: 'value' });
  });

  it('returns cleaned data when transaction has no rawTransaction', () => {
    const data = { key: 'value' };
    const result = getRawTransaction(data, {});
    expect(result).toEqual({ key: 'value' });
  });

  it('creates array when extending existing rawTransaction object', () => {
    const data = { new: 'data' };
    const transaction = { rawTransaction: { old: 'data' } };
    const result = getRawTransaction(data, transaction);
    expect(result).toEqual([{ old: 'data' }, { new: 'data' }]);
  });

  it('appends to existing rawTransaction array', () => {
    const data = { new: 'data' };
    const transaction = { rawTransaction: [{ first: '1' }] };
    const result = getRawTransaction(data, transaction);
    expect(result).toEqual([{ first: '1' }, { new: 'data' }]);
  });

  it('handles nested objects with empty values', () => {
    const data = { outer: { inner: 'value', empty: '' } };
    const result = getRawTransaction(data) as Record<string, unknown>;
    expect(result).toEqual({ outer: { inner: 'value' } });
  });

  it('handles arrays within data', () => {
    const data = { items: [{ a: 1, b: null }, { c: 2 }] };
    const result = getRawTransaction(data) as Record<string, unknown>;
    expect(result).toEqual({ items: [{ a: 1 }, { c: 2 }] });
  });

  it('returns primitive values as-is', () => {
    expect(getRawTransaction('hello')).toBe('hello');
    expect(getRawTransaction(42)).toBe(42);
  });
});
