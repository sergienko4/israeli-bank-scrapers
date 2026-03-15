import { jest } from '@jest/globals';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));
jest.unstable_mockModule('../../Common/Fetch.js', () => ({ fetchGetWithinPage: jest.fn() }));
jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  capturePageText: jest.fn().mockResolvedValue(''),
}));
jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.max.co.il/homepage/personal'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));
jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  fixInstallments: jest.fn(<T>(txns: T[]) => txns),
  filterOldTransactions: jest.fn(<T>(txns: T[]) => txns),
  sortTransactionsByDate: jest.fn(<T>(txns: T[]) => txns),
  getRawTransaction: jest.fn((data: Record<string, number>): Record<string, number> => data),
}));
/**
 * Create a stub logger with all log-level methods mocked.
 * @returns A record of jest mock functions keyed by log level.
 */
function stubLogger(): Record<string, jest.Mock> {
  return { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}
/**
 * Passthrough mock for bank context.
 * @param _b - Bank name (unused).
 * @param fn - Function to execute.
 * @returns The result of fn.
 */
function passthroughContext<T>(_b: string, fn: () => T): T {
  return fn();
}
/**
 * Build a mock Debug module with stub logger and passthrough bank context.
 * @returns An object matching the Debug module interface.
 */
function createMockDebug(): {
  getDebug: () => Record<string, jest.Mock>;
  runWithBankContext: <T>(_b: string, fn: () => T) => T;
} {
  return { getDebug: stubLogger, runWithBankContext: passthroughContext };
}
jest.unstable_mockModule('../../Common/Debug.js', createMockDebug);
jest.unstable_mockModule('../../Common/Dates.js', () => ({
  default: jest.fn(() => [MOMENT('2024-06-01')]),
}));
const { default: MOMENT } = await import('moment');
const { buildContextOptions: BUILD_CONTEXT_OPTIONS } = await import('../../Common/Browser.js');
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
await import('../../Common/ElementsInteractions.js');
const { fetchGetWithinPage: FETCH_GET } = await import('../../Common/Fetch.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { filterOldTransactions: FILTER_OLD, fixInstallments: FIX_INSTALLMENTS } =
  await import('../../Common/Transactions.js');
const { DOLLAR_CURRENCY } = await import('../../Constants.js');
const { ScraperErrorTypes: ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: MAX_SCRAPER, getMemo: GET_MEMO } =
  await import('../../Scrapers/Max/MaxScraper.js');
const { TransactionStatuses: TX_STATUSES, TransactionTypes: TX_TYPES } =
  await import('../../Transactions.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');
const { rawTxn: RAW_TXN, createErrorLocator: CREATE_ERROR_LOC } = await import('./MaxFixtures.js');
const SHEKEL_CURRENCY = 'ILS';
const MOCK_CONTEXT = { newPage: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};
const CREDS = { username: 'testuser', password: 'testpass' };
const SUCCESS_URL = 'https://www.max.co.il/homepage/personal';
/**
 * Mock the categories API call.
 * @returns the fetch mock
 */
function mockCategories(): typeof FETCH_GET {
  (FETCH_GET as jest.Mock).mockResolvedValueOnce({ result: [{ id: 1, name: 'מזון' }] });
  return FETCH_GET;
}
/**
 * Mock a single month of transaction data.
 * @param txns - transactions to include
 * @returns the fetch mock
 */
function mockTxnMonth(txns: ReturnType<typeof RAW_TXN>[] = []): typeof FETCH_GET {
  (FETCH_GET as jest.Mock).mockResolvedValueOnce({ result: { transactions: txns } });
  return FETCH_GET;
}
beforeEach(() => {
  jest.clearAllMocks();
  const page = CREATE_MOCK_PAGE({
    url: jest.fn().mockReturnValue(SUCCESS_URL),
    waitForURL: jest.fn().mockResolvedValue(undefined),
  });
  MOCK_CONTEXT.newPage.mockResolvedValue(page);
  MOCK_BROWSER.newContext.mockResolvedValue(MOCK_CONTEXT);
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(SUCCESS_URL);
});
describe('getMemo', () => {
  type TransactionForMemoTest = Parameters<typeof GET_MEMO>[0];
  test.each<[TransactionForMemoTest, string]>([
    [{ comments: '' }, ''],
    [{ comments: 'comment without funds' }, 'comment without funds'],
    [{ comments: '', fundsTransferReceiverOrTransfer: 'Daniel H' }, 'Daniel H'],
    [
      { comments: '', fundsTransferReceiverOrTransfer: 'Daniel', fundsTransferComment: 'Foo bar' },
      'Daniel: Foo bar',
    ],
    [
      {
        comments: 'tip',
        fundsTransferReceiverOrTransfer: 'Daniel',
        fundsTransferComment: 'Foo bar',
      },
      'tip Daniel: Foo bar',
    ],
  ])('%o should create memo: %s', (transaction, expected) => {
    const memo = GET_MEMO(transaction);
    expect(memo).toBe(expected);
  });
});
describe('login', () => {
  it('succeeds with valid credentials', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN()]);
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(BUILD_CONTEXT_OPTIONS).toHaveBeenCalled();
  });
  it('returns InvalidPassword when error dialog appears', async () => {
    const errorLoc = CREATE_ERROR_LOC();
    const loginPage = CREATE_MOCK_PAGE({
      url: jest.fn().mockReturnValue('https://www.max.co.il/login'),
      waitForURL: jest.fn().mockResolvedValue(undefined),
      getByText: jest.fn().mockReturnValue(errorLoc),
    });
    MOCK_CONTEXT.newPage.mockResolvedValue(loginPage);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://www.max.co.il/login');
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.InvalidPassword);
  });
  it('returns ChangePassword for renewal URL', async () => {
    const renewPage = CREATE_MOCK_PAGE({
      url: jest.fn().mockReturnValue('https://www.max.co.il/renew-password'),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    });
    MOCK_CONTEXT.newPage.mockResolvedValue(renewPage);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://www.max.co.il/renew-password');
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.ChangePassword);
  });
});
describe('fetchData', () => {
  it('fetches and converts normal transactions', async () => {
    mockCategories();
    mockTxnMonth([
      RAW_TXN({ originalAmount: 250, actualPaymentAmount: '250', merchantName: 'רמי לוי' }),
    ]);
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts?.[0]?.accountNumber).toBe('4580');
    expect(result.accounts?.[0]?.txns[0]).toMatchObject({
      originalAmount: -250,
      description: 'רמי לוי',
      originalCurrency: SHEKEL_CURRENCY,
      chargedCurrency: SHEKEL_CURRENCY,
      status: TX_STATUSES.Completed,
      type: TX_TYPES.Normal,
    });
  });
  it('detects installment transactions from planName', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN({ planName: 'תשלומים', comments: 'תשלום 3 מתוך 12' })]);
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);
    const firstTxn = result.accounts?.[0]?.txns[0];
    expect(firstTxn?.type).toBe(TX_TYPES.Installments);
    expect(firstTxn?.installments).toEqual({ number: 3, total: 12 });
  });
  it('detects installments from planTypeId fallback', async () => {
    mockCategories();
    mockTxnMonth([
      RAW_TXN({ planName: 'unknown plan', planTypeId: 2, comments: 'תשלום 1 מתוך 6' }),
    ]);
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);
    const firstTxn = result.accounts?.[0]?.txns[0];
    expect(firstTxn?.type).toBe(TX_TYPES.Installments);
  });
  it('marks pending transactions (paymentDate=null)', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN({ paymentDate: null })]);
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.status).toBe(TX_STATUSES.Pending);
  });
  it('maps currency IDs correctly', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN({ paymentCurrency: 840, originalCurrency: DOLLAR_CURRENCY })]);
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.chargedCurrency).toBe(DOLLAR_CURRENCY);
  });
  it('handles empty month response', async () => {
    mockCategories();
    (FETCH_GET as jest.Mock).mockResolvedValueOnce({ result: null });
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });
  it('filters out summary rows without planName', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN(), RAW_TXN({ planName: '' })]);
    const scraper = new MAX_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);
    expect(result.accounts?.[0]?.txns).toHaveLength(1);
  });
  it('calls fixInstallments when shouldCombineInstallments=false', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN()]);
    const opts = CREATE_OPTS({ shouldCombineInstallments: false });
    await new MAX_SCRAPER(opts).scrape(CREDS);
    expect(FIX_INSTALLMENTS).toHaveBeenCalled();
  });
  it('skips fixInstallments when shouldCombineInstallments=true', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN()]);
    const opts = CREATE_OPTS({ shouldCombineInstallments: true });
    await new MAX_SCRAPER(opts).scrape(CREDS);
    expect(FIX_INSTALLMENTS).not.toHaveBeenCalled();
  });

  it('calls filterOldTransactions by default', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN()]);
    await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(FILTER_OLD).toHaveBeenCalled();
  });
  it('includes rawTransaction when option set', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN()]);
    const opts = CREATE_OPTS({ includeRawTransaction: true });
    const result = await new MAX_SCRAPER(opts).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.rawTransaction).toBeDefined();
  });
  it('builds identifier from ARN and installment number', async () => {
    mockCategories();
    mockTxnMonth([
      RAW_TXN({
        planName: 'תשלומים',
        comments: 'תשלום 2 מתוך 5',
        dealData: { arn: 'ARN123' },
      }),
    ]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.identifier).toBe('ARN123_2');
  });
  it('uses ARN alone when no installments', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN({ dealData: { arn: 'ARN456' } })]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.identifier).toBe('ARN456');
  });
  it('groups transactions by card number', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN({ shortCardNumber: '1111' }), RAW_TXN({ shortCardNumber: '2222' })]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts).toHaveLength(2);
    const accountNumbers = result.accounts?.map(acct => acct.accountNumber).sort();
    expect(accountNumbers).toEqual(['1111', '2222']);
  });
  it('assigns category from loaded categories', async () => {
    mockCategories();
    mockTxnMonth([RAW_TXN({ categoryId: 1 })]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.category).toBe('מזון');
  });
});
