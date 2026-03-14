import { jest } from '@jest/globals';

import type { IScrapedTransaction } from '../../Scrapers/Max/MaxScraper.js';
import { MAX_LOGIN_URL, MAX_SUCCESS_URL } from '../TestConstants.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule('../../Common/Fetch.js', () => ({
  fetchGetWithinPage: jest.fn(),
}));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),

  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue(MAX_SUCCESS_URL),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  fixInstallments: jest.fn(<T>(txns: T[]) => txns),
  filterOldTransactions: jest.fn(<T>(txns: T[]) => txns),
  sortTransactionsByDate: jest.fn(<T>(txns: T[]) => txns),
  getRawTransaction: jest.fn(
    (data: Record<string, string | number>): Record<string, string | number> => data,
  ),
}));

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mock Debug module.
   * @returns mocked debug exports
   */
  () => ({
    getDebug:
      /**
       * Debug factory.
       * @returns mock logger
       */
      (): Record<string, jest.Mock> => ({
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
  }),
);

// MOMENT is imported before the Dates mock references it, but jest.unstable_mockModule
// uses a lazy factory — MOMENT is already bound by the time the mock executes.
jest.unstable_mockModule('../../Common/Dates.js', () => ({
  default: jest.fn(() => [MOMENT('2024-06-01')]),
}));

const { default: MOMENT } = await import('moment');
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { elementPresentOnPage: ELEMENT_PRESENT } =
  await import('../../Common/ElementsInteractions.js');
const { fetchGetWithinPage: FETCH_GET } = await import('../../Common/Fetch.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { SHEKEL_CURRENCY } = await import('../../Constants.js');
const { ScraperErrorTypes: ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: MAX_SCRAPER } = await import('../../Scrapers/Max/MaxScraper.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');
const INTEGRATION = await import('../IntegrationHelpers.js');

const MOCK_CONTEXT = { newPage: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};
const CREDS = { username: 'testuser', password: 'testpass' };

/**
 * Mocks the categories API call.
 * @returns the fetch mock
 */
function mockCategories(): typeof FETCH_GET {
  (FETCH_GET as jest.Mock).mockResolvedValueOnce({
    result: [{ id: 1, name: 'מזון' }],
  });
  return FETCH_GET;
}

/**
 * Mocks a single month of transaction data.
 * @param txns - transactions to include
 * @returns the fetch mock
 */
function mockTxnMonth(txns: IScrapedTransaction[] = []): typeof FETCH_GET {
  (FETCH_GET as jest.Mock).mockResolvedValueOnce({
    result: { transactions: txns },
  });
  return FETCH_GET;
}

/**
 * Creates a raw Max transaction with sensible defaults.
 * @param overrides - fields to override
 * @returns a scraped transaction
 */
function rawTxn(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
  return {
    shortCardNumber: '4580',
    paymentDate: '2024-06-15',
    purchaseDate: '2024-06-10',
    actualPaymentAmount: '100',
    paymentCurrency: 376,
    originalCurrency: SHEKEL_CURRENCY,
    originalAmount: 100,
    planName: 'רגילה',
    planTypeId: 5,
    comments: '',
    merchantName: 'סופר שופ',
    categoryId: 1,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  const page = CREATE_MOCK_PAGE({
    url: jest.fn().mockReturnValue(MAX_SUCCESS_URL),
    waitForURL: jest.fn().mockResolvedValue(undefined),
  });
  MOCK_CONTEXT.newPage.mockResolvedValue(page);
  MOCK_CONTEXT.close.mockResolvedValue(undefined);
  MOCK_BROWSER.newContext.mockResolvedValue(MOCK_CONTEXT);
  MOCK_BROWSER.close.mockResolvedValue(undefined);
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(MAX_SUCCESS_URL);
  (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(false);
});

/**
 * Build multi-card transactions for the happy path test.
 * @returns array of scraped transactions across two cards.
 */
function buildHappyPathTxns(): IScrapedTransaction[] {
  return [
    rawTxn({
      shortCardNumber: '1111',
      originalAmount: 200,
      actualPaymentAmount: '200',
      merchantName: 'רמי לוי',
      categoryId: 1,
    }),
    rawTxn({
      shortCardNumber: '1111',
      originalAmount: 50,
      actualPaymentAmount: '50',
      merchantName: 'פוקס',
      categoryId: 1,
    }),
    rawTxn({
      shortCardNumber: '2222',
      originalAmount: 300,
      actualPaymentAmount: '300',
      merchantName: 'IKEA',
      categoryId: 1,
    }),
  ];
}

/**
 * Set up categories and multi-card transaction mocks for happy path test.
 * @returns true when mocks are configured.
 */
function setupHappyPathMocks(): boolean {
  mockCategories();
  const txns = buildHappyPathTxns();
  mockTxnMonth(txns);
  return true;
}

/**
 * Sort accounts by account number and return sorted array.
 * @param result - Scraper result.
 * @returns sorted accounts array.
 */
function sortedAccounts(
  result: Awaited<ReturnType<InstanceType<typeof MAX_SCRAPER>['scrape']>>,
): ReturnType<typeof INTEGRATION.assertSuccess> {
  const accounts = INTEGRATION.assertSuccess(result, 2);
  return [...accounts].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
}

/**
 * Assert first card (1111) has correct transactions.
 * @param sorted - Sorted accounts array.
 * @returns true when assertions pass.
 */
function assertFirstCard(sorted: ReturnType<typeof INTEGRATION.assertSuccess>): boolean {
  expect(sorted[0]?.accountNumber).toBe('1111');
  expect(sorted[0]?.txns).toHaveLength(2);
  expect(sorted[0]?.txns[0]?.originalAmount).toBe(-200);
  expect(sorted[0]?.txns[1]?.originalAmount).toBe(-50);
  return true;
}

/**
 * Assert second card (2222) has correct transactions.
 * @param sorted - Sorted accounts array.
 * @returns true when assertions pass.
 */
function assertSecondCard(sorted: ReturnType<typeof INTEGRATION.assertSuccess>): boolean {
  expect(sorted[1]?.accountNumber).toBe('2222');
  expect(sorted[1]?.txns).toHaveLength(1);
  expect(sorted[1]?.txns[0]?.originalAmount).toBe(-300);
  return true;
}

describe('integration: full scrape flow', () => {
  it('happy path: categories + transactions with card grouping and amounts', async () => {
    setupHappyPathMocks();

    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);

    const sorted = sortedAccounts(result);
    assertFirstCard(sorted);
    assertSecondCard(sorted);
  });

  it('invalid login: error popup returns InvalidPassword', async () => {
    const loginPage = CREATE_MOCK_PAGE({
      url: jest.fn().mockReturnValue(MAX_LOGIN_URL),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    });
    MOCK_CONTEXT.newPage.mockResolvedValue(loginPage);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(MAX_LOGIN_URL);
    (ELEMENT_PRESENT as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);

    INTEGRATION.assertFailure(result, ERROR_TYPES.InvalidPassword);
  });

  it('empty data: empty month responses with 0 txns', async () => {
    mockCategories();
    (FETCH_GET as jest.Mock).mockResolvedValueOnce({
      result: { transactions: [] },
    });

    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);

    INTEGRATION.assertEmptyTxns(result);
  });
});
