import moment from 'moment';

import { SHEKEL_CURRENCY } from '../Constants';
import { fetchGetWithinPage } from '../Helpers/Fetch';
import { filterOldTransactions, fixInstallments } from '../Helpers/Transactions';
import { createMockPage } from '../Tests/MockPage';
import { TransactionStatuses, TransactionTypes } from '../Transactions';
import { fetchAccounts, fetchTxnData } from './BaseIsracardAmexFetch';
import {
  buildAccountTxns,
  buildTransaction,
  buildTransactionBase,
  collectAccountTxns,
  combineTxnsFromResults,
  convertCurrency,
  convertTransactions,
  fetchAllTransactions,
  fetchTransactionsForMonth,
  filterValidTransactions,
  getAdditionalTransactionInformation,
  getExtraScrapAccount,
  getExtraScrapTransaction,
  getInstallmentsInfo,
} from './BaseIsracardAmexTransactions';
import type { ScrapedTransaction } from './BaseIsracardAmexTypes';
import type { ScraperOptions } from './Interface';

jest.mock('../Helpers/Fetch', () => ({
  fetchGetWithinPage: jest.fn(),
}));

jest.mock('../Helpers/Transactions', () => ({
  fixInstallments: jest.fn((txns: unknown[]) => txns),
  filterOldTransactions: jest.fn((txns: unknown[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
}));

jest.mock('../Helpers/Debug', () => ({
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock('../Helpers/Waiting', () => ({
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

jest.mock('../Helpers/Dates', () => jest.fn(() => [moment('2024-06-01')]));

jest.mock('./BaseIsracardAmexFetch', () => ({
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

describe('fetchTransactionsForMonth', () => {
  const page = createMockPage();
  const companyServiceOptions = { servicesUrl: 'https://example.com/api', companyCode: '11' };
  const opts = {
    page: page as never,
    options: makeOptions(),
    companyServiceOptions,
    startMoment: moment('2024-01-01'),
    monthMoment: moment('2024-06-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns empty object when dataResult is null', async () => {
    (fetchAccounts as jest.Mock).mockResolvedValueOnce([]);
    (fetchTxnData as jest.Mock).mockResolvedValueOnce(null);
    const result = await fetchTransactionsForMonth(opts);
    expect(result).toEqual({});
  });

  it('returns empty object when Header.Status is not 1', async () => {
    (fetchAccounts as jest.Mock).mockResolvedValueOnce([]);
    (fetchTxnData as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });
    const result = await fetchTransactionsForMonth(opts);
    expect(result).toEqual({});
  });

  it('returns account txns when data is valid', async () => {
    (fetchAccounts as jest.Mock).mockResolvedValueOnce([
      { index: 0, accountNumber: '1234', processedDate: '2024-06-15T00:00:00.000Z' },
    ]);
    (fetchTxnData as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
      CardsTransactionsListBean: {
        Index0: { CurrentCardTransactions: [{ txnIsrael: [makeTxn()] }] },
      },
    });
    const result = await fetchTransactionsForMonth(opts);
    expect(result['1234']).toBeDefined();
  });
});

describe('combineTxnsFromResults', () => {
  it('merges txns from multiple results', () => {
    const t1 = buildTransaction(makeTxn(), '2024-06-15T00:00:00.000Z');
    const t2 = buildTransaction(
      makeTxn({ voucherNumberRatz: '222222222' }),
      '2024-06-15T00:00:00.000Z',
    );
    const results = [
      { '1234': { accountNumber: '1234', index: 0, txns: [t1] } },
      { '1234': { accountNumber: '1234', index: 0, txns: [t2] } },
    ];
    const combined = combineTxnsFromResults(results);
    expect(combined['1234']).toHaveLength(2);
  });

  it('handles empty results', () => {
    const combined = combineTxnsFromResults([]);
    expect(combined).toEqual({});
  });
});

describe('getAdditionalTransactionInformation', () => {
  const page = createMockPage();
  const baseOpts = {
    scraperOptions: makeOptions(),
    accountsWithIndex: [],
    page: page as never,
    options: { servicesUrl: 'https://example.com', companyCode: '11' },
    allMonths: [moment('2024-06-01')],
  };

  it('returns accountsWithIndex when shouldAddTransactionInformation is falsy', async () => {
    const result = await getAdditionalTransactionInformation(baseOpts);
    expect(result).toEqual([]);
  });

  it('returns accountsWithIndex when skipAdditionalTransactionInformation opt-in set', async () => {
    const opts = {
      ...baseOpts,
      scraperOptions: makeOptions({
        shouldAddTransactionInformation: true,
        optInFeatures: ['isracard-amex:skipAdditionalTransactionInformation'],
      }),
    };
    const result = await getAdditionalTransactionInformation(opts);
    expect(result).toEqual([]);
  });
});

describe('fetchAllTransactions', () => {
  const page = createMockPage();
  const companyServiceOptions = { servicesUrl: 'https://example.com/api', companyCode: '11' };

  beforeEach(() => jest.clearAllMocks());

  it('returns success with accounts', async () => {
    (fetchAccounts as jest.Mock).mockResolvedValue([
      { index: 0, accountNumber: '1234', processedDate: '2024-06-15T00:00:00.000Z' },
    ]);
    (fetchTxnData as jest.Mock).mockResolvedValue({
      Header: { Status: '1' },
      CardsTransactionsListBean: {
        Index0: { CurrentCardTransactions: [{ txnIsrael: [makeTxn()] }] },
      },
    });
    const result = await fetchAllTransactions({
      page: page as never,
      options: makeOptions(),
      companyServiceOptions,
      startMoment: moment('2024-01-01'),
    });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.accounts)).toBe(true);
  });

  it('returns empty accounts when fetches fail', async () => {
    (fetchAccounts as jest.Mock).mockResolvedValue([]);
    (fetchTxnData as jest.Mock).mockResolvedValue(null);
    const result = await fetchAllTransactions({
      page: page as never,
      options: makeOptions(),
      companyServiceOptions,
      startMoment: moment('2024-01-01'),
    });
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });
});

describe('getExtraScrapTransaction', () => {
  const page = createMockPage();
  const baseTransaction = buildTransaction(
    makeTxn({ voucherNumberRatz: '12345' }),
    '2024-06-15T00:00:00.000Z',
  );
  const opts = {
    page: page as never,
    options: { servicesUrl: 'https://example.com/api', companyCode: '11' },
    month: moment('2024-06-01'),
    accountIndex: 0,
    transaction: baseTransaction,
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns original transaction when fetchGetWithinPage returns null', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);
    const result = await getExtraScrapTransaction(opts);
    expect(result).toBe(baseTransaction);
  });

  it('enriches transaction with category when data is returned', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      PirteyIska_204Bean: { sector: '  מזון  ' },
    });
    const result = await getExtraScrapTransaction(opts);
    expect(result.category).toBe('מזון');
  });

  it('sets empty category when sector is missing', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ PirteyIska_204Bean: {} });
    const result = await getExtraScrapTransaction(opts);
    expect(result.category).toBe('');
  });

  it('calls URL with correct query params', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);
    await getExtraScrapTransaction(opts);
    const calledUrl: string = (fetchGetWithinPage as jest.Mock).mock.calls[0][1] as string;
    expect(calledUrl).toContain('reqName=PirteyIska_204');
    expect(calledUrl).toContain('CardIndex=0');
    expect(calledUrl).toContain('moedChiuv=062024');
  });
});

