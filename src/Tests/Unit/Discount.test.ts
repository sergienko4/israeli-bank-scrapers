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
  getDebug: () => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const { buildContextOptions } = await import('../../Common/Browser.js');
const { launchCamoufox } = await import('../../Common/CamoufoxLauncher.js');
const { fetchGetWithinPage } = await import('../../Common/Fetch.js');
const { getCurrentUrl, waitForNavigation } = await import('../../Common/Navigation.js');
const { ScraperErrorTypes } = await import('../../Scrapers/Base/Errors.js');
const { default: DiscountScraper } = await import('../../Scrapers/Discount/DiscountScraper.js');
const { TransactionStatuses, TransactionTypes } = await import('../../Transactions.js');
const { createMockPage, createMockScraperOptions } = await import('../MockPage.js');

const mockContext = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { id: '123456789', password: 'pass123', num: '1234' };

function mockAccountsData(
  accounts: { AccountID: string }[] = [{ AccountID: '12-345-67890' }],
): void {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    UserAccountsData: {
      DefaultAccountNumber: accounts[0].AccountID,
      UserAccounts: accounts.map(a => ({ NewAccountInfo: a })),
    },
  });
}

interface DiscountTxn {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

function mockTransactions(
  txns: DiscountTxn[] = [],
  futureTxns: DiscountTxn[] = [],
  balance = 5000,
): void {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    CurrentAccountLastTransactions: {
      OperationEntry: txns,
      CurrentAccountInfo: { AccountBalance: balance },
      FutureTransactionsBlock: { FutureTransactionEntry: futureTxns },
    },
  });
}

function txn(overrides: Partial<DiscountTxn> = {}): DiscountTxn {
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
  (launchCamoufox as jest.Mock).mockResolvedValue(mockBrowser);
  mockContext.newPage.mockResolvedValue(createMockPage());
  (getCurrentUrl as jest.Mock).mockResolvedValue(
    'https://start.telebank.co.il/apollo/retail/#/MY_ACCOUNT_HOMEPAGE',
  );
});

describe('login', () => {
  it('succeeds when navigating to success URL', async () => {
    mockAccountsData();
    mockTransactions([txn()]);
    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });

  it('returns InvalidPassword for invalid password URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue(
      'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE',
    );
    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('returns ChangePassword for password renewal URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue(
      'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/PWD_RENEW',
    );
    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions for a single account', async () => {
    mockAccountsData([{ AccountID: '12-345-67890' }]);
    mockTransactions([txn({ OperationAmount: -250, OperationDescriptionToDisplay: 'רמי לוי' })]);

    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('12-345-67890');

    const t = result.accounts![0].txns[0];
    expect(t.originalAmount).toBe(-250);
    expect(t.description).toBe('רמי לוי');
    expect(t.originalCurrency).toBe('ILS');
    expect(t.status).toBe(TransactionStatuses.Completed);
    expect(t.type).toBe(TransactionTypes.Normal);
  });

  it('handles multiple accounts', async () => {
    mockAccountsData([{ AccountID: '111' }, { AccountID: '222' }]);
    mockTransactions([txn()]);
    mockTransactions([txn({ OperationAmount: -50 })]);

    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts![0].accountNumber).toBe('111');
    expect(result.accounts![1].accountNumber).toBe('222');
  });

  it('returns error when accountInfo is null', async () => {
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
    expect(result.errorMessage).toBe('failed to get account data');
  });

  it('returns error when transaction response has Error field', async () => {
    mockAccountsData();
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      Error: { MsgText: 'שגיאה בשרת' },
    });

    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('שגיאה בשרת');
  });

  it('returns success with 0 transactions when CurrentAccountLastTransactions is absent', async () => {
    mockAccountsData();
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({});

    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts![0].txns).toHaveLength(0);
  });

  it('includes pending (future) transactions', async () => {
    mockAccountsData();
    mockTransactions(
      [txn({ OperationAmount: -100 })],
      [txn({ OperationAmount: -50, OperationDescriptionToDisplay: 'עתידי' })],
    );

    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(2);
    const pending = result.accounts![0].txns.find(t => t.status === TransactionStatuses.Pending);
    expect(pending).toBeDefined();
    expect(pending!.description).toBe('עתידי');
  });

  it('returns empty when transactions array is null', async () => {
    mockAccountsData();
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
      CurrentAccountLastTransactions: {
        OperationEntry: null,
        CurrentAccountInfo: { AccountBalance: 0 },
        FutureTransactionsBlock: { FutureTransactionEntry: null },
      },
    });

    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts![0].txns).toHaveLength(0);
  });

  it('includes rawTransaction when option is set', async () => {
    mockAccountsData();
    mockTransactions([txn()]);

    const scraper = new DiscountScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });

  it('includes account balance', async () => {
    mockAccountsData();
    mockTransactions([txn()], [], 12345);

    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].balance).toBe(12345);
  });
});

describe('postAction', () => {
  it('uses waitForURL for SPA route change (not waitForNavigation)', async () => {
    mockAccountsData();
    mockTransactions([txn()]);

    const scraper = new DiscountScraper(createMockScraperOptions());
    await scraper.scrape(CREDS);

    // postAction now uses page.waitForURL('**/apollo/**') instead of waitForNavigation
    expect(waitForNavigation).not.toHaveBeenCalled();
  });
});
