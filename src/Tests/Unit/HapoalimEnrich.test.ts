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
    waitUntil: jest
      .fn()
      .mockImplementation(async <T>(func: () => Promise<T>): Promise<T> => func()),
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
    getRawTransaction: jest.fn((data: Record<string, number>) => data),
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
const { default: HAPOALIM_SCRAPER } = await import('../../Scrapers/Hapoalim/HapoalimScraper.js');
const { createMockScraperOptions: CREATE_OPTS } = await import('../MockPage.js');
const FIXTURES = await import('./HapoalimFixtures.js');

const DEFAULT_ACCOUNTS = [
  { bankNumber: '12', branchNumber: '345', accountNumber: '678', accountClosingReasonCode: 0 },
];

/**
 * Set up login mocks and account data for enrichment tests.
 * @param accounts - Account list.
 * @returns The mock page.
 */
function setupLogin(accounts = DEFAULT_ACCOUNTS): ReturnType<typeof FIXTURES.createHapoalimPage> {
  const page = FIXTURES.createHapoalimPage();
  FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(page);
  (WAIT_UNTIL as jest.Mock).mockImplementation(
    async (func: () => Promise<boolean>): Promise<boolean> => {
      const didResolve = await func();
      return didResolve;
    },
  );
  (FETCH_GET as jest.Mock).mockResolvedValueOnce(accounts);
  return page;
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

beforeEach(() => {
  jest.clearAllMocks();
  (FETCH_POST as jest.Mock).mockReset();
  (FETCH_GET as jest.Mock).mockReset();
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(FIXTURES.MOCK_BROWSER);
  const defaultPage = FIXTURES.createHapoalimPage();
  FIXTURES.MOCK_CONTEXT.newPage.mockResolvedValue(defaultPage);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(
    'https://login.bankhapoalim.co.il/portalserver/HomePage',
  );
});

describe('enrichOneTxn — PFM enrichment (lines 205-215)', () => {
  it('enriches transaction with PFM referenceNumber and additionalInformation', async () => {
    setupLogin();
    mockBalance();
    const txn = FIXTURES.scrapedTxn({
      serialNumber: 42,
      referenceNumber: 100,
      pfmDetails: '/pfm/details?id=99',
    });
    (FETCH_POST as jest.Mock).mockResolvedValueOnce({ transactions: [txn] });

    const pfmDetails = [{ transactionNumber: 777 }];
    (FETCH_GET as jest.Mock).mockResolvedValueOnce(pfmDetails);

    const opts = CREATE_OPTS({ shouldAddTransactionInformation: true });
    const result = await new HAPOALIM_SCRAPER(opts).scrape(FIXTURES.CREDS);

    expect(result.success).toBe(true);
    const firstTxn = result.accounts?.[0]?.txns[0];
    expect(firstTxn?.identifier).toBe(777);
  });

  it('skips PFM enrichment for pending transactions (serialNumber=0)', async () => {
    setupLogin();
    mockBalance();
    const txn = FIXTURES.scrapedTxn({ serialNumber: 0, pfmDetails: '/pfm/details?id=1' });
    (FETCH_POST as jest.Mock).mockResolvedValueOnce({ transactions: [txn] });

    const opts = CREATE_OPTS({ shouldAddTransactionInformation: true });
    const result = await new HAPOALIM_SCRAPER(opts).scrape(FIXTURES.CREDS);

    expect(result.success).toBe(true);
    expect(FETCH_GET).toHaveBeenCalledTimes(2);
  });

  it('keeps original referenceNumber when PFM returns empty array', async () => {
    setupLogin();
    mockBalance();
    const txn = FIXTURES.scrapedTxn({
      serialNumber: 10,
      referenceNumber: 555,
      pfmDetails: '/pfm/details?id=5',
    });
    (FETCH_POST as jest.Mock).mockResolvedValueOnce({ transactions: [txn] });
    (FETCH_GET as jest.Mock).mockResolvedValueOnce([]);

    const opts = CREATE_OPTS({ shouldAddTransactionInformation: true });
    const result = await new HAPOALIM_SCRAPER(opts).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.txns[0]?.identifier).toBe(555);
  });

  it('keeps original when PFM detail has no transactionNumber', async () => {
    setupLogin();
    mockBalance();
    const txn = FIXTURES.scrapedTxn({
      serialNumber: 10,
      referenceNumber: 555,
      pfmDetails: '/pfm/details?id=5',
    });
    (FETCH_POST as jest.Mock).mockResolvedValueOnce({ transactions: [txn] });
    (FETCH_GET as jest.Mock).mockResolvedValueOnce([{ transactionNumber: 0 }]);

    const opts = CREATE_OPTS({ shouldAddTransactionInformation: true });
    const result = await new HAPOALIM_SCRAPER(opts).scrape(FIXTURES.CREDS);
    expect(result.accounts?.[0]?.txns[0]?.identifier).toBe(555);
  });
});

describe('enrichIfNeeded — skip enrichment (lines 246-252)', () => {
  it('skips enrichment when shouldAddTransactionInformation is false', async () => {
    setupLogin();
    mockBalance();
    const txn = FIXTURES.scrapedTxn({ pfmDetails: '/pfm/details?id=1' });
    (FETCH_POST as jest.Mock).mockResolvedValueOnce({ transactions: [txn] });

    const opts = CREATE_OPTS({ shouldAddTransactionInformation: false });
    const result = await new HAPOALIM_SCRAPER(opts).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(true);
    expect(FETCH_GET).toHaveBeenCalledTimes(2);
  });

  it('skips enrichment when transactions list is empty', async () => {
    setupLogin();
    mockBalance();
    (FETCH_POST as jest.Mock).mockResolvedValueOnce({ transactions: [] });

    const opts = CREATE_OPTS({ shouldAddTransactionInformation: true });
    const result = await new HAPOALIM_SCRAPER(opts).scrape(FIXTURES.CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts?.[0]?.txns).toHaveLength(0);
  });
});
