import { jest } from '@jest/globals';

import { LEUMI_LOGIN_URL, LEUMI_SUCCESS_URL } from '../TestConstants.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  pageEval: jest.fn().mockResolvedValue(LEUMI_LOGIN_URL),
  pageEvalAll: jest.fn().mockResolvedValue(''),

  elementPresentOnPage: jest.fn().mockResolvedValue(false),

  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue(LEUMI_SUCCESS_URL),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
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

const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { pageEval: PAGE_EVAL, pageEvalAll: PAGE_EVAL_ALL } =
  await import('../../Common/ElementsInteractions.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { ScraperErrorTypes: SCRAPER_ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: LEUMI_SCRAPER } = await import('../../Scrapers/Leumi/LeumiScraper.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_MOCK_SCRAPER_OPTIONS } =
  await import('../MockPage.js');
const INTEGRATION = await import('../IntegrationHelpers.js');

const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { username: 'testuser', password: 'testpass' };

/**
 * Creates a mock Leumi API response with optional data overrides.
 * @param overrides - fields to merge into the response JSON
 * @returns mock response object with json method
 */
function createLeumiResponse(overrides: Record<string, number | string | object[]> = {}): {
  json: jest.Mock;
} {
  return {
    json: jest.fn().mockResolvedValue({
      jsonResp: JSON.stringify({
        TodayTransactionsItems: [],
        HistoryTransactionsItems: [],
        ...overrides,
      }),
    }),
  };
}

/**
 * Create a mock goto response with ok=true, status=200.
 * @returns goto response mock
 */
function mockGotoResponse(): { ok: jest.Mock; status: jest.Mock } {
  return { ok: jest.fn().mockReturnValue(true), status: jest.fn().mockReturnValue(200) };
}

/**
 * Build Leumi page mock with account IDs and response.
 * @param accountIds - account ID list
 * @param response - mock response object
 * @param response.json - jest mock returning parsed JSON
 * @returns mock page overrides
 */
function buildLeumiPageMock(
  accountIds: string[],
  response: { json: jest.Mock },
): Record<string, jest.Mock> {
  const gotoRes = mockGotoResponse();
  return {
    evaluate: jest.fn().mockResolvedValue(accountIds),
    goto: jest.fn().mockResolvedValue(gotoRes),
    waitForResponse: jest.fn().mockResolvedValue(response),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    $$: jest.fn().mockResolvedValue([{ click: jest.fn() }]),
    focus: jest.fn().mockResolvedValue(undefined),
    $: jest.fn().mockResolvedValue(null),
  };
}

/**
 * Build default Leumi response with one history transaction.
 * @returns mock response for a standard Leumi page
 */
function buildDefaultLeumiResponse(): { json: jest.Mock } {
  const txn = {
    DateUTC: '2025-06-15T00:00:00',
    Amount: -100,
    Description: 'Test ITransaction',
    ReferenceNumberLong: 12345,
    AdditionalData: 'memo text',
  };
  return createLeumiResponse({
    BalanceDisplay: '5000.00',
    HistoryTransactionsItems: [txn],
  });
}

/**
 * Creates a mock Leumi page with default response data.
 * @param accountIds - list of account IDs to return from page.evaluate
 * @returns mock page object
 */
function createLeumiPage(accountIds: string[] = ['123/456']): ReturnType<typeof CREATE_MOCK_PAGE> {
  const response = buildDefaultLeumiResponse();
  const overrides = buildLeumiPageMock(accountIds, response);
  return CREATE_MOCK_PAGE(overrides);
}

beforeEach(() => {
  jest.clearAllMocks();
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const defaultPage = createLeumiPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(defaultPage);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(LEUMI_SUCCESS_URL);
  (PAGE_EVAL as jest.Mock).mockResolvedValue(LEUMI_LOGIN_URL);
  (PAGE_EVAL_ALL as jest.Mock).mockResolvedValue('');
});

describe('integration: full scrape flow', () => {
  it('happy path: account with pending + completed txns', async () => {
    const mockResponse = {
      json: jest.fn().mockResolvedValue({
        jsonResp: JSON.stringify({
          TodayTransactionsItems: [
            {
              DateUTC: '2025-07-01T00:00:00',
              Amount: -25,
              Description: 'Pending Purchase',
              ReferenceNumberLong: 100,
              AdditionalData: 'pending memo',
            },
          ],
          HistoryTransactionsItems: [
            {
              DateUTC: '2025-06-28T00:00:00',
              Amount: -200,
              Description: 'Completed Purchase',
              ReferenceNumberLong: 200,
              AdditionalData: 'completed memo',
            },
            {
              DateUTC: '2025-06-27T00:00:00',
              Amount: -75,
              Description: 'Another Completed',
              ReferenceNumberLong: 201,
              AdditionalData: '',
            },
          ],
          BalanceDisplay: '12345.67',
        }),
      }),
    };

    const page = createLeumiPage(['789/012']);
    page.waitForResponse.mockResolvedValue(mockResponse);
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    const accounts = INTEGRATION.assertSuccess(result, 1);
    expect(accounts[0].accountNumber).toBe('789_012');
    expect(accounts[0].txns).toHaveLength(3);
    expect(accounts[0].balance).toBe(12345.67);
  });

  it('invalid login: returns InvalidPassword for error message', async () => {
    const errorMsg =
      '\u05D0\u05D7\u05D3 \u05D0\u05D5 \u05D9\u05D5\u05EA\u05E8 ' +
      '\u05DE\u05E4\u05E8\u05D8\u05D9 \u05D4\u05D4\u05D6\u05D3\u05D4\u05D5\u05EA ' +
      '\u05E9\u05DE\u05E1\u05E8\u05EA \u05E9\u05D2\u05D5\u05D9\u05D9\u05DD. ' +
      '\u05E0\u05D9\u05EA\u05DF \u05DC\u05E0\u05E1\u05D5\u05EA \u05E9\u05D5\u05D1';
    (PAGE_EVAL_ALL as jest.Mock).mockResolvedValue(errorMsg);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(LEUMI_LOGIN_URL);

    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    INTEGRATION.assertFailure(result, SCRAPER_ERROR_TYPES.InvalidPassword);
  });

  it('empty data: succeeds with 0 transactions', async () => {
    (PAGE_EVAL_ALL as jest.Mock).mockResolvedValue('');
    const mockResponse = {
      json: jest.fn().mockResolvedValue({
        jsonResp: JSON.stringify({
          TodayTransactionsItems: [],
          HistoryTransactionsItems: [],
          BalanceDisplay: '0',
        }),
      }),
    };

    const page = createLeumiPage(['555/666']);
    page.waitForResponse.mockResolvedValue(mockResponse);
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    INTEGRATION.assertEmptyTxns(result);
  });
});
