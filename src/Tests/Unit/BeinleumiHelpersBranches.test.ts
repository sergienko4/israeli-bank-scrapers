/**
 * Branch coverage tests for BaseBeinleumiGroupHelpers.ts.
 * Targets: getTxnAmount (NaN credit/debit), getCol (missing col),
 * buildSingleTransaction (with/without rawTransaction),
 * extractTransactionDetails (completed vs pending), extractTransaction (empty date).
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger.
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

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
  it('returns credit when debit is NaN', () => {
    const result = MOD.getTxnAmount({ credit: '100.50', debit: '' } as never);
    expect(result).toBeCloseTo(100.5);
  });

  it('returns negative debit when credit is NaN', () => {
    const result = MOD.getTxnAmount({ credit: '', debit: '200.00' } as never);
    expect(result).toBeCloseTo(-200);
  });

  it('returns difference when both are valid', () => {
    const result = MOD.getTxnAmount({ credit: '100', debit: '30' } as never);
    expect(result).toBeCloseTo(70);
  });

  it('returns 0 when both are empty', () => {
    const result = MOD.getTxnAmount({ credit: '', debit: '' } as never);
    expect(result).toBe(0);
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
