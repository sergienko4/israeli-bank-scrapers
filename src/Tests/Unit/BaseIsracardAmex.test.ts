import { jest } from '@jest/globals';

import type { ScraperOptions } from '../../Scrapers/Base/Interface.js';
import type { IScrapedTransaction } from '../../Scrapers/BaseIsracardAmex/BaseIsracardAmexTypes.js';
import type { ITransaction } from '../../Transactions.js';
import MockTimeoutError from '../Mocks/MockTimeoutError.js';

/**
 * Create a mock that resolves to the given value.
 * @param resolvedValue - The value to resolve.
 * @returns Mocked function.
 */
const MOCK_RESOLVED = (resolvedValue?: unknown): jest.Mock =>
  jest.fn().mockResolvedValue(resolvedValue);

/**
 * Create a mock logger with all levels.
 * @returns Mock logger with trace/debug/info/warn/error.
 */
const MOCK_LOGGER = (): Record<string, jest.Mock> => ({
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));
jest.unstable_mockModule('../../Common/Fetch.js', () => ({
  fetchGetWithinPage: jest.fn(),
  fetchPostWithinPage: jest.fn(),
}));
jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: MOCK_RESOLVED(),
  humanDelay: MOCK_RESOLVED(),
  runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const seed = Promise.resolve([] as T[]);
    return actions.reduce(
      (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
      seed,
    );
  }),
  waitUntil: MOCK_RESOLVED(),
  raceTimeout: MOCK_RESOLVED(),
  TimeoutError: MockTimeoutError,
  SECOND: 1000,
}));
jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  fixInstallments: jest.fn((txns: ITransaction[]) => txns),
  filterOldTransactions: jest.fn((txns: ITransaction[]) => txns),
  getRawTransaction: jest.fn((data: Record<string, number>): Record<string, number> => data),
}));
jest.unstable_mockModule('../../Common/Debug.js', () => ({ getDebug: MOCK_LOGGER }));
jest.unstable_mockModule('../../Common/Dates.js', () => ({
  default: jest.fn(() => [MOMENT('2024-06-01')]),
}));
const { faker: FAKER } = await import('@faker-js/faker');
const { default: MOMENT } = await import('moment');
const { buildContextOptions: BUILD_CONTEXT_OPTIONS } = await import('../../Common/Browser.js');
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { fetchGetWithinPage: FETCH_GET, fetchPostWithinPage: FETCH_POST } =
  await import('../../Common/Fetch.js');
const { filterOldTransactions: FILTER_OLD, fixInstallments: FIX_INSTALLMENTS } =
  await import('../../Common/Transactions.js');
const { SHEKEL_CURRENCY } = await import('../../Constants.js');
const { ScraperProgressTypes: PROGRESS_TYPES } = await import('../../Definitions.js');
const { ScraperErrorTypes: ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: ISRACARD_AMEX_BASE } =
  await import('../../Scrapers/BaseIsracardAmex/BaseIsracardAmex.js');
const { TransactionStatuses: TX_STATUSES, TransactionTypes: TX_TYPES } =
  await import('../../Transactions.js');
const { HEBREW_MERCHANTS } = await import('../HebrewBankingFixtures.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');

const BASE_URL = 'https://americanexpress.co.il';
/** Test-only Amex scraper subclass for unit testing. */
class TestAmexScraper extends ISRACARD_AMEX_BASE {
  /**
   * Creates a test scraper with optional overrides.
   * @param overrides - scraper option overrides
   */
  constructor(overrides: Partial<ScraperOptions> = {}) {
    const opts = CREATE_OPTS(overrides);
    super(opts, BASE_URL, '77');
  }
}
const MOCK_CONTEXT = { newPage: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};
const CREDS = { id: '123456789', password: 'pass123', card6Digits: '123456' };
/**
 * Mocks validate-credentials API.
 * @param returnCode - validation return code
 * @param userName - user name in response
 * @returns the fetch mock
 */
function mockValidate(returnCode = '1', userName = 'TestUser'): typeof FETCH_POST {
  (FETCH_POST as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    ValidateIdDataBean: { returnCode, userName },
  });
  return FETCH_POST;
}
/**
 * Mocks the login API.
 * @param status - login status code
 * @returns the fetch mock
 */
function mockLogin(status = '1'): typeof FETCH_POST {
  (FETCH_POST as jest.Mock).mockResolvedValueOnce({ status });
  return FETCH_POST;
}
/**
 * Mocks accounts/dashboard API.
 * @param cardNumber - card number to return
 * @returns the fetch mock
 */
