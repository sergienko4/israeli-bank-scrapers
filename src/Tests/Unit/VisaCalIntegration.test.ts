import { jest } from '@jest/globals';

import {
  VISACAL_CONNECT_AUTH_URL,
  VISACAL_CONNECT_LOGIN_URL,
  VISACAL_LOGIN_URL,
  VISACAL_SUCCESS_URL,
} from '../TestConstants.js';

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
      url:
        /**
         * Frame URL getter.
         * @returns URL string.
         */
        (): string => VISACAL_CONNECT_LOGIN_URL,
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
    getCurrentUrl: jest.fn().mockResolvedValue(VISACAL_SUCCESS_URL),
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
    getRawTransaction: jest.fn(
      (data: Record<string, string | number>): Record<string, string | number> => data,
    ),
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
    getDebug:
      /**
       * Debug factory.
       * @returns Mock logger.
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
const { elementPresentOnPage: ELEMENT_PRESENT, pageEval: PAGE_EVAL } =
  await import('../../Common/ElementsInteractions.js');
const { fetchPostWithinPage: FETCH_POST } = await import('../../Common/Fetch.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { getFromSessionStorage: GET_SESSION_STORAGE } = await import('../../Common/Storage.js');
const { waitUntil: WAIT_UNTIL } = await import('../../Common/Waiting.js');
const { ScraperErrorTypes: ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: VISA_CAL_SCRAPER } = await import('../../Scrapers/VisaCal/VisaCalScraper.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');
const FIXTURES = await import('./VisaCalFixtures.js');
const INTEGRATION = await import('../IntegrationHelpers.js');

interface ISessionData {
  result?: { cards: { cardUniqueId: string; last4Digits: string }[] };
  auth?: { calConnectToken: string };
}

const EMPTY_SESSION: ISessionData = {};

/**
 * Build VisaCal scraper options with defaults.
 * @param overrides - Option overrides.
 * @returns Scraper options for VisaCal.
 */
function visaCalOptions(
  overrides: Partial<ReturnType<typeof CREATE_OPTS>> = {},
): ReturnType<typeof CREATE_OPTS> {
  return CREATE_OPTS({ startDate: new Date(), futureMonthsToScrape: 0, ...overrides });
}

/**
 * Create a mock VisaCal page with login iframe and auth response.
 * @returns mock page object.
 */
function createMockVisaCalPage(): ReturnType<typeof CREATE_MOCK_PAGE> {
  return CREATE_MOCK_PAGE({
    frames: jest.fn().mockReturnValue([
      {
        url:
          /**
           * Frame URL getter.
           * @returns URL.
           */
          (): string => VISACAL_CONNECT_LOGIN_URL,
        waitForSelector: jest.fn().mockResolvedValue(undefined),
      },
    ]),
    waitForResponse: jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ token: 'cal-auth-token' }),
      url:
        /**
         * Response URL getter.
         * @returns URL.
         */
        (): string => VISACAL_CONNECT_AUTH_URL,
      request:
        /**
         * Request getter.
         * @returns Request mock.
         */
        () => ({
          method:
            /**
             * Method getter.
             * @returns HTTP method.
             */
            (): string => 'POST',
        }),
    }),
  });
}

/**
 * Configure waitUntil to execute its callback immediately.
 * @returns true when configured.
 */
function mockWaitUntil(): boolean {
  (WAIT_UNTIL as jest.Mock).mockImplementation(
    async <T>(func: () => Promise<T>): Promise<T> => func(),
  );
  return true;
}

/** Default card list for session storage mock. */
const DEFAULT_CARDS: { cardUniqueId: string; last4Digits: string }[] = [
  { cardUniqueId: 'card-1', last4Digits: '4580' },
];

/**
 * Configure session storage with card and auth data.
 * @param cards - Card list returned for the 'init' key.
 * @returns true when configured.
 */
function mockSessionStorage(
  cards: { cardUniqueId: string; last4Digits: string }[] = DEFAULT_CARDS,
): boolean {
  (GET_SESSION_STORAGE as jest.Mock).mockImplementation(
    (_page: ReturnType<typeof CREATE_MOCK_PAGE>, key: string): Promise<ISessionData> => {
      if (key === 'init') {
        return Promise.resolve({ result: { cards } });
      }
      if (key === 'auth-module') {
        return Promise.resolve({ auth: { calConnectToken: 'cal-auth-token' } });
      }
      return Promise.resolve(EMPTY_SESSION);
    },
  );
  return true;
}

/**
 * Set up mocks for VisaCal login and session flow.
 * @param cards - Card list for session storage (defaults to one card).
 * @returns The mock page object.
 */
