/**
 * Branch coverage tests for BaseBeinleumiGroupHelpers.ts.
 * Targets: getTxnAmount (NaN credit/debit), getCol (missing col),
 * buildSingleTransaction (with/without rawTransaction),
 * extractTransactionDetails (completed vs pending), extractTransaction (empty date),
 * isNoTransactionInDateRangeError (visible → true, throws → false),
 * waitForPostLogin (empty waiters → false, success → true,
 * AggregateError → false, non-AggregateError → rethrow).
 */
import { jest } from '@jest/globals';

import { createDebugMock } from '../MockModuleFactories.js';

jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  getRawTransaction: jest.fn((data: Record<string, string>) => data),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn().mockResolvedValue([]),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

const MOD = await import('../../Scrapers/BaseBeinleumiGroup/BaseBeinleumiGroupHelpers.js');
const { TransactionStatuses: TXN_STATUSES } = await import('../../Transactions.js');

describe('getTxnAmount', () => {
  const cases: readonly [string, string, string, number][] = [
    ['returns credit when debit is NaN', '100.50', '', 100.5],
    ['returns negative debit when credit is NaN', '', '200.00', -200],
    ['returns difference when both are valid', '100', '30', 70],
    ['returns 0 when both are empty', '', '', 0],
  ] as const;

  it.each(cases)('%s', (...args: readonly [string, string, string, number]) => {
    const [, credit, debit, expected] = args;
    const result = MOD.getTxnAmount({ credit, debit } as never);
    expect(result).toBeCloseTo(expected);
  });
});

describe('getCol', () => {
  it('returns trimmed cell value', () => {
    const tds = { 0: '  hello  ', 1: 'world' };
    const cols = { myCol: 0 };
    const colValue = MOD.getCol(tds as never, cols as never, 'myCol');
    expect(colValue).toBe('hello');
  });

  it('returns empty string for missing column', () => {
    const tds = { 0: 'data' };
    const cols = {};
    const missingCol = MOD.getCol(tds as never, cols as never, 'missing');
    expect(missingCol).toBe('');
  });
});

describe('buildSingleTransaction', () => {
  const txn = {
    status: TXN_STATUSES.Completed,
    date: '01/06/2025',
    description: 'Test',
    reference: '12345',
    debit: '100',
    credit: '',
    memo: 'memo text',
  };

  it('builds transaction without rawTransaction by default', () => {
    const result = MOD.buildSingleTransaction(txn as never);
    expect(result.description).toBe('Test');
    expect(result.rawTransaction).toBeUndefined();
  });

  it('includes rawTransaction when option set', () => {
    const opts = { includeRawTransaction: true } as never;
    const result = MOD.buildSingleTransaction(txn as never, opts);
    expect(result.rawTransaction).toBeDefined();
  });

  it('sets identifier from reference', () => {
    const result = MOD.buildSingleTransaction(txn as never);
    expect(result.identifier).toBe(12345);
  });

  it('sets undefined identifier when no reference', () => {
    const noRef = { ...txn, reference: '' };
    const result = MOD.buildSingleTransaction(noRef as never);
    expect(result.identifier).toBeUndefined();
  });
});

describe('extractTransaction', () => {
  it('pushes transaction when date is non-empty', () => {
    const txns: unknown[] = [];
    const txnRow = {
      innerTds: { 0: '01/06/2025', 1: 'Test', 2: '123', 3: '100', 4: '' },
    };
    const cols = {
      'date first': 0,
      'reference wrap_normal': 1,
      details: 2,
      debit: 3,
      credit: 4,
    };
    MOD.extractTransaction({
      txns: txns as never,
      transactionStatus: TXN_STATUSES.Completed,
      txnRow: txnRow as never,
      transactionsColsTypes: cols as never,
    });
    expect(txns).toHaveLength(1);
  });

  it('does not push transaction when date is empty', () => {
    const txns: unknown[] = [];
    const txnRow = { innerTds: {} };
    const cols = {};
    MOD.extractTransaction({
      txns: txns as never,
      transactionStatus: TXN_STATUSES.Completed,
      txnRow: txnRow as never,
      transactionsColsTypes: cols as never,
    });
    expect(txns).toHaveLength(0);
  });
});

