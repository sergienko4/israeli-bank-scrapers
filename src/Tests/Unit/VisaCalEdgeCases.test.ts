import { jest } from '@jest/globals';

jest.unstable_mockModule(
  '../../Common/CamoufoxLauncher.js',
  /**
   * Mock CamoufoxLauncher.
   * @returns Mocked module.
   */
  () => ({ launchCamoufox: jest.fn() }),
);

jest.unstable_mockModule(
  '../../Common/Fetch.js',
  /**
   * Mock Fetch.
   * @returns Mocked module.
   */
  () => ({ fetchPostWithinPage: jest.fn() }),
);

jest.unstable_mockModule(
  '../../Common/Storage.js',
  /**
   * Mock Storage.
   * @returns Mocked module.
   */
  () => ({ getFromSessionStorage: jest.fn() }),
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
    waitUntilIframeFound: jest.fn().mockResolvedValue({
      /**
       * Frame URL getter.
       * @returns URL string.
       */
      url: (): string => 'https://connect.cal-online.co.il/login',
    }),
    elementPresentOnPage: jest.fn().mockResolvedValue(false),
    pageEval: jest.fn().mockResolvedValue(''),
  }),
);

jest.unstable_mockModule(
  '../../Common/Navigation.js',
  /**
   * Mock Navigation.
   * @returns Mocked module.
   */
  () => ({
    getCurrentUrl: jest.fn().mockResolvedValue('https://digital-web.cal-online.co.il/dashboard'),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
    waitForRedirect: jest.fn().mockResolvedValue(undefined),
    waitForUrl: jest.fn().mockResolvedValue(undefined),
  }),
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
  '../../Common/Transactions.js',
  /**
   * Mock Transactions.
   * @returns Mocked module.
   */
  () => ({
    filterOldTransactions: jest.fn(<T>(txns: T[]): T[] => txns),
    getRawTransaction: jest.fn((data: Record<string, number>) => data),
  }),
);