function setupVisaCalMocks(
  cards: { cardUniqueId: string; last4Digits: string }[] = DEFAULT_CARDS,
): ReturnType<typeof CREATE_MOCK_PAGE> {
  const page = createMockVisaCalPage();
  FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(page);
  mockWaitUntil();
  mockSessionStorage(cards);
  return page;
}

/**
 * Set up standard fetch mocks for a complete scrape cycle.
 * @param txnDetailsResponse - The transaction details response.
 * @param pendingResponse - The pending transactions response.
 * @returns True when complete.
 */
function setupFetchMocks(
  txnDetailsResponse: ReturnType<typeof FIXTURES.mockCardTransactionDetails>,
  pendingResponse:
    | ReturnType<typeof FIXTURES.mockCardTransactionDetails>
    | { statusCode: number } = { statusCode: 96 },
): boolean {
  (FETCH_POST as jest.Mock)
    .mockResolvedValueOnce(FIXTURES.INIT_RESPONSE)
    .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } })
    .mockResolvedValueOnce(txnDetailsResponse)
    .mockResolvedValueOnce(pendingResponse);
  return true;
}

beforeEach(
  /**
   * Clear mocks before each test.
   * @returns Test setup flag.
   */
  () => {
    jest.clearAllMocks();
    (FETCH_POST as jest.Mock).mockReset();
    (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(FIXTURES.MOCK_BROWSER);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(VISACAL_SUCCESS_URL);
    (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(false);
    return true;
  },
);

describe('integration: full scrape flow', () => {
  it('happy path: cards + completed transactions with account and amounts', async () => {
    setupVisaCalMocks();
    const txn1 = FIXTURES.scrapedTxn({ trnAmt: 200, merchantName: 'רמי לוי' });
    const txn2 = FIXTURES.scrapedTxn({ trnAmt: 80, merchantName: 'סופר שופ' });
    const details = FIXTURES.mockCardTransactionDetails([txn1, txn2]);
    setupFetchMocks(details);

    const scraper = new VISA_CAL_SCRAPER(visaCalOptions());
    const result = await scraper.scrape(FIXTURES.CREDS);

    const accounts = INTEGRATION.assertSuccess(result, 1);
    expect(accounts[0]?.accountNumber).toBe('4580');
    expect(accounts[0]?.txns).toHaveLength(2);
    expect(accounts[0]?.txns[0]?.originalAmount).toBe(-200);
    expect(accounts[0]?.txns[1]?.originalAmount).toBe(-80);
  });

  it('invalid login: error element in iframe returns InvalidPassword', async () => {
    const loginUrl = VISACAL_LOGIN_URL;
    const loginPage = CREATE_MOCK_PAGE({
      url: jest.fn().mockReturnValue(loginUrl),
      waitForURL: jest.fn().mockResolvedValue(undefined),
      frames: jest.fn().mockReturnValue([
        {
          url:
            /**
             * Frame URL getter.
             * @returns URL.
             */
            (): string => VISACAL_CONNECT_LOGIN_URL,
          waitForSelector: jest.fn().mockResolvedValue(undefined),
        },
      ]),
      waitForResponse: jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({ token: '' }),
        url:
          /**
           * Response URL getter.
           * @returns URL.
           */
          (): string => VISACAL_CONNECT_AUTH_URL,
        request:
          /**
           * Request getter.
           * @returns Request mock.
           */
          () => ({
            method:
              /**
               * Method getter.
               * @returns HTTP method.
               */
              (): string => 'POST',
          }),
      }),
    });
    FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(loginPage);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(loginUrl);
    (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(true);
    (PAGE_EVAL as jest.Mock).mockResolvedValue('שם המשתמש או הסיסמה שהוזנו שגויים');

    const scraper = new VISA_CAL_SCRAPER(visaCalOptions());
    const result = await scraper.scrape(FIXTURES.CREDS);

    INTEGRATION.assertFailure(result, ERROR_TYPES.InvalidPassword);
  });

  it('empty data: empty card list from init API with 0 accounts', async () => {
    setupVisaCalMocks([]);
    (FETCH_POST as jest.Mock)
      .mockResolvedValueOnce(FIXTURES.EMPTY_CARDS_INIT_RESPONSE)
      .mockResolvedValueOnce({ result: { bankIssuedCards: { cardLevelFrames: [] } } });

    const scraper = new VISA_CAL_SCRAPER(visaCalOptions());
    const result = await scraper.scrape(FIXTURES.CREDS);

    INTEGRATION.assertEmptyTxns(result);
  });
});
