/**
 * BaseIsracardAmex transaction conversion tests.
 * Covers: convertCurrency, getInstallmentsInfo, buildTransactionBase,
 * buildTransaction, filterValidTransactions, convertTransactions,
 * collectAccountTxns, buildAccountTxns.
 */
import { jest } from '@jest/globals';

import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';
import type { IScrapedTransaction } from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexTypes.js';

jest.unstable_mockModule('../../Common/Fetch.js', () => ({
  fetchGetWithinPage: jest.fn(),
}));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  fixInstallments: jest.fn((txns: unknown[]) => txns),
  filterOldTransactions: jest.fn((txns: unknown[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
}));

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger with all methods stubbed.
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

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const initial = Promise.resolve([] as T[]);
    return actions.reduce(
      (chain: Promise<T[]>, action: () => Promise<T>) =>
        chain.then(async (results: T[]) => [...results, await action()]),
      initial,
    );
  }),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.unstable_mockModule('../../Common/Dates.js', () => ({
  default: jest.fn(() => [MOMENT_MODULE.default('2024-06-01')]),
}));

jest.unstable_mockModule('../../Scrapers/BaseIsracardAmex/BaseIsracardAmexFetch.js', () => ({
  fetchAccounts: jest.fn(),
  fetchTxnData: jest.fn(),
}));

const MOMENT_MODULE = await import('moment');
const TXN_MODULE = await import('../../Common/Transactions.js');
const CONSTANTS = await import('../../Constants.js');
const TXN_CONVERT = await import('../../Scrapers/BaseIsracardAmex/BaseIsracardAmexTransactions.js');
const TXN_TYPES = await import('../../Transactions.js');

/**
 * Create a test transaction with sensible defaults and optional overrides.
 * @param overrides - partial fields to merge with transaction defaults.
 * @returns complete scraped transaction object.
 */
function makeTxn(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
  return {
    dealSumType: '0',
    voucherNumberRatz: '111111111',
    voucherNumberRatzOutbound: '999999999',
    dealSumOutbound: 0,
    currencyId: 'ש"ח',
    currentPaymentCurrency: 'ש"ח',
    dealSum: 100,
    paymentSum: 100,
    paymentSumOutbound: 0,
    fullPurchaseDate: '15/06/2024',
    fullSupplierNameHeb: 'חנות',
    fullSupplierNameOutbound: '',
    moreInfo: '',
    ...overrides,
  };
}

/**
 * Create test ScraperOptions with optional overrides.
 * @param overrides - partial fields to merge with option defaults.
 * @returns complete scraper options object.
 */
function makeOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: 'hapoalim' as ScraperOptions['companyId'],
    startDate: new Date('2024-01-01'),
    ...overrides,
  } as ScraperOptions;
}

describe('convertCurrency', () => {
  it('converts Hebrew shekel keyword to ILS', () => {
    const result = TXN_CONVERT.convertCurrency('ש"ח');
    expect(result).toBe(CONSTANTS.SHEKEL_CURRENCY);
  });

  it('converts alt shekel keyword to ILS', () => {
    const result = TXN_CONVERT.convertCurrency('NIS');
    expect(result).toBe(CONSTANTS.SHEKEL_CURRENCY);
  });

  it('leaves other currencies unchanged', () => {
    const result = TXN_CONVERT.convertCurrency('USD');
    expect(result).toBe('USD');
  });
});

describe('getInstallmentsInfo', () => {
  it('returns false when no moreInfo', () => {
    const txn = makeTxn();
    const info = TXN_CONVERT.getInstallmentsInfo(txn);
    expect(info).toBe(false);
  });

  it('returns false when moreInfo has no installments keyword', () => {
    const txn = makeTxn({ moreInfo: 'regular purchase' });
    const info = TXN_CONVERT.getInstallmentsInfo(txn);
    expect(info).toBe(false);
  });

  it('returns installments when keyword present', () => {
    const txn = makeTxn({ moreInfo: 'תשלום 3 מתוך 12' });
    const result = TXN_CONVERT.getInstallmentsInfo(txn);
    expect(result).toEqual({ number: 3, total: 12 });
  });

  it('returns false when fewer than 2 numbers found', () => {
    const txn = makeTxn({ moreInfo: 'תשלום 3' });
    const result = TXN_CONVERT.getInstallmentsInfo(txn);
    expect(result).toBe(false);
  });
});

