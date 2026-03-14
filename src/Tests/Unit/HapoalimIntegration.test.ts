import { jest } from '@jest/globals';

import type { IHapoalimScrapedTxn } from './HapoalimFixtures.js';

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
  () => ({ fetchGetWithinPage: jest.fn(), fetchPostWithinPage: jest.fn() }),
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
  '../../Common/Navigation.js',
  /**
   * Mock Navigation.
   * @returns Mocked module.
   */
  () => ({
    getCurrentUrl: jest
      .fn()
      .mockResolvedValue('https://login.bankhapoalim.co.il/portalserver/HomePage'),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    waitForRedirect: jest.fn().mockResolvedValue(undefined),
    waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
    waitForUrl: jest.fn().mockResolvedValue(undefined),
  }),
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
  '../../Common/Waiting.js',
  /**
   * Mock Waiting.
   * @returns Mocked module.
   */
  () => ({
    waitUntil: jest.fn().mockResolvedValue(undefined),
    sleep: jest.fn().mockResolvedValue(undefined),
    humanDelay: jest.fn().mockResolvedValue(undefined),
    /**
     * Executes async actions sequentially, collecting results.
     * @param actions - Array of async factory functions.
     * @returns Array of resolved values.
     */
    runSerial: jest.fn().mockImplementation(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
      const seed = Promise.resolve([] as T[]);
      return actions.reduce(
        (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
        seed,
      );
    }),
    raceTimeout: jest.fn().mockResolvedValue(undefined),
    TimeoutError: Error,
    SECOND: 1000,
  }),
);

jest.unstable_mockModule(
  '../../Common/Transactions.js',
  /**
   * Mock Transactions.
   * @returns Mocked module.
   */
  () => ({
    getRawTransaction: jest.fn((data: Record<string, number>): Record<string, number> => data),
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

jest.unstable_mockModule(
  'uuid',
  /**
   * Mock uuid.
   * @returns Mocked module.
   */
  () => ({ v4: jest.fn((): string => 'mock-uuid') }),
);

jest.unstable_mockModule(
  '../../Common/OtpHandler.js',
  /**
   * Mock OtpHandler.
   * @returns Mocked module.
   */
  () => ({
    handleOtpStep: jest.fn().mockResolvedValue(null),
    handleOtpCode: jest.fn().mockResolvedValue(undefined),
    handleOtpConfirm: jest.fn().mockResolvedValue(undefined),
  }),
);

const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { fetchGetWithinPage: FETCH_GET, fetchPostWithinPage: FETCH_POST } =
  await import('../../Common/Fetch.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { waitUntil: WAIT_UNTIL } = await import('../../Common/Waiting.js');
const { ScraperErrorTypes: SCRAPER_ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: HAPOALIM_SCRAPER } = await import('../../Scrapers/Hapoalim/HapoalimScraper.js');
const { createMockScraperOptions: CREATE_OPTS } = await import('../MockPage.js');
const FIXTURES = await import('./HapoalimFixtures.js');
const INTEGRATION = await import('../IntegrationHelpers.js');

/**
 * Mock the accounts API response.
 * @param accounts - Account list.
 * @returns True when setup complete.
 */
function mockAccounts(
  accounts: {
    bankNumber: string;
    branchNumber: string;
    accountNumber: string;
    accountClosingReasonCode: number;
  }[] = [],
): boolean {
  (FETCH_GET as jest.Mock).mockResolvedValueOnce(accounts);
  return true;
}

/**
 * Mock the balance API response.
 * @param balance - Balance value.
 * @returns True when setup complete.
 */
function mockBalance(balance = 10000): boolean {
  (FETCH_GET as jest.Mock).mockResolvedValueOnce({ currentBalance: balance });
  return true;
}

/**
 * Mock the transactions API response.
 * @param txns - Transaction list.
 * @returns True when setup complete.
 */
function mockTransactions(txns: IHapoalimScrapedTxn[] = []): boolean {
  (FETCH_POST as jest.Mock).mockResolvedValueOnce({ transactions: txns });
  return true;
}

/**
 * Set up login mocks and account data for Hapoalim tests.
 * @param accounts - Account list.
 * @returns The mock page object.
 */
function setupLoginAndAccounts(
  accounts: {
    bankNumber: string;
    branchNumber: string;
    accountNumber: string;
    accountClosingReasonCode: number;
  }[] = [
    { bankNumber: '12', branchNumber: '345', accountNumber: '678', accountClosingReasonCode: 0 },
  ],
): ReturnType<typeof FIXTURES.createHapoalimPage> {
  const page = FIXTURES.createHapoalimPage();
  FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(page);
  (WAIT_UNTIL as jest.Mock).mockImplementation(
    async (func: () => Promise<boolean>): Promise<boolean> => {
      await func();
      return true;
    },
  );
  mockAccounts(accounts);
  return page;
}

beforeEach(
  /**
   * Clear mocks before each test.
   * @returns Test setup flag.
   */
  () => {
    jest.clearAllMocks();
    (FETCH_POST as jest.Mock).mockReset();
    (FETCH_GET as jest.Mock).mockReset();
    (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(FIXTURES.MOCK_BROWSER);
    const page = FIXTURES.createHapoalimPage();
    FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(page);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(
      'https://login.bankhapoalim.co.il/portalserver/HomePage',
    );
    return true;
  },
);

describe('integration: full scrape flow', () => {
  it('happy path: accounts, XSRF token, transactions', async () => {
    setupLoginAndAccounts([
      { bankNumber: '12', branchNumber: '345', accountNumber: '678', accountClosingReasonCode: 0 },
    ]);
    mockBalance(25000);
    mockTransactions([
      FIXTURES.scrapedTxn({
        eventAmount: 500,
        activityDescription: 'משכורת',
        eventActivityTypeCode: 1,
      }),
      FIXTURES.scrapedTxn({
        eventAmount: 120,
        activityDescription: 'סופר',
        eventActivityTypeCode: 2,
      }),
    ]);

    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    const accounts = INTEGRATION.assertSuccess(result, 1);

    expect(accounts[0].accountNumber).toBe('12-345-678');
    expect(accounts[0].balance).toBe(25000);
    expect(accounts[0].txns).toHaveLength(2);
    expect(accounts[0].txns[0].originalAmount).toBe(500);
    expect(accounts[0].txns[1].originalAmount).toBe(-120);
  });

  it('invalid login: error URL returns InvalidPassword', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(
      'https://login.bankhapoalim.co.il/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false',
    );

    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    INTEGRATION.assertFailure(result, SCRAPER_ERROR_TYPES.InvalidPassword);
  });

  it('empty data: no open accounts returns success with 0 accounts', async () => {
    setupLoginAndAccounts([]);

    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    INTEGRATION.assertSuccess(result, 0);
    INTEGRATION.assertEmptyTxns(result);
  });
});