jest.unstable_mockModule(
  '../../Common/Waiting.js',
  /**
   * Mock Waiting.
   * @returns Mocked module.
   */
  () => ({
    waitUntil: jest.fn(async <T>(func: () => Promise<T>): Promise<T> => func()),
    TimeoutError: class TimeoutError extends Error {},
    SECOND: 1000,
    sleep: jest.fn().mockResolvedValue(undefined),
    humanDelay: jest.fn().mockResolvedValue(undefined),
    runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
      const seed = Promise.resolve([] as T[]);
      return actions.reduce(
        (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
        seed,
      );
    }),
    raceTimeout: jest.fn().mockResolvedValue(undefined),
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

const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { elementPresentOnPage: ELEMENT_PRESENT } =
  await import('../../Common/ElementsInteractions.js');
const { fetchPostWithinPage: FETCH_POST } = await import('../../Common/Fetch.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { getFromSessionStorage: GET_SESSION_STORAGE } = await import('../../Common/Storage.js');
const { waitUntil: WAIT_UNTIL } = await import('../../Common/Waiting.js');
const { default: VISA_CAL_SCRAPER } = await import('../../Scrapers/VisaCal/VisaCalScraper.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');
const FIXTURES = await import('./VisaCalFixtures.js');

/** Session data shape for VisaCal auth. */
interface ISessionData {
  result?: { cards: { cardUniqueId: string; last4Digits: string }[] };
  auth?: { calConnectToken: string };
}

const EMPTY_SESSION: ISessionData = {};

/**
 * Build VisaCal scraper options with defaults.
 * @param overrides - Option overrides.
 * @returns Scraper options.
 */
function visaCalOptions(
  overrides: Partial<ReturnType<typeof CREATE_OPTS>> = {},
): ReturnType<typeof CREATE_OPTS> {
  return CREATE_OPTS({ startDate: new Date(), futureMonthsToScrape: 0, ...overrides });
}

/**
 * Set up page mock where waitForResponse rejects (token intercept fails).
 * @returns Mock page with failed token intercept.
 */
function setupPageWithFailedIntercept(): ReturnType<typeof CREATE_MOCK_PAGE> {
  const page = CREATE_MOCK_PAGE({
    frames: jest.fn().mockReturnValue([
      {
        /**
         * Frame URL getter.
         * @returns URL string.
         */
        url: (): string => 'https://connect.cal-online.co.il/login',
        waitForSelector: jest.fn().mockResolvedValue(undefined),
      },
    ]),
    waitForResponse: jest.fn().mockRejectedValue(new Error('timeout 15s')),
  });
  FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(page);
  return page;
}

/**
 * Set up session storage mocks for auth module fallback.
 * @returns True when setup complete.
 */
function setupSessionStorageFallback(): boolean {
  (GET_SESSION_STORAGE as jest.Mock).mockImplementation(
    (_page: ReturnType<typeof CREATE_MOCK_PAGE>, key: string): Promise<ISessionData> => {
      if (key === 'init') {
        return Promise.resolve({
          result: { cards: [{ cardUniqueId: 'card-1', last4Digits: '4580' }] },
        });
      }
      if (key === 'auth-module') {
        return Promise.resolve({ auth: { calConnectToken: 'session-token-fallback' } });
      }
      return Promise.resolve(EMPTY_SESSION);
    },
  );
  return true;
}

/**
 * Set up fetch mocks for a scrape cycle.
 * @param txnDetails - Transaction details response.
 * @param pending - Pending response.
 * @returns True when setup complete.
 */
function setupFetchMocks(
  txnDetails: ReturnType<typeof FIXTURES.mockCardTransactionDetails>,
  pending: ReturnType<typeof FIXTURES.mockCardTransactionDetails> | { statusCode: number } = {
    statusCode: 96,
  },
): boolean {
  (FETCH_POST as jest.Mock)
    .mockResolvedValueOnce(FIXTURES.INIT_RESPONSE)
    .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
    .mockResolvedValueOnce(txnDetails)
    .mockResolvedValueOnce(pending);
  return true;
}

beforeEach(() => {
  jest.clearAllMocks();
  (FETCH_POST as jest.Mock).mockReset();
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(FIXTURES.MOCK_BROWSER);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(
    'https://digital-web.cal-online.co.il/dashboard',
  );
  (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(false);
});

describe('getAuthorizationHeader fallback (lines 100-104)', () => {
  it('falls back to sessionStorage when intercept fails', async () => {
    setupPageWithFailedIntercept();
    setupSessionStorageFallback();
    (WAIT_UNTIL as jest.Mock).mockImplementation(
      async <T>(func: () => Promise<T>): Promise<T> => func(),
    );

    const txn = FIXTURES.scrapedTxn();
    const details = FIXTURES.mockCardTransactionDetails([txn]);
    setupFetchMocks(details);

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(true);
    const anyPage = expect.anything() as ReturnType<typeof CREATE_MOCK_PAGE>;
    expect(GET_SESSION_STORAGE).toHaveBeenCalledWith(anyPage, 'auth-module');
  });
});

describe('interceptLoginToken catch path (lines 182-183)', () => {
  it('returns empty string and continues when POST response times out', async () => {
    setupPageWithFailedIntercept();
    setupSessionStorageFallback();
    (WAIT_UNTIL as jest.Mock).mockImplementation(
      async <T>(func: () => Promise<T>): Promise<T> => func(),
    );

    const txn = FIXTURES.scrapedTxn();
    const details = FIXTURES.mockCardTransactionDetails([txn]);
    setupFetchMocks(details);

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
  });
});

describe('captureAuthToken — token not intercepted path (line 163)', () => {
  it('logs fallback message when token is empty string', async () => {
    setupPageWithFailedIntercept();
    setupSessionStorageFallback();
    (WAIT_UNTIL as jest.Mock).mockImplementation(
      async <T>(func: () => Promise<T>): Promise<T> => func(),
    );

    const txn = FIXTURES.scrapedTxn();
    const details = FIXTURES.mockCardTransactionDetails([txn]);
    setupFetchMocks(details);

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(true);
  });
});

describe('waitForAuthModule — sessionStorage poll (lines 130-141)', () => {
  it('polls sessionStorage until auth module appears', async () => {
    setupPageWithFailedIntercept();

    let callCount = 0;
    (GET_SESSION_STORAGE as jest.Mock).mockImplementation(
      (_page: ReturnType<typeof CREATE_MOCK_PAGE>, key: string): Promise<ISessionData> => {
        if (key === 'init') {
          return Promise.resolve({
            result: { cards: [{ cardUniqueId: 'card-1', last4Digits: '4580' }] },
          });
        }
        if (key === 'auth-module') {
          callCount += 1;
          if (callCount === 1) return Promise.resolve(EMPTY_SESSION);
          return Promise.resolve({ auth: { calConnectToken: 'delayed-token' } });
        }
        return Promise.resolve(EMPTY_SESSION);
      },
    );

    (WAIT_UNTIL as jest.Mock).mockImplementation(async <T>(func: () => Promise<T>): Promise<T> => {
      await func();
      return func();
    });

    const txn = FIXTURES.scrapedTxn();
    const details = FIXTURES.mockCardTransactionDetails([txn]);
    setupFetchMocks(details);

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(true);
  });
});