describe('buildTransactionBase', () => {
  it('builds normal inbound transaction', () => {
    const txn = makeTxn();
    const result = TXN_CONVERT.buildTransactionBase(txn, '2024-06-15T00:00:00.000Z');
    expect(result.type).toBe(TXN_TYPES.TransactionTypes.Normal);
    expect(result.originalAmount).toBe(-100);
    expect(result.originalCurrency).toBe(CONSTANTS.SHEKEL_CURRENCY);
    expect(result.status).toBe(TXN_TYPES.TransactionStatuses.Completed);
    expect(result.description).toBe('חנות');
  });

  it('builds outbound transaction (abroad)', () => {
    const txn = makeTxn({
      dealSumOutbound: 1,
      fullPurchaseDateOutbound: '10/06/2024',
      fullSupplierNameOutbound: 'Amazon US',
      paymentSumOutbound: 50,
      currencyId: 'USD',
    });
    const result = TXN_CONVERT.buildTransactionBase(txn, '2024-06-15T00:00:00.000Z');
    expect(result.description).toBe('Amazon US');
    expect(result.chargedAmount).toBe(-50);
  });

  it('uses fullPaymentDate as processedDate when present', () => {
    const txn = makeTxn({ fullPaymentDate: '20/06/2024' });
    const result = TXN_CONVERT.buildTransactionBase(txn, '2024-06-15T00:00:00.000Z');
    expect(result.processedDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.processedDate).not.toBe('2024-06-15T00:00:00.000Z');
  });

  it('uses fallback processedDate when fullPaymentDate absent', () => {
    const fallback = '2024-06-15T00:00:00.000Z';
    const txn = makeTxn();
    const result = TXN_CONVERT.buildTransactionBase(txn, fallback);
    expect(result.processedDate).toBe(fallback);
  });

  it('sets installment type when moreInfo contains installment keyword', () => {
    const txn = makeTxn({ moreInfo: 'תשלום 2 מתוך 6' });
    const result = TXN_CONVERT.buildTransactionBase(txn, '2024-06-15T00:00:00.000Z');
    expect(result.type).toBe(TXN_TYPES.TransactionTypes.Installments);
    expect(result.installments).toEqual({ number: 2, total: 6 });
  });
});

describe('buildTransaction', () => {
  it('does not include rawTransaction by default', () => {
    const txn = makeTxn();
    const result = TXN_CONVERT.buildTransaction(txn, '2024-06-15T00:00:00.000Z');
    expect(result.rawTransaction).toBeUndefined();
  });

  it('includes rawTransaction when option set', () => {
    const txn = makeTxn();
    const opts = makeOptions({ includeRawTransaction: true });
    const result = TXN_CONVERT.buildTransaction(txn, '2024-06-15T00:00:00.000Z', opts);
    expect(result.rawTransaction).toBeDefined();
  });
});

describe('filterValidTransactions', () => {
  it('filters out dealSumType=1', () => {
    const txns = [makeTxn({ dealSumType: '1' }), makeTxn()];
    const result = TXN_CONVERT.filterValidTransactions(txns);
    expect(result).toHaveLength(1);
  });

  it('filters out zero voucherNumberRatz', () => {
    const txns = [makeTxn({ voucherNumberRatz: '000000000' })];
    const result = TXN_CONVERT.filterValidTransactions(txns);
    expect(result).toHaveLength(0);
  });

  it('filters out zero voucherNumberRatzOutbound', () => {
    const txns = [makeTxn({ voucherNumberRatzOutbound: '000000000' })];
    const result = TXN_CONVERT.filterValidTransactions(txns);
    expect(result).toHaveLength(0);
  });

  it('keeps valid transactions', () => {
    const txns = [makeTxn()];
    const result = TXN_CONVERT.filterValidTransactions(txns);
    expect(result).toHaveLength(1);
  });
});

describe('convertTransactions', () => {
  it('converts and filters transactions', () => {
    const txns = [makeTxn({ dealSumType: '1' }), makeTxn()];
    const result = TXN_CONVERT.convertTransactions(txns, '2024-06-15T00:00:00.000Z');
    expect(result).toHaveLength(1);
  });
});