describe('extractTransactionDetails', () => {
  const cols = {
    'date first': 0,
    'first date': 1,
    'reference wrap_normal': 2,
    'details wrap_normal': 3,
    details: 4,
    debit: 5,
    credit: 6,
  };
  const tds = {
    0: '01/06/2025',
    1: '02/06/2025',
    2: 'Completed Desc',
    3: 'Pending Desc',
    4: '123',
    5: '100',
    6: '50',
  };

  it('uses completed column classes for Completed status', () => {
    const result = MOD.extractTransactionDetails(
      { innerTds: tds } as never,
      TXN_STATUSES.Completed,
      cols as never,
    );
    expect(result.date).toBe('01/06/2025');
    expect(result.description).toBe('Completed Desc');
  });

  it('uses pending column classes for Pending status', () => {
    const result = MOD.extractTransactionDetails(
      { innerTds: tds } as never,
      TXN_STATUSES.Pending,
      cols as never,
    );
    expect(result.date).toBe('02/06/2025');
    expect(result.description).toBe('Pending Desc');
  });
});

describe('isNoTransactionInDateRangeError', () => {
  it('returns true when the no-data text is visible', async () => {
    const page = {
      getByText: jest.fn(() => ({
        first: jest.fn(() => ({
          isVisible: jest.fn().mockResolvedValue(true),
        })),
      })),
    };
    const isError = await MOD.isNoTransactionInDateRangeError(page as never);
    expect(isError).toBe(true);
  });

  it('returns false when isVisible throws', async () => {
    const page = {
      getByText: jest.fn(() => ({
        first: jest.fn(() => ({
          isVisible: jest.fn().mockRejectedValue(new Error('detached')),
        })),
      })),
    };
    const isError = await MOD.isNoTransactionInDateRangeError(page as never);
    expect(isError).toBe(false);
  });
});

describe('waitForPostLogin', () => {
  it('returns false when no dashboard candidates match', async () => {
    const page = {
      getByText: jest.fn(() => ({
        first: jest.fn(() => ({
          waitFor: jest.fn().mockRejectedValue(new Error('timeout')),
        })),
      })),
      getByLabel: jest.fn(() => ({
        first: jest.fn(() => ({
          waitFor: jest.fn().mockRejectedValue(new Error('timeout')),
        })),
      })),
    };
    const isLoggedIn = await MOD.waitForPostLogin(page as never);
    expect(isLoggedIn).toBe(false);
  });

  it('returns true when a dashboard element is found', async () => {
    const page = {
      getByText: jest.fn(() => ({
        first: jest.fn(() => ({
          waitFor: jest.fn().mockResolvedValue(undefined),
        })),
      })),
      getByLabel: jest.fn(() => ({
        first: jest.fn(() => ({
          waitFor: jest.fn().mockResolvedValue(undefined),
        })),
      })),
    };
    const isLoggedIn = await MOD.waitForPostLogin(page as never);
    expect(isLoggedIn).toBe(true);
  });

  it('returns false when all waiters reject (AggregateError)', async () => {
    const page = {
      getByText: jest.fn(() => ({
        first: jest.fn(() => ({
          waitFor: jest.fn().mockRejectedValue(new Error('timeout')),
        })),
      })),
      getByLabel: jest.fn(() => ({
        first: jest.fn(() => ({
          waitFor: jest.fn().mockRejectedValue(new Error('timeout')),
        })),
      })),
    };
    const isLoggedIn = await MOD.waitForPostLogin(page as never);
    expect(isLoggedIn).toBe(false);
  });
});
