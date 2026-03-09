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
  () => ({ fetchPost: jest.fn() }),
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
        (): string => 'https://connect.cal-online.co.il/login',
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
    getRawTransaction: jest.fn((data: Record<string, number>): Record<string, number> => data),
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
  }),
);

const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { elementPresentOnPage: ELEMENT_PRESENT } =
  await import('../../Common/ElementsInteractions.js');
const { fetchPost: FETCH_POST } = await import('../../Common/Fetch.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { getFromSessionStorage: GET_SESSION_STORAGE } = await import('../../Common/Storage.js');
const { waitUntil: WAIT_UNTIL } = await import('../../Common/Waiting.js');
const { default: VISA_CAL_SCRAPER } = await import('../../Scrapers/VisaCal/VisaCalScraper.js');
const { TrnTypeCode: TRN_TYPE_CODE } = await import('../../Scrapers/VisaCal/VisaCalTypes.js');
const { TransactionStatuses: TX_STATUSES, TransactionTypes: TX_TYPES } =
  await import('../../Transactions.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');
const FIXTURES = await import('./VisaCalFixtures.js');

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
 * Set up mocks for VisaCal login and session flow.
 * @returns The mock page object.
 */
function setupVisaCalMocks(): ReturnType<typeof CREATE_MOCK_PAGE> {
  const page = CREATE_MOCK_PAGE({
    frames: jest.fn().mockReturnValue([
      {
        url:
          /**
           * Frame URL getter.
           * @returns URL.
           */
          (): string => 'https://connect.cal-online.co.il/login',
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
        (): string => 'https://connect.cal-online.co.il/col-rest/calconnect/authentication/login',
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
  FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(page);

  (WAIT_UNTIL as jest.Mock).mockImplementation(
    async <T>(func: () => Promise<T>): Promise<T> => func(),
  );

  (GET_SESSION_STORAGE as jest.Mock).mockImplementation(
    (_page: ReturnType<typeof CREATE_MOCK_PAGE>, key: string): Promise<ISessionData> => {
      if (key === 'init') {
        return Promise.resolve({
          result: { cards: [{ cardUniqueId: 'card-1', last4Digits: '4580' }] },
        });
      }
      if (key === 'auth-module') {
        return Promise.resolve({ auth: { calConnectToken: 'cal-auth-token' } });
      }
      return Promise.resolve(EMPTY_SESSION);
    },
  );

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
    | ReturnType<typeof FIXTURES.mockPendingResponse>
    | { statusCode: number; title?: string } = { statusCode: 96 },
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
    (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(FIXTURES.MOCK_BROWSER);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(
      'https://digital-web.cal-online.co.il/dashboard',
    );
    (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(false);
    return true;
  },
);

describe('fetchData extended', () => {
  it('includes rawTransaction when option set', async () => {
    setupVisaCalMocks();
    const txn = FIXTURES.scrapedTxn();
    const details = FIXTURES.mockCardTransactionDetails([txn]);
    setupFetchMocks(details);
    const opts = visaCalOptions({ includeRawTransaction: true });
    const result = await new VISA_CAL_SCRAPER(opts).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.txns[0]?.rawTransaction).toBeDefined();
  });

  it('extracts balance from frames data', async () => {
    setupVisaCalMocks();
    const txn = FIXTURES.scrapedTxn();
    const details = FIXTURES.mockCardTransactionDetails([txn]);
    (FETCH_POST as jest.Mock)
      .mockResolvedValueOnce(FIXTURES.INIT_RESPONSE)
      .mockResolvedValueOnce({
        result: {
          bankIssuedCards: {
            cardLevelFrames: [{ cardUniqueId: 'card-1', nextTotalDebit: 5000 }],
          },
        },
      })
      .mockResolvedValueOnce(details)
      .mockResolvedValueOnce({ statusCode: 96 });

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.balance).toBe(-5000);
  });

  it('assigns category from branchCodeDesc', async () => {
    setupVisaCalMocks();
    const txn = FIXTURES.scrapedTxn({ branchCodeDesc: '\u05DE\u05E1\u05E2\u05D3\u05D5\u05EA' });
    const details = FIXTURES.mockCardTransactionDetails([txn]);
    setupFetchMocks(details);

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.txns[0]?.category).toBe('\u05DE\u05E1\u05E2\u05D3\u05D5\u05EA');
  });

  it('merges pending transactions with completed ones', async () => {
    setupVisaCalMocks();
    const pTxn = FIXTURES.pendingTxn({
      branchCodeDesc: '\u05E7\u05E0\u05D9\u05D5\u05EA',
    });
    const pending = FIXTURES.mockPendingResponse([pTxn]);
    const completedTxn = FIXTURES.scrapedTxn();
    const details = FIXTURES.mockCardTransactionDetails([completedTxn]);
    setupFetchMocks(details, pending);

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    const txns = result.accounts?.[0]?.txns ?? [];
    const pendingTx = txns.find(item => item.status === TX_STATUSES.Pending);
    const completedTx = txns.find(item => item.status === TX_STATUSES.Completed);
    expect(pendingTx).toBeDefined();
    expect(pendingTx?.description).toBe('Pending Shop');
    expect(pendingTx?.originalAmount).toBe(-75);
    expect(completedTx).toBeDefined();
  });

  it('handles standing order transaction type', async () => {
    setupVisaCalMocks();
    const txn = FIXTURES.scrapedTxn({ trnTypeCode: TRN_TYPE_CODE.StandingOrder });
    const details = FIXTURES.mockCardTransactionDetails([txn]);
    setupFetchMocks(details);

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.txns[0]?.type).toBe(TX_TYPES.Normal);
  });

  it('handles failed pending transactions gracefully', async () => {
    setupVisaCalMocks();
    const txn = FIXTURES.scrapedTxn();
    const details = FIXTURES.mockCardTransactionDetails([txn]);
    const failedPending = { statusCode: 0, title: 'Pending failed' };
    setupFetchMocks(details, failedPending);

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts?.[0]?.txns).toHaveLength(1);
  });

  it('handles foreign currency transactions', async () => {
    setupVisaCalMocks();
    const txn = FIXTURES.scrapedTxn({
      trnCurrencySymbol: 'USD',
      debCrdCurrencySymbol: 'ILS',
      trnAmt: 50,
      amtBeforeConvAndIndex: 180,
    });
    const details = FIXTURES.mockCardTransactionDetails([txn]);
    setupFetchMocks(details);

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    const txnResult = result.accounts?.[0]?.txns[0];
    expect(txnResult?.originalCurrency).toBe('USD');
    expect(txnResult?.chargedCurrency).toBe('ILS');
    expect(txnResult?.originalAmount).toBe(-50);
    expect(txnResult?.chargedAmount).toBe(-180);
  });

  it('sets chargedCurrency only for completed transactions', async () => {
    setupVisaCalMocks();
    const pTxn = FIXTURES.pendingTxn({
      merchantName: 'Pending',
      trnAmt: 100,
      trnCurrencySymbol: 'USD',
    });
    const pending = FIXTURES.mockPendingResponse([pTxn]);
    const details = FIXTURES.mockCardTransactionDetails([]);
    setupFetchMocks(details, pending);

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    const pendingResult = result.accounts?.[0]?.txns[0];
    expect(pendingResult?.chargedCurrency).toBeUndefined();
  });

  it('handles installment date shift', async () => {
    setupVisaCalMocks();
    const txn = FIXTURES.scrapedTxn({
      trnTypeCode: TRN_TYPE_CODE.Installments,
      numOfPayments: 6,
      curPaymentNum: 3,
    });
    const details = FIXTURES.mockCardTransactionDetails([txn]);
    setupFetchMocks(details);

    const result = await new VISA_CAL_SCRAPER(visaCalOptions()).scrape(FIXTURES.CREDS);
    const txnResult = result.accounts?.[0]?.txns[0];
    expect(txnResult?.installments).toEqual({ number: 3, total: 6 });
    expect(txnResult?.date).toBeDefined();
  });
});
