import moment from 'moment';

import { fetchGetWithinPage } from '../../Common/Fetch';
import type { ScraperOptions } from '../../Scrapers/Base/Interface';
import {
  fetchAllTransactions,
  fetchTransactionsForMonth,
  getAdditionalTransactionInformation,
  getExtraScrapAccount,
  getExtraScrapTransaction,
} from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexEnrich';
import { fetchAccounts, fetchTxnData } from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexFetch';
import {
  buildTransaction,
  combineTxnsFromResults,
} from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexTransactions';
import type { IScrapedTransaction } from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexTypes';
import { createMockPage } from '../MockPage';

jest.mock('../../Common/Fetch', () => ({
  fetchGetWithinPage: jest.fn(),
}));

jest.mock('../../Common/Transactions', () => ({
  fixInstallments: jest.fn((txns: unknown[]) => txns),
  filterOldTransactions: jest.fn((txns: unknown[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
}));

jest.mock('../../Common/Debug', () => ({
  /**
   * Returns a set of jest mock functions as a debug logger stub.
   *
   * @returns a mock debug logger with debug, info, warn, and error functions
   */
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
  runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const init = Promise.resolve([]) as Promise<T[]>;
    return actions.reduce(
      (p: Promise<T[]>, a: () => Promise<T>) => p.then(async (r: T[]) => [...r, await a()]),
      init,
    );
  }),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.mock('../../Common/Dates', () => jest.fn(() => [moment('2024-06-01')]));

jest.mock('../../Scrapers/BaseIsracardAmex/BaseIsracardAmexFetch', () => ({
  fetchAccounts: jest.fn(),
  fetchTxnData: jest.fn(),
}));

/**
 * Creates a mock IScrapedTransaction with sensible defaults.
 *
 * @param overrides - optional field overrides for the mock transaction
 * @returns a IScrapedTransaction object for testing
 */
function makeTxn(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
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

/**
 * Creates mock ScraperOptions for IsracardAmexEnrich tests.
 *
 * @param overrides - optional partial options to override the defaults
 * @returns a ScraperOptions object for testing
 */
function makeOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: 'hapoalim' as ScraperOptions['companyId'],
    startDate: new Date('2024-01-01'),
    ...overrides,
  } as ScraperOptions;
}

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

  it('returns empty object when dataResult is not found', async () => {
    (fetchAccounts as jest.Mock).mockResolvedValueOnce([]);
    (fetchTxnData as jest.Mock).mockResolvedValueOnce({ isFound: false });
    const result = await fetchTransactionsForMonth(opts);
    expect(result).toEqual({});
  });

  it('returns empty object when Header.Status is not 1', async () => {
    (fetchAccounts as jest.Mock).mockResolvedValueOnce([]);
    (fetchTxnData as jest.Mock).mockResolvedValueOnce({
      isFound: true,
      value: { Header: { Status: '0' } },
    });
    const result = await fetchTransactionsForMonth(opts);
    expect(result).toEqual({});
  });

  it('returns account txns when data is valid', async () => {
    (fetchAccounts as jest.Mock).mockResolvedValueOnce([
      { index: 0, accountNumber: '1234', processedDate: '2024-06-15T00:00:00.000Z' },
    ]);
    (fetchTxnData as jest.Mock).mockResolvedValueOnce({
      isFound: true,
      value: {
        Header: { Status: '1' },
        CardsTransactionsListBean: {
          Index0: { CurrentCardTransactions: [{ txnIsrael: [makeTxn()] }] },
        },
      },
    });
    const result = await fetchTransactionsForMonth(opts);
    expect(result['1234']).toBeDefined();
  });
});

describe('combineTxnsFromResults', () => {
  it('merges txns from multiple results', () => {
    const raw1 = makeTxn();
    const t1 = buildTransaction(raw1, '2024-06-15T00:00:00.000Z');
    const raw2 = makeTxn({ voucherNumberRatz: '222222222' });
    const t2 = buildTransaction(raw2, '2024-06-15T00:00:00.000Z');
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
      isFound: true,
      value: {
        Header: { Status: '1' },
        CardsTransactionsListBean: {
          Index0: { CurrentCardTransactions: [{ txnIsrael: [makeTxn()] }] },
        },
      },
    });
    const result = await fetchAllTransactions({
      page: page as never,
      options: makeOptions(),
      companyServiceOptions,
      startMoment: moment('2024-01-01'),
    });
    expect(result.success).toBe(true);
    const isAccounts = Array.isArray(result.accounts);
    expect(isAccounts).toBe(true);
  });

  it('returns empty accounts when fetches fail', async () => {
    (fetchAccounts as jest.Mock).mockResolvedValue([]);
    (fetchTxnData as jest.Mock).mockResolvedValue({ isFound: false });
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
  const rawTxn = makeTxn({ voucherNumberRatz: '12345' });
  const baseTransaction = buildTransaction(rawTxn, '2024-06-15T00:00:00.000Z');
  const opts = {
    page: page as never,
    options: { servicesUrl: 'https://example.com/api', companyCode: '11' },
    month: moment('2024-06-01'),
    accountIndex: 0,
    transaction: baseTransaction,
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns original transaction when fetchGetWithinPage returns isFound:false', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ isFound: false });
    const result = await getExtraScrapTransaction(opts);
    expect(result).toBe(baseTransaction);
  });

  it('enriches transaction with category when data is returned', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      isFound: true,
      value: { PirteyIska_204Bean: { sector: '  מזון  ' } },
    });
    const result = await getExtraScrapTransaction(opts);
    expect(result.category).toBe('מזון');
  });

  it('sets empty category when sector is missing', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      isFound: true,
      value: { PirteyIska_204Bean: {} },
    });
    const result = await getExtraScrapTransaction(opts);
    expect(result.category).toBe('');
  });

  it('calls URL with correct query params', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ isFound: false });
    await getExtraScrapTransaction(opts);
    const calledUrl: string = (
      (fetchGetWithinPage as jest.Mock).mock.calls[0] as [unknown, string]
    )[1];
    expect(calledUrl).toContain('reqName=PirteyIska_204');
    expect(calledUrl).toContain('CardIndex=0');
    expect(calledUrl).toContain('moedChiuv=062024');
  });
});

describe('getExtraScrapAccount', () => {
  const page = createMockPage();
  const rawTxn1 = makeTxn();
  const txn1 = buildTransaction(rawTxn1, '2024-06-15T00:00:00.000Z');
  const accountMap = {
    '1234': { accountNumber: '1234', index: 0, txns: [txn1] },
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns enriched account map', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      isFound: true,
      value: { PirteyIska_204Bean: { sector: 'קמעונאות' } },
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

  it('returns enriched account, original txn when fetch returns not found', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ isFound: false });
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
