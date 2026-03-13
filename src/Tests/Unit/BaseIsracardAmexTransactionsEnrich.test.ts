/**
 * BaseIsracardAmex enrichment + fetch tests.
 * Covers: fetchTransactionsForMonth, getAdditionalTransactionInformation,
 * fetchAllTransactions, getExtraScrapTransaction, getExtraScrapAccount.
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
const FETCH_MODULE = await import('../../Common/Fetch.js');
const ENRICH_MODULE = await import('../../Scrapers/BaseIsracardAmex/BaseIsracardAmexEnrich.js');
const FETCH_ISRACARD = await import('../../Scrapers/BaseIsracardAmex/BaseIsracardAmexFetch.js');
const TXN_CONVERT = await import('../../Scrapers/BaseIsracardAmex/BaseIsracardAmexTransactions.js');
const MOCK_HELPERS = await import('../MockPage.js');

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

describe('fetchTransactionsForMonth', () => {
  const page = MOCK_HELPERS.createMockPage();
  const companyServiceOptions = { servicesUrl: 'https://example.com/api', companyCode: '11' };
  const opts = {
    page: page as never,
    options: makeOptions(),
    companyServiceOptions,
    startMoment: MOMENT_MODULE.default('2024-01-01'),
    monthMoment: MOMENT_MODULE.default('2024-06-01'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns empty object when dataResult is null', async () => {
    (FETCH_ISRACARD.fetchAccounts as jest.Mock).mockResolvedValueOnce([]);
    (FETCH_ISRACARD.fetchTxnData as jest.Mock).mockResolvedValueOnce(null);
    const result = await ENRICH_MODULE.fetchTransactionsForMonth(opts);
    expect(result).toEqual({});
  });

  it('returns empty object when Header.Status is not 1', async () => {
    (FETCH_ISRACARD.fetchAccounts as jest.Mock).mockResolvedValueOnce([]);
    (FETCH_ISRACARD.fetchTxnData as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '0' },
    });
    const result = await ENRICH_MODULE.fetchTransactionsForMonth(opts);
    expect(result).toEqual({});
  });

  it('returns account txns when data is valid', async () => {
    (FETCH_ISRACARD.fetchAccounts as jest.Mock).mockResolvedValueOnce([
      { index: 0, accountNumber: '1234', processedDate: '2024-06-15T00:00:00.000Z' },
    ]);
    (FETCH_ISRACARD.fetchTxnData as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
      CardsTransactionsListBean: {
        Index0: { CurrentCardTransactions: [{ txnIsrael: [makeTxn()] }] },
      },
    });
    const result = await ENRICH_MODULE.fetchTransactionsForMonth(opts);
    expect(result['1234']).toBeDefined();
  });
});

describe('getAdditionalTransactionInformation', () => {
  const page = MOCK_HELPERS.createMockPage();
  const baseOpts = {
    scraperOptions: makeOptions(),
    accountsWithIndex: [],
    page: page as never,
    options: { servicesUrl: 'https://example.com', companyCode: '11' },
    allMonths: [MOMENT_MODULE.default('2024-06-01')],
  };

  it('returns accountsWithIndex when shouldAddTransactionInformation is falsy', async () => {
    const result = await ENRICH_MODULE.getAdditionalTransactionInformation(baseOpts);
    expect(result).toEqual([]);
  });

  it('returns accountsWithIndex when skipAdditionalTransactionInformation opt-in set', async () => {
    const enrichOpts = {
      ...baseOpts,
      scraperOptions: makeOptions({
        shouldAddTransactionInformation: true,
        optInFeatures: ['isracard-amex:skipAdditionalTransactionInformation'],
      }),
    };
    const result = await ENRICH_MODULE.getAdditionalTransactionInformation(enrichOpts);
    expect(result).toEqual([]);
  });
});

describe('fetchAllTransactions', () => {
  const page = MOCK_HELPERS.createMockPage();
  const companyServiceOptions = { servicesUrl: 'https://example.com/api', companyCode: '11' };

  beforeEach(() => jest.clearAllMocks());

  it('returns success with accounts', async () => {
    (FETCH_ISRACARD.fetchAccounts as jest.Mock).mockResolvedValue([
      { index: 0, accountNumber: '1234', processedDate: '2024-06-15T00:00:00.000Z' },
    ]);
    (FETCH_ISRACARD.fetchTxnData as jest.Mock).mockResolvedValue({
      Header: { Status: '1' },
      CardsTransactionsListBean: {
        Index0: { CurrentCardTransactions: [{ txnIsrael: [makeTxn()] }] },
      },
    });
    const startMoment = MOMENT_MODULE.default('2024-01-01');
    const result = await ENRICH_MODULE.fetchAllTransactions({
      page: page as never,
      options: makeOptions(),
      companyServiceOptions,
      startMoment,
    });
    expect(result.success).toBe(true);
    const isAccountsArray = Array.isArray(result.accounts);
    expect(isAccountsArray).toBe(true);
  });

  it('returns empty accounts when fetches fail', async () => {
    (FETCH_ISRACARD.fetchAccounts as jest.Mock).mockResolvedValue([]);
    (FETCH_ISRACARD.fetchTxnData as jest.Mock).mockResolvedValue(null);
    const startMoment = MOMENT_MODULE.default('2024-01-01');
    const result = await ENRICH_MODULE.fetchAllTransactions({
      page: page as never,
      options: makeOptions(),
      companyServiceOptions,
      startMoment,
    });
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });
});

describe('getExtraScrapTransaction', () => {
  const page = MOCK_HELPERS.createMockPage();
  const baseTxnRaw = makeTxn({ voucherNumberRatz: '12345' });
  const baseTransaction = TXN_CONVERT.buildTransaction(baseTxnRaw, '2024-06-15T00:00:00.000Z');
  const opts = {
    page: page as never,
    options: { servicesUrl: 'https://example.com/api', companyCode: '11' },
    month: MOMENT_MODULE.default('2024-06-01'),
    accountIndex: 0,
    transaction: baseTransaction,
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns original transaction when fetchGetWithinPage returns empty object', async () => {
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({});
    const result = await ENRICH_MODULE.getExtraScrapTransaction(opts);
    expect(result).toBe(baseTransaction);
  });

  it('enriches transaction with category when data is returned', async () => {
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      PirteyIska_204Bean: { sector: '  מזון  ' },
    });
    const result = await ENRICH_MODULE.getExtraScrapTransaction(opts);
    expect(result.category).toBe('מזון');
  });

  it('sets empty category when sector is missing', async () => {
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      PirteyIska_204Bean: {},
    });
    const result = await ENRICH_MODULE.getExtraScrapTransaction(opts);
    expect(result.category).toBe('');
  });

  it('calls URL with correct query params', async () => {
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({});
    await ENRICH_MODULE.getExtraScrapTransaction(opts);
    const mockCalls = (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mock.calls;
    const firstCallArgs = mockCalls[0] as string[];
    const calledUrl = firstCallArgs[1];
    expect(calledUrl).toContain('reqName=PirteyIska_204');
    expect(calledUrl).toContain('CardIndex=0');
    expect(calledUrl).toContain('moedChiuv=062024');
  });
});

describe('getExtraScrapAccount', () => {
  const page = MOCK_HELPERS.createMockPage();
  const txnRaw = makeTxn();
  const txn1 = TXN_CONVERT.buildTransaction(txnRaw, '2024-06-15T00:00:00.000Z');
  const accountMap = {
    '1234': { accountNumber: '1234', index: 0, txns: [txn1] },
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns enriched account map', async () => {
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      PirteyIska_204Bean: { sector: 'קמעונאות' },
    });
    const monthMoment = MOMENT_MODULE.default('2024-06-01');
    const result = await ENRICH_MODULE.getExtraScrapAccount({
      page: page as never,
      options: { servicesUrl: 'https://example.com/api', companyCode: '11' },
      accountMap,
      month: monthMoment,
    });
    expect(result['1234']).toBeDefined();
    expect(result['1234'].txns[0].category).toBe('קמעונאות');
  });

  it('returns enriched account, original txn when fetch returns empty object', async () => {
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({});
    const monthMoment = MOMENT_MODULE.default('2024-06-01');
    const result = await ENRICH_MODULE.getExtraScrapAccount({
      page: page as never,
      options: { servicesUrl: 'https://example.com/api', companyCode: '11' },
      accountMap,
      month: monthMoment,
    });
    expect(result['1234'].txns).toHaveLength(1);
  });

  it('returns empty object when accountMap is empty', async () => {
    const monthMoment = MOMENT_MODULE.default('2024-06-01');
    const result = await ENRICH_MODULE.getExtraScrapAccount({
      page: page as never,
      options: { servicesUrl: 'https://example.com/api', companyCode: '11' },
      accountMap: {},
      month: monthMoment,
    });
    expect(result).toEqual({});
  });
});