function mockAccounts(cardNumber = '1234'): typeof FETCH_GET {
  (FETCH_GET as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    DashboardMonthBean: {
      cardsCharges: [{ cardIndex: '0', cardNumber, billingDate: '15/06/2024' }],
    },
  });
  return FETCH_GET;
}
/**
 * Mocks the transactions API with Israel and abroad groups.
 * @param txnIsrael - domestic transactions
 * @param txnAbroad - international transactions
 * @returns the fetch mock
 */
function mockTxns(
  txnIsrael: IScrapedTransaction[] = [],
  txnAbroad: IScrapedTransaction[] = [],
): typeof FETCH_GET {
  const groups = { ...(txnIsrael.length && { txnIsrael }), ...(txnAbroad.length && { txnAbroad }) };
  (FETCH_GET as jest.Mock).mockResolvedValueOnce({
    Header: { Status: '1' },
    CardsTransactionsListBean: { Index0: { CurrentCardTransactions: [groups] } },
  });
  return FETCH_GET;
}
/**
 * Sets up validate and login mocks for successful login.
 * @returns the mock refs
 */
function setupFullLogin(): typeof FETCH_POST {
  mockValidate('1');
  return mockLogin('1');
}

/**
 * Sets up full login, accounts, and transactions mocks.
 * @param txns - Transactions to mock.
 * @param cardNumber - Card number to return.
 * @returns True when setup complete.
 */
function setupFullScrape(txns: IScrapedTransaction[] = [], cardNumber = '1234'): true {
  setupFullLogin();
  mockAccounts(cardNumber);
  mockTxns(txns);
  return true;
}
/**
 * Creates a fake transaction with randomized data.
 * @param overrides - fields to override
 * @returns a scraped transaction
 */
function txn(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
  const amount = FAKER.number.float({ min: 10, max: 5000, fractionDigits: 2 });
  const recentDate = FAKER.date.recent({ days: 365 });
  return {
    dealSumType: '0',
    voucherNumberRatz: FAKER.string.numeric(9),
    voucherNumberRatzOutbound: FAKER.string.numeric(9),
    dealSumOutbound: 0,
    currencyId: 'ש"ח',
    currentPaymentCurrency: 'ש"ח',
    dealSum: amount,
    paymentSum: amount,
    paymentSumOutbound: 0,
    fullPurchaseDate: MOMENT(recentDate).format('DD/MM/YYYY'),
    fullSupplierNameHeb: FAKER.helpers.arrayElement([...HEBREW_MERCHANTS]),
    fullSupplierNameOutbound: '',
    moreInfo: '',
    ...overrides,
  };
}

beforeEach(() => {
  FAKER.seed(42);
  jest.clearAllMocks();
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const defaultPage = CREATE_MOCK_PAGE();
  MOCK_CONTEXT.newPage.mockResolvedValue(defaultPage);
});

/**
 * Assert a scrape attempt fails with the expected error type.
 * @param errorType - The expected error type.
 * @returns The scraper result for further assertions.
 */
