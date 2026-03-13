import { jest } from '@jest/globals';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule(
  '../../Common/Fetch.js',
  /**
   * Mock Fetch.
   * @returns Mocked module.
   */
  () => ({ fetchGetWithinPage: jest.fn() }),
);

jest.unstable_mockModule(
  '../../Common/Browser.js',
  /**
   * Mock Browser.
   * @returns Mocked module.
   */
  () => ({ buildContextOptions: jest.fn().mockReturnValue({}) }),
);

jest.unstable_mockModule(
  '../../Common/ElementsInteractions.js',
  /**
   * Mock ElementsInteractions.
   * @returns Mocked module.
   */
  () => ({
    clickButton: jest.fn().mockResolvedValue(undefined),
    fillInput: jest.fn().mockResolvedValue(undefined),
    waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
    elementPresentOnPage: jest.fn().mockResolvedValue(false),
    capturePageText: jest.fn().mockResolvedValue(''),
  }),
);

jest.unstable_mockModule(
  '../../Common/Navigation.js',
  /**
   * Mock Navigation.
   * @returns Mocked module.
   */
  () => ({
    getCurrentUrl: jest.fn().mockResolvedValue('https://www.max.co.il/homepage/personal'),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    waitForRedirect: jest.fn().mockResolvedValue(undefined),
    waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
    waitForUrl: jest.fn().mockResolvedValue(undefined),
  }),
);

jest.unstable_mockModule(
  '../../Common/Transactions.js',
  /**
   * Mock Transactions.
   * @returns Mocked module.
   */
  () => ({
    fixInstallments: jest.fn(<T>(txns: T[]) => txns),
    filterOldTransactions: jest.fn(<T>(txns: T[]) => txns),
    sortTransactionsByDate: jest.fn(<T>(txns: T[]) => txns),
    getRawTransaction: jest.fn((d: Record<string, number>) => d),
  }),
);

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mock Debug.
   * @returns Mocked module.
   */
  () => ({
    /**
     * Debug factory returning mock logger.
     * @returns Mock logger with all levels.
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
  }),
);

jest.unstable_mockModule(
  '../../Common/Dates.js',
  /**
   * Mock Dates.
   * @returns Mocked module.
   */
  () => ({ default: jest.fn(() => [MOMENT('2024-06-01')]) }),
);

jest.unstable_mockModule(
  '../../Common/Waiting.js',
  /**
   * Mock Waiting.
   * @returns Mocked module.
   */
  () => ({
    sleep: jest.fn().mockResolvedValue(undefined),
    humanDelay: jest.fn().mockResolvedValue(undefined),
    runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
      const seed = Promise.resolve([] as T[]);
      return actions.reduce(
        (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
        seed,
      );
    }),
    waitUntil: jest.fn().mockResolvedValue(undefined),
    raceTimeout: jest.fn().mockResolvedValue(undefined),
    TimeoutError: Error,
    SECOND: 1000,
  }),
);

const { default: MOMENT } = await import('moment');
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { fetchGetWithinPage: FETCH_GET } = await import('../../Common/Fetch.js');
const { elementPresentOnPage: ELEMENT_PRESENT } =
  await import('../../Common/ElementsInteractions.js');
const { default: MAX_SCRAPER } = await import('../../Scrapers/Max/MaxScraper.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');

const MOCK_CONTEXT = { newPage: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

/**
 * Mock the categories and an empty transaction month.
 * @returns True when setup complete.
 */
function mockFetchData(): boolean {
  (FETCH_GET as jest.Mock)
    .mockResolvedValueOnce({ result: [{ id: 1, name: 'food' }] })
    .mockResolvedValueOnce({ result: { transactions: [] } });
  return true;
}

beforeEach(() => {
  jest.clearAllMocks();
  const page = CREATE_MOCK_PAGE({
    url: jest.fn().mockReturnValue('https://www.max.co.il/homepage/personal'),
    waitForURL: jest.fn().mockResolvedValue(undefined),
  });
  MOCK_CONTEXT.newPage.mockResolvedValue(page);
  MOCK_BROWSER.newContext.mockResolvedValue(MOCK_CONTEXT);
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://www.max.co.il/homepage/personal');
  (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(false);
});

describe('MaxScraper.getLoginOptions — postAction override (lines 50-53)', () => {
  it('produces a postAction that resolves to true', async () => {
    mockFetchData();
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape({ username: 'u', password: 'p', id: '123' });
    expect(result.success).toBe(true);
  });

  it('succeeds without id credential (Flow A)', async () => {
    mockFetchData();
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape({ username: 'u', password: 'p' });
    expect(result.success).toBe(true);
    expect(result.accounts).toBeDefined();
  });

  it('returns accounts from fetchData after postAction runs', async () => {
    (FETCH_GET as jest.Mock)
      .mockResolvedValueOnce({ result: [{ id: 1, name: 'food' }] })
      .mockResolvedValueOnce({
        result: {
          transactions: [
            {
              shortCardNumber: '9999',
              paymentDate: '2024-06-15',
              purchaseDate: '2024-06-10',
              actualPaymentAmount: '50',
              paymentCurrency: 376,
              originalCurrency: 'ILS',
              originalAmount: 50,
              planName: 'רגילה',
              planTypeId: 5,
              comments: '',
              merchantName: 'test',
              categoryId: 1,
            },
          ],
        },
      });
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape({ username: 'u', password: 'p', id: '123' });
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts?.[0]?.accountNumber).toBe('9999');
  });
});
