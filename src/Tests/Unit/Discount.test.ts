import { jest } from '@jest/globals';
jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule('../../Common/Fetch.js', () => ({
  fetchGetWithinPage: jest.fn(),
}));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest
    .fn()
    .mockResolvedValue('https://start.telebank.co.il/apollo/retail/#/MY_ACCOUNT_HOMEPAGE'),

  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),

  waitForRedirect: jest.fn().mockResolvedValue(undefined),

  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),

  elementPresentOnPage: jest.fn().mockResolvedValue(false),

  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  getRawTransaction: jest.fn((data: unknown) => data),
}));

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger with all methods stubbed.
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const BUILD_CONTEXT_OPTIONS = await import('../../Common/Browser.js');
const LAUNCH_CAMOUFOX = await import('../../Common/CamoufoxLauncher.js');
const FETCH_MODULE = await import('../../Common/Fetch.js');
const NAV_MODULE = await import('../../Common/Navigation.js');
const ERRORS_MODULE = await import('../../Scrapers/Base/Errors.js');
const DISCOUNT_MODULE = await import('../../Scrapers/Discount/DiscountScraper.js');
const TXN_TYPES = await import('../../Transactions.js');
const MOCK_HELPERS = await import('../MockPage.js');

const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { id: '123456789', password: 'pass123', num: '1234' };

/**
 * Mock the accounts data API response.
 * @param accounts - array of account objects with AccountID.
 * @returns true after mocking the response.
 */
function mockAccountsData(
  accounts: { AccountID: string }[] = [{ AccountID: '12-345-67890' }],
): boolean {
  (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    UserAccountsData: {
      DefaultAccountNumber: accounts[0].AccountID,
      UserAccounts: accounts.map(acct => ({ NewAccountInfo: acct })),
    },
  });
  return true;
}

interface IDiscountTxn {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

/**
 * Mock the transactions API response.
 * @param txns - array of completed transactions.
 * @param futureTxns - array of pending/future transactions.
 * @param balance - account balance value.
 * @returns true after mocking the response.
 */
function mockTransactions(
  txns: IDiscountTxn[] = [],
  futureTxns: IDiscountTxn[] = [],
  balance = 5000,
): boolean {
  (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    CurrentAccountLastTransactions: {
      OperationEntry: txns,
      CurrentAccountInfo: { AccountBalance: balance },
      FutureTransactionsBlock: { FutureTransactionEntry: futureTxns },
    },
  });
  return true;
}

/**
 * Create a test transaction with optional overrides.
 * @param overrides - partial transaction fields to merge with defaults.
 * @returns complete discount transaction object.
 */
