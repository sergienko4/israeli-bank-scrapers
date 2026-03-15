import { jest } from '@jest/globals';

import type { IScrapedTransaction } from '../../Scrapers/Max/MaxScraper.js';
import {
  createBrowserMock,
  createCamoufoxMock,
  createDebugMock,
  createElementsMock,
  createFetchMock,
  createNavigationMock,
  createTransactionsMock,
} from '../MockModuleFactories.js';
import { CREDS_USERNAME_PASSWORD, MAX_LOGIN_URL, MAX_SUCCESS_URL } from '../TestConstants.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', createCamoufoxMock);
jest.unstable_mockModule('../../Common/Fetch.js', () => {
  const { fetchGetWithinPage } = createFetchMock();
  return { fetchGetWithinPage };
});
jest.unstable_mockModule('../../Common/Browser.js', createBrowserMock);
jest.unstable_mockModule('../../Common/ElementsInteractions.js', createElementsMock);
jest.unstable_mockModule('../../Common/Navigation.js', () => createNavigationMock(MAX_SUCCESS_URL));
jest.unstable_mockModule('../../Common/Transactions.js', createTransactionsMock);
jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

// MOMENT is imported after this mock declaration, but jest.unstable_mockModule
// uses a lazy factory — MOMENT will be bound by the time the factory executes.
jest.unstable_mockModule('../../Common/Dates.js', () => ({
  default: jest.fn(() => [MOMENT('2024-06-01')]),
}));

const { default: MOMENT } = await import('moment');
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
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
const CREDS = CREDS_USERNAME_PASSWORD;

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

/** Default values for a raw Max transaction. */
const RAW_TXN_DEFAULTS: IScrapedTransaction = {
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
};

/**
 * Creates a raw Max transaction with sensible defaults.
 * @param overrides - fields to override
 * @returns a scraped transaction
 */
function rawTxn(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
  return { ...RAW_TXN_DEFAULTS, ...overrides };
}

/**
 * Create a default Max page mock with success URL.
 * @returns mock page
 */
function createMaxPage(): ReturnType<typeof CREATE_MOCK_PAGE> {
  return CREATE_MOCK_PAGE({
    url: jest.fn().mockReturnValue(MAX_SUCCESS_URL),
    waitForURL: jest.fn().mockResolvedValue(undefined),
  });
}

/**
 * Wire browser/context/page mocks for each test.
 * @returns true when configured.
 */
function resetBrowserMocks(): boolean {
  const page = createMaxPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(page);
  MOCK_CONTEXT.close.mockResolvedValue(undefined);
  MOCK_BROWSER.newContext.mockResolvedValue(MOCK_CONTEXT);
  MOCK_BROWSER.close.mockResolvedValue(undefined);
  return true;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetBrowserMocks();
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(MAX_SUCCESS_URL);
});

/**
 * Build multi-card transactions for the happy path test.
 * @returns array of scraped transactions across two cards.
 */
function buildHappyPathTxns(): IScrapedTransaction[] {
  const overrides = [
    { shortCardNumber: '1111', originalAmount: 200, merchantName: 'רמי לוי' },
    { shortCardNumber: '1111', originalAmount: 50, merchantName: 'פוקס' },
    { shortCardNumber: '2222', originalAmount: 300, merchantName: 'IKEA' },
  ];
  return overrides.map(d =>
    rawTxn({ ...d, actualPaymentAmount: String(d.originalAmount), categoryId: 1 }),
  );
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
    const errorLocator = {
      isVisible: jest.fn().mockResolvedValue(true),
      waitFor: jest.fn().mockResolvedValue(undefined),
      click: jest.fn(),
      first: jest.fn(),
    };
    errorLocator.first.mockReturnValue(errorLocator);
    const loginPage = CREATE_MOCK_PAGE({
      url: jest.fn().mockReturnValue(MAX_LOGIN_URL),
      waitForURL: jest.fn().mockResolvedValue(undefined),
      getByText: jest.fn().mockReturnValue(errorLocator),
      getByRole: jest
        .fn()
        .mockReturnValue({ isVisible: jest.fn().mockResolvedValue(false), click: jest.fn() }),
    });
    MOCK_CONTEXT.newPage.mockResolvedValue(loginPage);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(MAX_LOGIN_URL);

    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);

    INTEGRATION.assertFailure(result, ERROR_TYPES.InvalidPassword);
  });

  it('empty data: null result from month API with 0 txns', async () => {
    mockCategories();
    (FETCH_GET as jest.Mock).mockResolvedValueOnce({ result: null });

    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);

    INTEGRATION.assertEmptyTxns(result);
  });
});
