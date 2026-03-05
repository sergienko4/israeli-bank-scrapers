import moment from 'moment';

import { filterOldTransactions, fixInstallments } from '../../Common/Transactions';
import { SHEKEL_CURRENCY } from '../../Constants';
import type { ScraperOptions } from '../../Scrapers/Base/Interface';
import {
  buildAccountTxns,
  buildTransaction,
  buildTransactionBase,
  collectAccountTxns,
  convertCurrency,
  convertTransactions,
  filterValidTransactions,
  getInstallmentsInfo,
} from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexTransactions';
import type { ScrapedTransaction } from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexTypes';
import { TransactionStatuses, TransactionTypes } from '../../Transactions';

jest.mock('../../Common/Fetch', () => ({
  fetchGetWithinPage: jest.fn(),
}));

jest.mock('../../Common/Transactions', () => ({
  fixInstallments: jest.fn((txns: unknown[]) => txns),
  filterOldTransactions: jest.fn((txns: unknown[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
}));

jest.mock('../../Common/Debug', () => ({
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('../../Common/Waiting', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(
    <T>(actions: (() => Promise<T>)[]): Promise<T[]> =>
      actions.reduce(
        (p: Promise<T[]>, a: () => Promise<T>) => p.then(async (r: T[]) => [...r, await a()]),
        Promise.resolve([] as T[]),
      ),
  ),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.mock('../../Common/Dates', () => jest.fn(() => [moment('2024-06-01')]));

jest.mock('../../Scrapers/BaseIsracardAmex/BaseIsracardAmexFetch', () => ({
  fetchAccounts: jest.fn(),
  fetchTxnData: jest.fn(),
}));

function makeTxn(overrides: Partial<ScrapedTransaction> = {}): ScrapedTransaction {
  return {
    dealSumType: '0',
    voucherNumberRatz: '111111111',
    voucherNumberRatzOutbound: '999999999',
    dealSumOutbound: false,
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

function makeOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: 'hapoalim' as ScraperOptions['companyId'],
    startDate: new Date('2024-01-01'),
    ...overrides,
  } as ScraperOptions;
}

describe('convertCurrency', () => {
  it('converts Hebrew shekel keyword to ILS', () => {
    expect(convertCurrency('ש"ח')).toBe(SHEKEL_CURRENCY);
  });

  it('converts alt shekel keyword to ILS', () => {
    expect(convertCurrency('NIS')).toBe(SHEKEL_CURRENCY);
  });

  it('leaves other currencies unchanged', () => {
    expect(convertCurrency('USD')).toBe('USD');
  });
});

describe('getInstallmentsInfo', () => {
  it('returns undefined when no moreInfo', () => {
    expect(getInstallmentsInfo(makeTxn())).toBeUndefined();
  });

  it('returns undefined when moreInfo has no installments keyword', () => {
    expect(getInstallmentsInfo(makeTxn({ moreInfo: 'regular purchase' }))).toBeUndefined();
  });

  it('returns installments when keyword present', () => {
    const result = getInstallmentsInfo(makeTxn({ moreInfo: 'תשלום 3 מתוך 12' }));
    expect(result).toEqual({ number: 3, total: 12 });
  });

  it('returns undefined when fewer than 2 numbers found', () => {
    const result = getInstallmentsInfo(makeTxn({ moreInfo: 'תשלום 3' }));
    expect(result).toBeUndefined();
  });
});

describe('buildTransactionBase', () => {
  it('builds normal inbound transaction', () => {
    const result = buildTransactionBase(makeTxn(), '2024-06-15T00:00:00.000Z');
    expect(result.type).toBe(TransactionTypes.Normal);
    expect(result.originalAmount).toBe(-100);
    expect(result.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(result.status).toBe(TransactionStatuses.Completed);
    expect(result.description).toBe('חנות');
  });

  it('builds outbound transaction (abroad)', () => {
    const txn = makeTxn({
      dealSumOutbound: true,
      fullPurchaseDateOutbound: '10/06/2024',
      fullSupplierNameOutbound: 'Amazon US',
      paymentSumOutbound: 50,
      currencyId: 'USD',
    });
    const result = buildTransactionBase(txn, '2024-06-15T00:00:00.000Z');
    expect(result.description).toBe('Amazon US');
    expect(result.chargedAmount).toBe(-50);
  });

  it('uses fullPaymentDate as processedDate when present', () => {
    const txn = makeTxn({ fullPaymentDate: '20/06/2024' });
    const result = buildTransactionBase(txn, '2024-06-15T00:00:00.000Z');
    expect(result.processedDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.processedDate).not.toBe('2024-06-15T00:00:00.000Z');
  });

  it('uses fallback processedDate when fullPaymentDate absent', () => {
    const fallback = '2024-06-15T00:00:00.000Z';
    const result = buildTransactionBase(makeTxn(), fallback);
    expect(result.processedDate).toBe(fallback);
  });

  it('sets installment type when moreInfo contains installment keyword', () => {
    const result = buildTransactionBase(
      makeTxn({ moreInfo: 'תשלום 2 מתוך 6' }),
      '2024-06-15T00:00:00.000Z',
    );
    expect(result.type).toBe(TransactionTypes.Installments);
    expect(result.installments).toEqual({ number: 2, total: 6 });
  });
});

describe('buildTransaction', () => {
  it('does not include rawTransaction by default', () => {
    const result = buildTransaction(makeTxn(), '2024-06-15T00:00:00.000Z');
    expect(result.rawTransaction).toBeUndefined();
  });

  it('includes rawTransaction when option set', () => {
    const result = buildTransaction(
      makeTxn(),
      '2024-06-15T00:00:00.000Z',
      makeOptions({ includeRawTransaction: true }),
    );
    expect(result.rawTransaction).toBeDefined();
  });
});

describe('filterValidTransactions', () => {
  it('filters out dealSumType=1', () => {
    const result = filterValidTransactions([makeTxn({ dealSumType: '1' }), makeTxn()]);
    expect(result).toHaveLength(1);
  });

  it('filters out zero voucherNumberRatz', () => {
    const result = filterValidTransactions([makeTxn({ voucherNumberRatz: '000000000' })]);
    expect(result).toHaveLength(0);
  });

  it('filters out zero voucherNumberRatzOutbound', () => {
    const result = filterValidTransactions([makeTxn({ voucherNumberRatzOutbound: '000000000' })]);
    expect(result).toHaveLength(0);
  });

  it('keeps valid transactions', () => {
    const result = filterValidTransactions([makeTxn()]);
    expect(result).toHaveLength(1);
  });
});

describe('convertTransactions', () => {
  it('converts and filters transactions', () => {
    const txns = [makeTxn({ dealSumType: '1' }), makeTxn()];
    const result = convertTransactions(txns, '2024-06-15T00:00:00.000Z');
    expect(result).toHaveLength(1);
  });
});

describe('collectAccountTxns', () => {
  const account = { index: 0, accountNumber: '1234', processedDate: '2024-06-15T00:00:00.000Z' };
  const startMoment = moment('2024-01-01');
  const options = makeOptions();

  it('collects israel transactions', () => {
    const txnGroups = [{ txnIsrael: [makeTxn()] }];
    const result = collectAccountTxns({ txnGroups, account, options, startMoment });
    expect(result).toHaveLength(1);
  });

  it('collects abroad transactions', () => {
    const txnGroups = [{ txnAbroad: [makeTxn()] }];
    const result = collectAccountTxns({ txnGroups, account, options, startMoment });
    expect(result).toHaveLength(1);
  });

  it('calls fixInstallments when shouldCombineInstallments=false', () => {
    collectAccountTxns({
      txnGroups: [{ txnIsrael: [makeTxn()] }],
      account,
      options: makeOptions({ shouldCombineInstallments: false }),
      startMoment,
    });
    expect(fixInstallments).toHaveBeenCalled();
  });

  it('skips fixInstallments when shouldCombineInstallments=true', () => {
    jest.clearAllMocks();
    collectAccountTxns({
      txnGroups: [{ txnIsrael: [makeTxn()] }],
      account,
      options: makeOptions({ shouldCombineInstallments: true }),
      startMoment,
    });
    expect(fixInstallments).not.toHaveBeenCalled();
  });

  it('calls filterOldTransactions by default', () => {
    collectAccountTxns({ txnGroups: [{ txnIsrael: [makeTxn()] }], account, options, startMoment });
    expect(filterOldTransactions).toHaveBeenCalled();
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
    const result = buildAccountTxns({
      accounts,
      dataResult,
      options: makeOptions(),
      startMoment: moment('2024-01-01'),
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
    const result = buildAccountTxns({
      accounts,
      dataResult,
      options: makeOptions(),
      startMoment: moment('2024-01-01'),
    });
    expect(result['5678']).toBeUndefined();
  });
});
