/**
 * Branch coverage tests for Common/Transactions.ts.
 * Targets: fixInstallments (non-initial installment date adjustment),
 * filterOldTransactions (shouldCombineInstallments true/false, initial installment),
 * getRawTransaction (no current, array current, object current),
 * removeEmptyValues (array, nested object, empty values).
 */
import moment from 'moment';

import {
  filterOldTransactions,
  fixInstallments,
  getRawTransaction,
  sortTransactionsByDate,
} from '../../Common/Transactions.js';
import { type ITransaction, TransactionStatuses, TransactionTypes } from '../../Transactions.js';

/**
 * Build a test transaction with defaults.
 * @param overrides - partial fields.
 * @returns complete ITransaction.
 */
function makeTxn(overrides: Partial<ITransaction> = {}): ITransaction {
  return {
    type: TransactionTypes.Normal,
    date: '2025-06-15T00:00:00.000Z',
    processedDate: '2025-06-15T00:00:00.000Z',
    originalAmount: -100,
    originalCurrency: 'ILS',
    chargedAmount: -100,
    description: 'Test',
    memo: '',
    status: TransactionStatuses.Completed,
    ...overrides,
  };
}

describe('fixInstallments', () => {
  it('does not modify normal transactions', () => {
    const txns = [makeTxn()];
    const result = fixInstallments(txns);
    expect(result[0].date).toBe(txns[0].date);
  });

  it('does not modify first installment (number=1)', () => {
    const txn = makeTxn({
      type: TransactionTypes.Installments,
      installments: { number: 1, total: 3 },
    });
    const result = fixInstallments([txn]);
    expect(result[0].date).toBe(txn.date);
  });

  it('adds months for non-initial installment (number=3)', () => {
    const txn = makeTxn({
      type: TransactionTypes.Installments,
      installments: { number: 3, total: 5 },
      date: '2025-01-15T00:00:00.000Z',
    });
    const result = fixInstallments([txn]);
    const resultDate = moment(result[0].date);
    const originalDate = moment('2025-01-15T00:00:00.000Z');
    const diffMonths = resultDate.diff(originalDate, 'months');
    expect(diffMonths).toBe(2);
  });

  it('leaves installment without installments field unchanged', () => {
    const txn = makeTxn({ type: TransactionTypes.Installments });
    const result = fixInstallments([txn]);
    expect(result[0].date).toBe(txn.date);
  });
});

describe('filterOldTransactions', () => {
  const start = moment('2025-06-01');

  it('filters old transactions when shouldCombineInstallments is false', () => {
    const old = makeTxn({ date: '2025-05-15T00:00:00.000Z' });
    const recent = makeTxn({ date: '2025-06-15T00:00:00.000Z' });
    const result = filterOldTransactions([old, recent], start, false);
    expect(result).toHaveLength(1);
  });

  it('keeps initial installment when shouldCombineInstallments is true', () => {
    const txn = makeTxn({
      type: TransactionTypes.Installments,
      installments: { number: 1, total: 3 },
      date: '2025-06-15T00:00:00.000Z',
    });
    const result = filterOldTransactions([txn], start, true);
    expect(result).toHaveLength(1);
  });

  it('filters old initial installment when shouldCombineInstallments is true', () => {
    const txn = makeTxn({
      type: TransactionTypes.Installments,
      installments: { number: 1, total: 3 },
      date: '2025-04-15T00:00:00.000Z',
    });
    const result = filterOldTransactions([txn], start, true);
    expect(result).toHaveLength(0);
  });

  it('keeps normal transaction when shouldCombineInstallments is true', () => {
    const txn = makeTxn({ date: '2025-06-15T00:00:00.000Z' });
    const result = filterOldTransactions([txn], start, true);
    expect(result).toHaveLength(1);
  });
});

describe('sortTransactionsByDate', () => {
  it('sorts by date ascending', () => {
    const a = makeTxn({ date: '2025-06-15T00:00:00.000Z' });
    const b = makeTxn({ date: '2025-06-10T00:00:00.000Z' });
    const result = sortTransactionsByDate([a, b]);
    expect(result[0].date).toBe('2025-06-10T00:00:00.000Z');
  });
});

describe('getRawTransaction', () => {
  it('returns cleaned data when no existing rawTransaction', () => {
    const data = { key: 'value', empty: '' };
    const rawTxn = getRawTransaction(data);
    expect(rawTxn).toEqual({ key: 'value' });
  });

  it('merges with existing object rawTransaction', () => {
    const data = { new: 'data' };
    const existing = { rawTransaction: { old: 'data' } };
    const rawTxn = getRawTransaction(data, existing);
    const isArray = Array.isArray(rawTxn);
    expect(isArray).toBe(true);
    expect(rawTxn).toHaveLength(2);
  });

  it('appends to existing array rawTransaction', () => {
    const data = { new: 'data' };
    const existing = { rawTransaction: [{ old: 'data1' }, { old: 'data2' }] };
    const rawTxn = getRawTransaction(data, existing);
    const isArray = Array.isArray(rawTxn);
    expect(isArray).toBe(true);
    expect(rawTxn).toHaveLength(3);
  });

  it('removes null, undefined, empty string values from data', () => {
    const data = { a: 'keep', b: null, c: undefined, d: '', e: 0, f: false };
    const result = getRawTransaction(data) as Record<string, string | number | boolean>;
    expect(result.a).toBe('keep');
    expect(result.e).toBe(0);
    expect(result.f).toBe(false);
    expect(result.b).toBeUndefined();
    expect(result.c).toBeUndefined();
    expect(result.d).toBeUndefined();
  });

  it('removes empty arrays from data', () => {
    const data = { items: [], name: 'test' };
    const result = getRawTransaction(data) as Record<string, string | number | boolean>;
    expect(result.items).toBeUndefined();
    expect(result.name).toBe('test');
  });

  it('handles nested objects', () => {
    const data = { outer: { inner: 'value', empty: '' } };
    const result = getRawTransaction(data) as Record<string, Record<string, string>>;
    expect(result.outer.inner).toBe('value');
    expect(result.outer.empty).toBeUndefined();
  });

  it('handles arrays within objects', () => {
    const data = { items: [{ a: 'b', c: '' }] };
    const result = getRawTransaction(data) as Record<string, Record<string, string>[]>;
    expect(result.items[0].a).toBe('b');
  });
});
