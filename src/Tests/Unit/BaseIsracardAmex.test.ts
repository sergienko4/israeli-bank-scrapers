import { faker } from '@faker-js/faker';
import moment from 'moment';
import { chromium } from 'playwright-extra';

import { buildContextOptions } from '../../Common/Browser';
import { fetchGetWithinPage, fetchPostWithinPage } from '../../Common/Fetch';
import { filterOldTransactions, fixInstallments } from '../../Common/Transactions';
import { sleep } from '../../Common/Waiting';
import { SHEKEL_CURRENCY } from '../../Constants';
import { ScraperProgressTypes } from '../../Definitions';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import type { ScrapedTransaction } from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexTypes';
import { type Transaction, TransactionStatuses, TransactionTypes } from '../../Transactions';
import { HEBREW_MERCHANTS } from '../HebrewBankingFixtures';
import { createMockPage } from '../MockPage';
import TestAmexScraper from './BaseIsracardAmexTestHelpers';

jest.mock('playwright-extra', () => ({ chromium: { launch: jest.fn(), use: jest.fn() } }));
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn());
jest.mock('../../Common/Fetch', () => ({
  fetchGetWithinPage: jest.fn(),
  fetchPostWithinPage: jest.fn(),
}));
jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../../Common/Waiting', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    let acc = Promise.resolve([]) as Promise<T[]>;
    for (const action of actions) acc = acc.then(async r => [...r, await action()]);
    return acc;
  }),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));
jest.mock('../../Common/Transactions', () => ({
  fixInstallments: jest.fn((txns: Transaction[]) => txns),
  filterOldTransactions: jest.fn((txns: Transaction[]) => txns),
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
jest.mock('../../Common/Dates', () => jest.fn(() => [moment('2024-06-01')]));

const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { id: '123456789', password: 'pass123', card6Digits: '123456' };

/**
 * Mocks a validate response.
 *
 * @param returnCode - the return code in ValidateIdDataBean
 * @param userName - the user name in ValidateIdDataBean
 */
function mockValidate(returnCode = '1', userName = 'TestUser'): void {
  (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    ValidateIdDataBean: { returnCode, userName },
  });
}

/**
 * Mocks a login response.
 *
 * @param status - the login status code
 */
function mockLogin(status = '1'): void {
  (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({ status });
}

/**
 * Mocks a dashboard accounts response.
 *
 * @param cardNumber - the card number to return
 */
function mockAccounts(cardNumber = '1234'): void {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    DashboardMonthBean: {
      cardsCharges: [{ cardIndex: '0', cardNumber, billingDate: '15/06/2024' }],
    },
  });
}

/**
 * Mocks a transactions response.
 *
 * @param txnIsrael - Israel transactions
 * @param txnAbroad - abroad transactions
 */
function mockTxns(
  txnIsrael: ScrapedTransaction[] = [],
  txnAbroad: ScrapedTransaction[] = [],
): void {
  const txnGroups: { txnIsrael?: ScrapedTransaction[]; txnAbroad?: ScrapedTransaction[] } = {};
  if (txnIsrael.length) txnGroups.txnIsrael = txnIsrael;
  if (txnAbroad.length) txnGroups.txnAbroad = txnAbroad;
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    CardsTransactionsListBean: {
      Index0: { CurrentCardTransactions: [txnGroups] },
    },
  });
}

/**
 * Configures mocks for a successful validate + login sequence.
 */
function setupFullLogin(): void {
  mockValidate('1');
  mockLogin('1');
}

/**
 * Creates a fake ScrapedTransaction with randomized values.
 *
 * @param overrides - partial fields to override generated defaults
 * @returns a complete ScrapedTransaction
 */
function txn(overrides: Partial<ScrapedTransaction> = {}): ScrapedTransaction {
  const amount = faker.number.float({ min: 10, max: 5000, fractionDigits: 2 });
  const recentDate = faker.date.recent({ days: 365 });
  const fullPurchaseDate = moment(recentDate).format('DD/MM/YYYY');
  return {
    dealSumType: '0',
    voucherNumberRatz: faker.string.numeric(9),
    voucherNumberRatzOutbound: faker.string.numeric(9),
    dealSumOutbound: false,
    currencyId: 'ש"ח',
    currentPaymentCurrency: 'ש"ח',
    dealSum: amount,
    paymentSum: amount,
    paymentSumOutbound: 0,
    fullPurchaseDate,
    fullSupplierNameHeb: faker.helpers.arrayElement([...HEBREW_MERCHANTS]),
    fullSupplierNameOutbound: '',
    moreInfo: '',
    ...overrides,
  };
}

