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

const { buildContextOptions: BUILD_CONTEXT_OPTIONS } = await import('../../Common/Browser.js');
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { fetchGetWithinPage: FETCH_GET, fetchPostWithinPage: FETCH_POST } =
  await import('../../Common/Fetch.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { waitUntil: WAIT_UNTIL } = await import('../../Common/Waiting.js');
const { ScraperErrorTypes: SCRAPER_ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: HAPOALIM_SCRAPER } = await import('../../Scrapers/Hapoalim/HapoalimScraper.js');
const { TransactionStatuses: TX_STATUSES, TransactionTypes: TX_TYPES } =
  await import('../../Transactions.js');
const { createMockScraperOptions: CREATE_OPTS } = await import('../MockPage.js');
const FIXTURES = await import('./HapoalimFixtures.js');

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

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([FIXTURES.scrapedTxn()]);
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(true);
    expect(BUILD_CONTEXT_OPTIONS).toHaveBeenCalled();
  });

  it('returns InvalidPassword for error URL', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(
      'https://login.bankhapoalim.co.il/AUTHENTICATE/LOGON?flow=AUTHENTICATE&state=LOGON&errorcode=1.6&callme=false',
    );
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(SCRAPER_ERROR_TYPES.InvalidPassword);
  });

  it('returns ChangePassword for password expiry URL', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(
      'https://login.bankhapoalim.co.il/MCP/START?flow=MCP&state=START&expiredDate=null',
    );
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(SCRAPER_ERROR_TYPES.ChangePassword);
  });
});

describe('fetchData', () => {
  it('fetches transactions for open accounts', async () => {
    setupLoginAndAccounts();
    mockBalance(15000);
    mockTransactions([
      FIXTURES.scrapedTxn({ eventAmount: 250, activityDescription: '\u05E7\u05E0\u05D9\u05D4' }),
    ]);
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    const account = result.accounts?.[0];
    expect(account?.accountNumber).toBe('12-345-678');
    expect(account?.balance).toBe(15000);
    const txn = account?.txns[0];
    expect(txn?.description).toBe('\u05E7\u05E0\u05D9\u05D4');
    expect(txn?.originalCurrency).toBe('ILS');
    expect(txn?.type).toBe(TX_TYPES.Normal);
    expect(txn?.originalAmount).toBe(-250);
  });

  it('negates outbound transactions', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([FIXTURES.scrapedTxn({ eventActivityTypeCode: 2, eventAmount: 300 })]);
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.txns[0]?.originalAmount).toBe(-300);
  });

  it('keeps inbound transactions positive', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([FIXTURES.scrapedTxn({ eventActivityTypeCode: 1, eventAmount: 300 })]);
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.txns[0]?.originalAmount).toBe(300);
  });

  it('marks pending transactions', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([FIXTURES.scrapedTxn({ serialNumber: 0 })]);
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.txns[0]?.status).toBe(TX_STATUSES.Pending);
  });

  it('marks completed transactions', async () => {
    setupLoginAndAccounts();
    mockBalance();
    mockTransactions([FIXTURES.scrapedTxn({ serialNumber: 5 })]);
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.txns[0]?.status).toBe(TX_STATUSES.Completed);
  });

  it('constructs memo from beneficiary details', async () => {
    setupLoginAndAccounts();
    mockBalance();
    const beneficiary = {
      partyHeadline: 'Transfer',
      partyName: 'John',
      messageHeadline: 'Rent',
      messageDetail: 'Monthly',
    };
    mockTransactions([FIXTURES.scrapedTxn({ beneficiaryDetailsData: beneficiary })]);
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.txns[0]?.memo).toBe('Transfer John. Rent Monthly.');
  });

  it('filters closed accounts', async () => {
    setupLoginAndAccounts([
      { bankNumber: '12', branchNumber: '345', accountNumber: '678', accountClosingReasonCode: 0 },
      { bankNumber: '12', branchNumber: '345', accountNumber: '999', accountClosingReasonCode: 1 },
    ]);
    mockBalance();
    mockTransactions([FIXTURES.scrapedTxn()]);
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts?.[0]?.accountNumber).toBe('12-345-678');
  });

  it('handles empty accounts list', async () => {
    setupLoginAndAccounts([]);
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('handles null balance response', async () => {
    setupLoginAndAccounts();
    (FETCH_GET as jest.Mock).mockResolvedValueOnce(null);
    mockTransactions([FIXTURES.scrapedTxn()]);
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.balance).toBeUndefined();
  });

  it('handles empty transactions response', async () => {
    setupLoginAndAccounts();
    mockBalance();
    (FETCH_POST as jest.Mock).mockResolvedValueOnce({ transactions: [] });
    const result = await new HAPOALIM_SCRAPER(CREATE_OPTS()).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.txns).toHaveLength(0);
  });
});
