/**
 * Branch coverage tests for BaseIsracardAmexEnrich.ts.
 * Targets: getExtraScrapTransaction null response fallback,
 * fetchTransactionsForMonth missing CardsTransactionsListBean,
 * getAdditionalTransactionInformation enrichment with fetchGetWithinPage.
 */
import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';
import type { IScrapedTransaction } from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexTypes.js';
import { createDebugMock } from '../MockModuleFactories.js';

jest.unstable_mockModule('../../Common/Fetch.js', () => ({
  fetchGetWithinPage: jest.fn(),
}));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  fixInstallments: jest.fn((txns: unknown[]) => txns),
  filterOldTransactions: jest.fn((txns: unknown[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
}));

jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  /**
   * Execute actions sequentially.
   * @param actions - Array of async factories.
   * @returns Array of results.
   */
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
 * Build a test scraped transaction with defaults.
 * @param overrides - partial fields to merge.
 * @returns complete scraped transaction.
 */
function makeTxn(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
  return {
    dealSumType: '0',
    voucherNumberRatz: '111111111',
    voucherNumberRatzOutbound: '999999999',
    dealSumOutbound: 0,
    currencyId: 'ILS',
    currentPaymentCurrency: 'ILS',
    dealSum: 100,
    paymentSum: 100,
    paymentSumOutbound: 0,
    fullPurchaseDate: '15/06/2024',
    fullSupplierNameHeb: 'Store',
    fullSupplierNameOutbound: '',
    moreInfo: '',
    ...overrides,
  };
}

/**
 * Build scraper options with overrides.
 * @param overrides - partial option fields.
 * @returns complete scraper options.
 */
function makeOptions(overrides: Partial<ScraperOptions> = {}): ScraperOptions {
  return {
    companyId: 'isracard' as ScraperOptions['companyId'],
    startDate: new Date('2024-01-01'),
    ...overrides,
  } as ScraperOptions;
}

describe('getExtraScrapTransaction — null response', () => {
  const page = MOCK_HELPERS.createMockPage();
  const txnRaw = makeTxn();
  const baseTxn = TXN_CONVERT.buildTransaction(txnRaw, '2024-06-15T00:00:00.000Z');

  beforeEach(() => jest.clearAllMocks());

  it('returns original transaction when fetchGetWithinPage returns null', async () => {
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);
    const result = await ENRICH_MODULE.getExtraScrapTransaction({
      page: page as unknown as Page,
      options: { servicesUrl: 'https://example.com/api', companyCode: '11' },
      month: MOMENT_MODULE.default('2024-06-01'),
      accountIndex: 0,
      transaction: baseTxn,
    });
    expect(result).toBe(baseTxn);
  });
});

describe('fetchTransactionsForMonth — missing CardsTransactionsListBean', () => {
  const page = MOCK_HELPERS.createMockPage();

  beforeEach(() => jest.clearAllMocks());

  it('returns empty when CardsTransactionsListBean is missing', async () => {
    (FETCH_ISRACARD.fetchAccounts as jest.Mock).mockResolvedValueOnce([]);
    (FETCH_ISRACARD.fetchTxnData as jest.Mock).mockResolvedValueOnce({
      Header: { Status: '1' },
    });
    const opts = {
      page: page as unknown as Page,
      options: makeOptions(),
      companyServiceOptions: { servicesUrl: 'https://example.com', companyCode: '11' },
      startMoment: MOMENT_MODULE.default('2024-01-01'),
      monthMoment: MOMENT_MODULE.default('2024-06-01'),
    };
    const result = await ENRICH_MODULE.fetchTransactionsForMonth(opts);
    expect(result).toEqual({});
  });
});

describe('getAdditionalTransactionInformation — enrichment path', () => {
  const page = MOCK_HELPERS.createMockPage();

  beforeEach(() => jest.clearAllMocks());

  it('enriches when shouldAddTransactionInformation is true', async () => {
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValue({});
    const txnRaw = makeTxn();
    const txn = TXN_CONVERT.buildTransaction(txnRaw, '2024-06-15T00:00:00.000Z');
    const accountMap = { '1234': { accountNumber: '1234', index: 0, txns: [txn] } };
    const result = await ENRICH_MODULE.getAdditionalTransactionInformation({
      scraperOptions: makeOptions({ shouldAddTransactionInformation: true }),
      accountsWithIndex: [accountMap],
      page: page as unknown as Page,
      options: { servicesUrl: 'https://example.com', companyCode: '11' },
      allMonths: [MOMENT_MODULE.default('2024-06-01')],
    });
    expect(result).toHaveLength(1);
    const enriched = result[0];
    expect(enriched).toBeDefined();
    expect(enriched['1234']).toBeDefined();
    expect(enriched['1234'].txns).toHaveLength(1);
    expect(FETCH_MODULE.fetchGetWithinPage).toHaveBeenCalled();
  });
});
