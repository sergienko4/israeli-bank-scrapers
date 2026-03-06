import * as fc from 'fast-check';
import moment from 'moment';

import {
  filterOldTransactions,
  fixInstallments,
  getRawTransaction,
  sortTransactionsByDate,
} from '../../Common/Transactions';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions';

/**
 * Creates a mock Transaction for transaction utility unit tests.
 *
 * @param overrides - optional field overrides for the mock transaction
 * @returns a Transaction object with sensible defaults
 */
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
    const resultMoment = moment(result[0].date);
    const isSameMonth = resultMoment.isSame(expected, 'month');
    expect(isSameMonth).toBe(true);
  });

  it('returns empty array for empty input', () => {
    const emptyResult = fixInstallments([]);
    expect(emptyResult).toEqual([]);
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
    const sortedEmpty = sortTransactionsByDate([]);
    expect(sortedEmpty).toEqual([]);
  });

  it('handles single transaction', () => {
    const txns = [createTransaction()];
    const result = sortTransactionsByDate(txns);
    expect(result).toHaveLength(1);
  });
});

describe('filterOldTransactions', () => {
  const startMoment = moment('2024-02-01');

  it('filters out transactions before start date when shouldCombineInstallments is false', () => {
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

  it('with shouldCombineInstallments keeps normal and initial installments only', () => {
    const txns = [
      createTransaction({
        date: '2024-02-15T00:00:00.000Z',
        type: TransactionTypes.Normal,
        description: 'Normal',
      }),
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

  it('with shouldCombineInstallments still filters old normal transactions', () => {
    const txns = [
      createTransaction({ date: '2024-01-01T00:00:00.000Z', type: TransactionTypes.Normal }),
    ];
    const result = filterOldTransactions(txns, startMoment, true);
    expect(result).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    const filteredEmpty = filterOldTransactions([], startMoment, false);
    expect(filteredEmpty).toEqual([]);
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
    const strResult = getRawTransaction('hello');
    const numResult = getRawTransaction(42);
    expect(strResult).toBe('hello');
    expect(numResult).toBe(42);
  });
});

describe('property-based invariants', () => {
  const minMs = new Date('2020-01-01').getTime();
  const maxMs = new Date('2026-12-31').getTime();
  const txnArb = fc
    .integer({ min: minMs, max: maxMs })
    .map(ms => createTransaction({ date: new Date(ms).toISOString() }));

  it('sortTransactionsByDate always produces ascending order', () => {
    const arrArb1 = fc.array(txnArb, { minLength: 2, maxLength: 20 });
    const property1 = fc.property(arrArb1, txns => {
      const sorted = sortTransactionsByDate(txns);
      for (let i = 1; i < sorted.length; i++) {
        const curMs = new Date(sorted[i].date).getTime();
        const prevMs = new Date(sorted[i - 1].date).getTime();
        expect(curMs).toBeGreaterThanOrEqual(prevMs);
      }
    });
    fc.assert(property1);
  });

  it('filterOldTransactions never returns transactions before start date', () => {
    const startDate = new Date('2023-06-01');
    const startMoment = moment(startDate);
    const arrArb2 = fc.array(txnArb, { minLength: 1, maxLength: 20 });
    const property2 = fc.property(arrArb2, txns => {
      const result = filterOldTransactions(txns, startMoment, false);
      result.forEach(t => {
        const dateMoment = moment(t.date);
        const isAfterStart = dateMoment.isSameOrAfter(startMoment, 'day');
        expect(isAfterStart).toBe(true);
      });
    });
    fc.assert(property2);
  });
});