function txn(overrides: Partial<IDiscountTxn> = {}): IDiscountTxn {
  return {
    OperationNumber: 1001,
    OperationDate: '20240615',
    ValueDate: '20240616',
    OperationAmount: -150,
    OperationDescriptionToDisplay: 'סופר שופ',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (LAUNCH_CAMOUFOX.launchCamoufox as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const mockPage = MOCK_HELPERS.createMockPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(mockPage);
  (NAV_MODULE.getCurrentUrl as jest.Mock).mockResolvedValue(
    'https://start.telebank.co.il/apollo/retail/#/MY_ACCOUNT_HOMEPAGE',
  );
});

describe('login', () => {
  it('succeeds when navigating to success URL', async () => {
    mockAccountsData();
    mockTransactions([txn()]);
    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(BUILD_CONTEXT_OPTIONS.buildContextOptions).toHaveBeenCalled();
  });

  it('returns InvalidPassword for invalid password URL', async () => {
    (NAV_MODULE.getCurrentUrl as jest.Mock).mockResolvedValue(
      'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE',
    );
    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERRORS_MODULE.ScraperErrorTypes.InvalidPassword);
  });

  it('returns ChangePassword for password renewal URL', async () => {
    (NAV_MODULE.getCurrentUrl as jest.Mock).mockResolvedValue(
      'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW',
    );
    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERRORS_MODULE.ScraperErrorTypes.ChangePassword);
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions for a single account', async () => {
    mockAccountsData([{ AccountID: '12-345-67890' }]);
    const txnData = txn({ OperationAmount: -250, OperationDescriptionToDisplay: 'רמי לוי' });
    mockTransactions([txnData]);

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    const accounts = result.accounts ?? [];
    expect(accounts[0].accountNumber).toBe('12-345-67890');

    const transaction = accounts[0].txns[0];
    expect(transaction.originalAmount).toBe(-250);
    expect(transaction.description).toBe('רמי לוי');
    expect(transaction.originalCurrency).toBe('ILS');
    expect(transaction.status).toBe(TXN_TYPES.TransactionStatuses.Completed);
    expect(transaction.type).toBe(TXN_TYPES.TransactionTypes.Normal);
  });

  it('handles multiple accounts', async () => {
    mockAccountsData([{ AccountID: '111' }, { AccountID: '222' }]);
    mockTransactions([txn()]);
    mockTransactions([txn({ OperationAmount: -50 })]);

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(2);
    const accounts = result.accounts ?? [];
    expect(accounts[0].accountNumber).toBe('111');
    expect(accounts[1].accountNumber).toBe('222');
  });

  it('returns error when accountInfo is null', async () => {
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Failed to fetch account data');
  });

  it('returns error when transaction response has Error field', async () => {
    mockAccountsData();
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      Error: { MsgText: 'שגיאה בשרת' },
    });

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('שגיאה בשרת');
  });

  it('returns success with 0 txns when CurrentAccountLastTransactions is absent', async () => {
    mockAccountsData();
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({});

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    const accounts = result.accounts ?? [];
    expect(accounts[0].txns).toHaveLength(0);
  });

  it('includes pending (future) transactions', async () => {
    mockAccountsData();
    mockTransactions(
      [txn({ OperationAmount: -100 })],
      [txn({ OperationAmount: -50, OperationDescriptionToDisplay: 'עתידי' })],
    );

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    const accounts = result.accounts ?? [];
    expect(accounts[0].txns).toHaveLength(2);
    const pending = accounts[0].txns.find(
      transaction => transaction.status === TXN_TYPES.TransactionStatuses.Pending,
    );
    expect(pending).toBeDefined();
    expect(pending?.description).toBe('עתידי');
  });

  it('returns empty when transactions array is null', async () => {
    mockAccountsData();
    (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      CurrentAccountLastTransactions: {
        OperationEntry: null,
        CurrentAccountInfo: { AccountBalance: 0 },
        FutureTransactionsBlock: { FutureTransactionEntry: null },
      },
    });

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    const accounts = result.accounts ?? [];
    expect(accounts[0].txns).toHaveLength(0);
  });

  it('includes rawTransaction when option is set', async () => {
    mockAccountsData();
    mockTransactions([txn()]);

    const opts = MOCK_HELPERS.createMockScraperOptions({ includeRawTransaction: true });
    const scraper = new DISCOUNT_MODULE.default(opts);
    const result = await scraper.scrape(CREDS);

    const accounts = result.accounts ?? [];
    expect(accounts[0].txns[0].rawTransaction).toBeDefined();
  });

  it('includes account balance', async () => {
    mockAccountsData();
    mockTransactions([txn()], [], 12345);

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    const accounts = result.accounts ?? [];
    expect(accounts[0].balance).toBe(12345);
  });
});

describe('postAction', () => {
  it('uses waitForURL for SPA route change (not waitForNavigation)', async () => {
    mockAccountsData();
    mockTransactions([txn()]);

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    await scraper.scrape(CREDS);

    // postAction now uses page.waitForURL('**/apollo/**') instead of waitForNavigation
    expect(NAV_MODULE.waitForNavigation).not.toHaveBeenCalled();
  });
});