async function expectLoginError(errorType: string): Promise<true> {
  const result = await new TestAmexScraper().scrape(CREDS);
  expect(result.success).toBe(false);
  expect(result.errorType).toBe(errorType);
  return true;
}

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    setupFullScrape();
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(true);
    expect(BUILD_CONTEXT_OPTIONS).toHaveBeenCalled();
  });
  it('returns ChangePassword when returnCode=4', async () => {
    mockValidate('4');
    await expectLoginError(ERROR_TYPES.ChangePassword);
  });
  it('returns InvalidPassword when returnCode is unknown', async () => {
    mockValidate('99');
    await expectLoginError(ERROR_TYPES.InvalidPassword);
  });
  it('returns ChangePassword when login status=3', async () => {
    mockValidate('1');
    mockLogin('3');
    await expectLoginError(ERROR_TYPES.ChangePassword);
  });
  it('returns InvalidPassword when login status is unknown', async () => {
    mockValidate('1');
    mockLogin('9');
    await expectLoginError(ERROR_TYPES.InvalidPassword);
  });
  it('returns WafBlocked error when validateCredentials returns null', async () => {
    (FETCH_POST as jest.Mock).mockResolvedValueOnce(null);
    await expectLoginError(ERROR_TYPES.WafBlocked);
  });
  it('returns WafBlocked when validate Header.Status is not 1', async () => {
    (FETCH_POST as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });
    await expectLoginError(ERROR_TYPES.WafBlocked);
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions', async () => {
    setupFullScrape([txn({ dealSum: 250, fullSupplierNameHeb: 'רמי לוי' })], '4580-1234');
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts?.[0]?.accountNumber).toBe('4580-1234');
    expect(result.accounts?.[0]?.txns[0]).toMatchObject({
      originalAmount: -250,
      description: 'רמי לוי',
      originalCurrency: SHEKEL_CURRENCY,
      status: TX_STATUSES.Completed,
      type: TX_TYPES.Normal,
    });
  });
  it('handles abroad transactions', async () => {
    setupFullLogin();
    mockAccounts();
    mockTxns(
      [],
      [
        txn({
          dealSumOutbound: 1,
          fullPurchaseDateOutbound: '10/06/2024',
          fullSupplierNameOutbound: 'Amazon US',
          currentPaymentCurrency: 'USD',
          currencyId: 'USD',
          paymentSumOutbound: 50,
        }),
      ],
    );
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]).toMatchObject({
      description: 'Amazon US',
      originalCurrency: 'USD',
      chargedAmount: -50,
    });
  });
  it('detects installment transactions', async () => {
    setupFullScrape([txn({ moreInfo: 'תשלום 3 מתוך 12' })]);
    const result = await new TestAmexScraper().scrape(CREDS);
    const firstTxn = result.accounts?.[0]?.txns[0];
    expect(firstTxn?.type).toBe(TX_TYPES.Installments);
    expect(firstTxn?.installments).toEqual({ number: 3, total: 12 });
  });
  it('filters dealSumType=1 transactions', async () => {
    setupFullScrape([txn({ dealSumType: '1' }), txn()]);
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.accounts?.[0]?.txns).toHaveLength(1);
  });
  it('filters zero voucher numbers', async () => {
    setupFullScrape([
      txn({ voucherNumberRatz: '000000000', voucherNumberRatzOutbound: '000000000' }),
    ]);
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.accounts?.[0]?.txns).toHaveLength(0);
  });
  it('returns empty when Header.Status is not 1', async () => {
    setupFullLogin();
    (FETCH_GET as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });
    (FETCH_GET as jest.Mock).mockResolvedValueOnce({ Header: { Status: '0' } });
    const result = await new TestAmexScraper().scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });
  it('calls fixInstallments when shouldCombineInstallments=false', async () => {
    setupFullScrape([txn()]);
    await new TestAmexScraper({ shouldCombineInstallments: false }).scrape(CREDS);
    expect(FIX_INSTALLMENTS).toHaveBeenCalled();
  });
  it('skips fixInstallments when shouldCombineInstallments=true', async () => {
    setupFullScrape([txn()]);
    await new TestAmexScraper({ shouldCombineInstallments: true }).scrape(CREDS);
    expect(FIX_INSTALLMENTS).not.toHaveBeenCalled();
  });
  it('calls filterOldTransactions by default', async () => {
    setupFullScrape([txn()]);
    await new TestAmexScraper().scrape(CREDS);
    expect(FILTER_OLD).toHaveBeenCalled();
  });
  it('applies rate limiting via page.waitForTimeout', async () => {
    setupFullScrape([txn()]);
    const scraper = new TestAmexScraper();
    await scraper.scrape(CREDS);
    const defaultPage = (await MOCK_CONTEXT.newPage.mock.results[0].value) as ReturnType<
      typeof CREATE_MOCK_PAGE
    >;
    expect(defaultPage.waitForTimeout).toHaveBeenCalled();
  });
  it('includes rawTransaction when option set', async () => {
    setupFullScrape([txn()]);
    const result = await new TestAmexScraper({ includeRawTransaction: true }).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.rawTransaction).toBeDefined();
  });
});
/**
 * Scrape with progress event capture.
 * @param scraper - The scraper instance.
 * @returns Captured event types.
 */
async function scrapeWithEvents(scraper: TestAmexScraper): Promise<string[]> {
  const events: string[] = [];
  scraper.onProgress((_id, payload) => {
    events.push(payload.type);
    return true;
  });
  await scraper.scrape(CREDS);
  return events;
}

describe('progress events', () => {
  it('emits LoggingIn+LoginSuccess on success, LoginFailed on failure', async () => {
    setupFullScrape();
    const successEvents = await scrapeWithEvents(new TestAmexScraper());
    expect(successEvents).toContain(PROGRESS_TYPES.LoggingIn);
    expect(successEvents).toContain(PROGRESS_TYPES.LoginSuccess);
    mockValidate('99');
    const failEvents = await scrapeWithEvents(new TestAmexScraper());
    expect(failEvents).toContain(PROGRESS_TYPES.LoginFailed);
  });
});