describe('collectAccountTxns', () => {
  const account = { index: 0, accountNumber: '1234', processedDate: '2024-06-15T00:00:00.000Z' };
  const startMoment = MOMENT_MODULE.default('2024-01-01');
  const options = makeOptions();

  it('collects israel transactions', () => {
    const txnGroups = [{ txnIsrael: [makeTxn()] }];
    const result = TXN_CONVERT.collectAccountTxns({ txnGroups, account, options, startMoment });
    expect(result).toHaveLength(1);
  });

  it('collects abroad transactions', () => {
    const txnGroups = [{ txnAbroad: [makeTxn()] }];
    const result = TXN_CONVERT.collectAccountTxns({ txnGroups, account, options, startMoment });
    expect(result).toHaveLength(1);
  });

  it('calls fixInstallments when shouldCombineInstallments=false', () => {
    TXN_CONVERT.collectAccountTxns({
      txnGroups: [{ txnIsrael: [makeTxn()] }],
      account,
      options: makeOptions({ shouldCombineInstallments: false }),
      startMoment,
    });
    expect(TXN_MODULE.fixInstallments).toHaveBeenCalled();
  });

  it('skips fixInstallments when shouldCombineInstallments=true', () => {
    jest.clearAllMocks();
    TXN_CONVERT.collectAccountTxns({
      txnGroups: [{ txnIsrael: [makeTxn()] }],
      account,
      options: makeOptions({ shouldCombineInstallments: true }),
      startMoment,
    });
    expect(TXN_MODULE.fixInstallments).not.toHaveBeenCalled();
  });

  it('calls filterOldTransactions by default', () => {
    TXN_CONVERT.collectAccountTxns({
      txnGroups: [{ txnIsrael: [makeTxn()] }],
      account,
      options,
      startMoment,
    });
    expect(TXN_MODULE.filterOldTransactions).toHaveBeenCalled();
  });
});

describe('buildAccountTxns', () => {
  it('builds account txns map from data result', () => {
    const accounts = [
      { index: 0, accountNumber: '1234', processedDate: '2024-06-15T00:00:00.000Z' },
    ];
    const dataResult = {
      CardsTransactionsListBean: {
        Index0: { CurrentCardTransactions: [{ txnIsrael: [makeTxn()] }] },
      },
    };
    const startMoment = MOMENT_MODULE.default('2024-01-01');
    const result = TXN_CONVERT.buildAccountTxns({
      accounts,
      dataResult,
      options: makeOptions(),
      startMoment,
    });
    expect(result['1234']).toBeDefined();
  });

  it('skips accounts with no txn groups in data', () => {
    const accounts = [
      { index: 1, accountNumber: '5678', processedDate: '2024-06-15T00:00:00.000Z' },
    ];
    const dataResult = {
      CardsTransactionsListBean: { Index0: { CurrentCardTransactions: [] } },
    };
    const startMoment = MOMENT_MODULE.default('2024-01-01');
    const result = TXN_CONVERT.buildAccountTxns({
      accounts,
      dataResult,
      options: makeOptions(),
      startMoment,
    });
    expect(result['5678']).toBeUndefined();
  });
});

describe('combineTxnsFromResults', () => {
  it('merges txns from multiple results', () => {
    const txn1 = makeTxn();
    const transaction1 = TXN_CONVERT.buildTransaction(txn1, '2024-06-15T00:00:00.000Z');
    const txn2 = makeTxn({ voucherNumberRatz: '222222222' });
    const transaction2 = TXN_CONVERT.buildTransaction(txn2, '2024-06-15T00:00:00.000Z');
    const results = [
      { '1234': { accountNumber: '1234', index: 0, txns: [transaction1] } },
      { '1234': { accountNumber: '1234', index: 0, txns: [transaction2] } },
    ];
    const combined = TXN_CONVERT.combineTxnsFromResults(results);
    expect(combined['1234']).toHaveLength(2);
  });

  it('handles empty results', () => {
    const combined = TXN_CONVERT.combineTxnsFromResults([]);
    expect(combined).toEqual({});
  });
});