describe('getExtraScrapAccount', () => {
  const page = createMockPage();
  const txn1 = buildTransaction(makeTxn(), '2024-06-15T00:00:00.000Z');
  const accountMap = {
    '1234': { accountNumber: '1234', index: 0, txns: [txn1] },
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns enriched account map', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      PirteyIska_204Bean: { sector: 'קמעונאות' },
    });
    const result = await getExtraScrapAccount({
      page: page as never,
      options: { servicesUrl: 'https://example.com/api', companyCode: '11' },
      accountMap,
      month: moment('2024-06-01'),
    });
    expect(result['1234']).toBeDefined();
    expect(result['1234'].txns[0].category).toBe('קמעונאות');
  });

  it('returns enriched account, original txn when fetch returns null', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);
    const result = await getExtraScrapAccount({
      page: page as never,
      options: { servicesUrl: 'https://example.com/api', companyCode: '11' },
      accountMap,
      month: moment('2024-06-01'),
    });
    expect(result['1234'].txns).toHaveLength(1);
  });

  it('returns empty object when accountMap is empty', async () => {
    const result = await getExtraScrapAccount({
      page: page as never,
      options: { servicesUrl: 'https://example.com/api', companyCode: '11' },
      accountMap: {},
      month: moment('2024-06-01'),
    });
    expect(result).toEqual({});
  });
});
