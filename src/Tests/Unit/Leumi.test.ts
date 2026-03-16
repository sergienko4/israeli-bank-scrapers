import { jest } from '@jest/globals';
jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  pageEval: jest.fn().mockResolvedValue('https://hb2.bankleumi.co.il/login'),
  pageEvalAll: jest.fn().mockResolvedValue(''),

  elementPresentOnPage: jest.fn().mockResolvedValue(false),

  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://hb2.bankleumi.co.il/ebanking/SO/SPA.aspx'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),

  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),

  waitForRedirect: jest.fn().mockResolvedValue(undefined),

  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  getRawTransaction: jest.fn((data: Record<string, number>): Record<string, number> => data),
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

const { buildContextOptions: BUILD_CONTEXT_OPTIONS } = await import('../../Common/Browser.js');
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { pageEval: PAGE_EVAL } = await import('../../Common/ElementsInteractions.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { SHEKEL_CURRENCY } = await import('../../Constants.js');
const { ScraperErrorTypes: SCRAPER_ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: LEUMI_SCRAPER } = await import('../../Scrapers/Leumi/LeumiScraper.js');
const { TransactionStatuses: TX_STATUSES, TransactionTypes: TX_TYPES } =
  await import('../../Transactions.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_MOCK_SCRAPER_OPTIONS } =
  await import('../MockPage.js');

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
 * Creates a mock Leumi page with default response data.
 * @param accountIds - list of account IDs to return from page.evaluate
 * @returns mock page object
 */
function createLeumiPage(accountIds: string[] = ['123/456']): ReturnType<typeof CREATE_MOCK_PAGE> {
  const mockResponse = createLeumiResponse({
    BalanceDisplay: '5000.00',
    HistoryTransactionsItems: [
      {
        DateUTC: '2025-06-15T00:00:00',
        Amount: -100,
        Description: 'Test ITransaction',
        ReferenceNumberLong: 12345,
        AdditionalData: 'memo text',
      },
    ],
  });

  const locatorObj = {
    first: jest.fn().mockReturnValue({
      evaluate: jest.fn().mockResolvedValue('https://hb2.bankleumi.co.il/login'),
      waitFor: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
      innerText: jest.fn().mockResolvedValue(''),
      count: jest.fn().mockResolvedValue(1),
      getAttribute: jest.fn().mockResolvedValue(undefined),
    }),
    count: jest.fn().mockResolvedValue(1),
    all: jest.fn().mockResolvedValue([]),
    allInnerTexts: jest.fn().mockResolvedValue(accountIds),
  };

  return CREATE_MOCK_PAGE({
    evaluate: jest.fn().mockResolvedValue(accountIds),
    goto: jest.fn().mockResolvedValue({
      ok: jest.fn().mockReturnValue(true),
      status: jest.fn().mockReturnValue(200),
    }),
    waitForResponse: jest.fn().mockResolvedValue(mockResponse),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    focus: jest.fn().mockResolvedValue(undefined),
    $: jest.fn().mockResolvedValue(null),
    locator: jest.fn().mockReturnValue(locatorObj),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const defaultPage = createLeumiPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(defaultPage);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(
    'https://hb2.bankleumi.co.il/ebanking/SO/SPA.aspx',
  );
  (PAGE_EVAL as jest.Mock).mockResolvedValue('https://hb2.bankleumi.co.il/login');
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);
    if (!result.success) {
      const debugInfo = JSON.stringify({
        errorType: result.errorType,
        errorMessage: result.errorMessage?.substring(0, 200),
      });
      console.log('LEUMI FAILURE:', debugInfo);
    }

    expect(result.success).toBe(true);
    expect(BUILD_CONTEXT_OPTIONS).toHaveBeenCalled();
  });

  it('returns ChangePassword for authenticate URL', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://hb2.bankleumi.co.il/authenticate');

    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(SCRAPER_ERROR_TYPES.ChangePassword);
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions', async () => {
    const opts = CREATE_MOCK_SCRAPER_OPTIONS();
    const result = await new LEUMI_SCRAPER(opts).scrape(CREDS);
    const firstAccount = result.accounts?.[0];
    const firstTxn = firstAccount?.txns[0];

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(firstAccount?.accountNumber).toBe('123_456');
    expect(firstTxn).toMatchObject({
      originalAmount: -100,
      originalCurrency: SHEKEL_CURRENCY,
      type: TX_TYPES.Normal,
      status: TX_STATUSES.Completed,
      description: 'Test ITransaction',
      memo: 'memo text',
      identifier: 12345,
    });
  });

  it('separates pending and completed transactions', async () => {
    const mockResponse = {
      json: jest.fn().mockResolvedValue({
        jsonResp: JSON.stringify({
          TodayTransactionsItems: [
            {
              DateUTC: '2025-06-15T00:00:00',
              Amount: -50,
              Description: 'Pending',
              ReferenceNumberLong: 1,
            },
          ],
          HistoryTransactionsItems: [
            {
              DateUTC: '2025-06-14T00:00:00',
              Amount: -100,
              Description: 'Completed',
              ReferenceNumberLong: 2,
            },
          ],
        }),
      }),
    };

    const page = createLeumiPage();
    page.waitForResponse.mockResolvedValue(mockResponse);
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    const pending = result.accounts?.[0]?.txns.find(txn => txn.status === TX_STATUSES.Pending);
    const completed = result.accounts?.[0]?.txns.find(txn => txn.status === TX_STATUSES.Completed);
    expect(pending).toBeDefined();
    expect(completed).toBeDefined();
    expect(pending?.description).toBe('Pending');
    expect(completed?.description).toBe('Completed');
  });

  it('handles empty transaction arrays', async () => {
    const mockResponse = {
      json: jest.fn().mockResolvedValue({
        jsonResp: JSON.stringify({
          TodayTransactionsItems: null,
          HistoryTransactionsItems: [],
        }),
      }),
    };

    const page = createLeumiPage();
    page.waitForResponse.mockResolvedValue(mockResponse);
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns).toHaveLength(0);
  });

  it('throws on empty account IDs', async () => {
    const page = createLeumiPage([]);
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Failed to extract');
  });

  it('extracts balance from response', async () => {
    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.balance).toBe(5000);
  });

  it('removes special characters from account ID', async () => {
    const page = createLeumiPage(['123&/456']);
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.accountNumber).toBe('123_456');
  });

  it('includes rawTransaction when option set', async () => {
    const options = CREATE_MOCK_SCRAPER_OPTIONS({ includeRawTransaction: true });
    const scraper = new LEUMI_SCRAPER(options);
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns[0]?.rawTransaction).toBeDefined();
  });

  it('handles multiple accounts with clicking', async () => {
    const page = createLeumiPage(['111/222', '333/444']);
    const responseData = createLeumiResponse({
      HistoryTransactionsItems: [
        {
          DateUTC: '2025-06-15T00:00:00',
          Amount: -100,
          Description: 'Txn',
          ReferenceNumberLong: 1,
        },
      ],
      BalanceDisplay: '3000.00',
    });
    page.waitForResponse.mockResolvedValue(responseData);
    page.waitForSelector.mockResolvedValue(undefined);
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts?.[0]?.accountNumber).toBe('111_222');
    expect(result.accounts?.[1]?.accountNumber).toBe('333_444');
  });

  it('handles undefined balance gracefully', async () => {
    const page = createLeumiPage();
    const emptyResponse = createLeumiResponse();
    page.waitForResponse.mockResolvedValue(emptyResponse);
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.balance).toBeUndefined();
  });

  it('uses empty string for missing description and memo', async () => {
    const responseData = createLeumiResponse({
      HistoryTransactionsItems: [{ DateUTC: '2025-06-15T00:00:00', Amount: -50 }],
      BalanceDisplay: '1000.00',
    });
    const page = createLeumiPage();
    page.waitForResponse.mockResolvedValue(responseData);
    MOCK_CONTEXT.newPage.mockResolvedValue(page);

    const scraper = new LEUMI_SCRAPER(CREATE_MOCK_SCRAPER_OPTIONS());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns[0]?.description).toBe('');
    expect(result.accounts?.[0]?.txns[0]?.memo).toBe('');
  });
});