beforeEach(() => {
  faker.seed(42);
  jest.clearAllMocks();
  (chromium.launch as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const freshPage = createMockPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(freshPage);
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    mockValidate('1');
    mockLogin('1');
    const scraper = new TestAmexScraper();
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });

  it('returns ChangePassword when returnCode=4', async () => {
    mockValidate('4');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });

  it('returns InvalidPassword when returnCode is unknown', async () => {
    mockValidate('99');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('returns ChangePassword when login status=3', async () => {
    mockValidate('1');
    mockLogin('3');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });

  it('returns InvalidPassword when login status is unknown', async () => {
    mockValidate('1');
    mockLogin('9');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('returns WafBlocked with details when validateCredentials returns null', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce(null);
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
    expect(result.errorMessage).toContain('WAF blocked');
    expect(result.errorDetails).toBeDefined();
    expect(result.errorDetails?.suggestions.length).toBeGreaterThan(0);
  });

  it('returns WafBlocked when validate Header.Status is not 1', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.WafBlocked);
    expect(result.errorDetails).toBeDefined();
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions', async () => {
    setupFullLogin();
    mockAccounts('4580-1234');
    mockTxns([txn({ dealSum: 250, fullSupplierNameHeb: 'רמי לוי' })]);

    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect((result.accounts ?? [])[0].accountNumber).toBe('4580-1234');

    const t = (result.accounts ?? [])[0].txns[0];
    expect(t.originalAmount).toBe(-250);
    expect(t.description).toBe('רמי לוי');
    expect(t.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(t.status).toBe(TransactionStatuses.Completed);
    expect(t.type).toBe(TransactionTypes.Normal);
  });

  it('handles abroad transactions', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns(
      [],
      [
        txn({
          dealSumOutbound: true,
          fullPurchaseDateOutbound: '10/06/2024',
          fullSupplierNameOutbound: 'Amazon US',
          currentPaymentCurrency: 'USD',
          currencyId: 'USD',
          paymentSumOutbound: 50,
        }),
      ],
    );

    const result = await new TestAmexScraper().scrape(CREDS);
    const t = (result.accounts ?? [])[0].txns[0];
    expect(t.description).toBe('Amazon US');
    expect(t.originalCurrency).toBe('USD');
    expect(t.chargedAmount).toBe(-50);
  });

  it('detects installment transactions', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn({ moreInfo: 'תשלום 3 מתוך 12' })]);

    const result = await new TestAmexScraper().scrape(CREDS);
    const t = (result.accounts ?? [])[0].txns[0];
    expect(t.type).toBe(TransactionTypes.Installments);
    expect(t.installments).toEqual({ number: 3, total: 12 });
  });

  it('filters dealSumType=1 transactions', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn({ dealSumType: '1' }), txn()]);

    const result = await new TestAmexScraper().scrape(CREDS);
    expect((result.accounts ?? [])[0].txns).toHaveLength(1);
  });

  it('filters zero voucher numbers', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn({ voucherNumberRatz: '000000000', voucherNumberRatzOutbound: '000000000' })]);

    const result = await new TestAmexScraper().scrape(CREDS);
    expect((result.accounts ?? [])[0].txns).toHaveLength(0);
  });

  it('returns empty when Header.Status is not 1', async () => {
    setupFullLogin();
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });

    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('calls fixInstallments when shouldCombineInstallments=false', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn()]);

    await new TestAmexScraper({ shouldCombineInstallments: false }).scrape(CREDS);
    expect(fixInstallments).toHaveBeenCalled();
  });

  it('skips fixInstallments when shouldCombineInstallments=true', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn()]);

    await new TestAmexScraper({ shouldCombineInstallments: true }).scrape(CREDS);
    expect(fixInstallments).not.toHaveBeenCalled();
  });

  it('calls filterOldTransactions by default', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn()]);

    await new TestAmexScraper().scrape(CREDS);
    expect(filterOldTransactions).toHaveBeenCalled();
  });

  it('applies rate limiting', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn()]);

    await new TestAmexScraper().scrape(CREDS);
    expect(sleep).toHaveBeenCalled();
  });

  it('includes rawTransaction when option set', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([txn()]);

    const result = await new TestAmexScraper({ includeRawTransaction: true }).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });
});

describe('progress events', () => {
  it('emits LoggingIn and LoginSuccess', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns([]);
    const events: ScraperProgressTypes[] = [];
    const scraper = new TestAmexScraper();
    scraper.onProgress((_id, payload) => events.push(payload.type));
    await scraper.scrape(CREDS);
    expect(events).toContain(ScraperProgressTypes.LoggingIn);
    expect(events).toContain(ScraperProgressTypes.LoginSuccess);
  });

  it('emits LoginFailed on invalid password', async () => {
    mockValidate('99');
    const events: ScraperProgressTypes[] = [];
    const scraper = new TestAmexScraper();
    scraper.onProgress((_id, payload) => events.push(payload.type));
    await scraper.scrape(CREDS);
    expect(events).toContain(ScraperProgressTypes.LoginFailed);
  });
});
