import { jest } from '@jest/globals';

import { DISCOUNT_SUCCESS_URL } from '../TestConstants.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule('../../Common/Fetch.js', () => ({
  fetchGetWithinPage: jest.fn(),
}));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest.fn().mockResolvedValue(DISCOUNT_SUCCESS_URL),
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
  getRawTransaction: jest.fn(
    (data: Record<string, string | number>): Record<string, string | number> => data,
  ),
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
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

const LAUNCH_CAMOUFOX = await import('../../Common/CamoufoxLauncher.js');
const FETCH_MODULE = await import('../../Common/Fetch.js');
const NAV_MODULE = await import('../../Common/Navigation.js');
const ERRORS_MODULE = await import('../../Scrapers/Base/Errors.js');
const DISCOUNT_MODULE = await import('../../Scrapers/Discount/DiscountScraper.js');
const TXN_TYPES = await import('../../Transactions.js');
const MOCK_HELPERS = await import('../MockPage.js');
const INTEGRATION = await import('../IntegrationHelpers.js');

const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { id: '123456789', password: 'pass123', num: '1234' };

interface IDiscountTxn {
  OperationNumber: number;
  OperationDate: string;
  ValueDate: string;
  OperationAmount: number;
  OperationDescriptionToDisplay: string;
}

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

/**
 * Build the raw transaction API response payload.
 * @param txns - completed transactions.
 * @param futureTxns - pending/future transactions.
 * @param balance - account balance value.
 * @returns response object matching Discount API shape.
 */
function buildTxnResponse(
  txns: IDiscountTxn[],
  futureTxns: IDiscountTxn[],
  balance: number,
): Record<string, object> {
  return {
    CurrentAccountLastTransactions: {
      OperationEntry: txns,
      CurrentAccountInfo: { AccountBalance: balance },
      FutureTransactionsBlock: { FutureTransactionEntry: futureTxns },
    },
  };
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
  const response = buildTxnResponse(txns, futureTxns, balance);
  (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(response);
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

describe('integration: full scrape flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (LAUNCH_CAMOUFOX.launchCamoufox as jest.Mock).mockResolvedValue(MOCK_BROWSER);
    const mockPage = MOCK_HELPERS.createMockPage();
    MOCK_CONTEXT.newPage.mockResolvedValue(mockPage);
    (NAV_MODULE.getCurrentUrl as jest.Mock).mockResolvedValue(DISCOUNT_SUCCESS_URL);
  });

  it('happy path: 1 account with completed + pending transactions', async () => {
    mockAccountsData([{ AccountID: '55-123-99999' }]);
    const completed = txn({ OperationAmount: -200, OperationDescriptionToDisplay: 'חשמל' });
    const pending = txn({ OperationAmount: -75, OperationDescriptionToDisplay: 'מים' });
    mockTransactions([completed], [pending], 8500);

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    const accounts = INTEGRATION.assertSuccess(result, 1);
    expect(accounts[0].accountNumber).toBe('55-123-99999');
    expect(accounts[0].txns).toHaveLength(2);
    expect(accounts[0].balance).toBe(8500);

    const completedTxn = accounts[0].txns.find(
      t => t.status === TXN_TYPES.TransactionStatuses.Completed,
    );
    const pendingTxn = accounts[0].txns.find(
      t => t.status === TXN_TYPES.TransactionStatuses.Pending,
    );
    expect(completedTxn?.originalAmount).toBe(-200);
    expect(completedTxn?.description).toBe('חשמל');
    expect(pendingTxn?.originalAmount).toBe(-75);
    expect(pendingTxn?.description).toBe('מים');
  });

  it('invalid login: returns InvalidPassword when URL stays on login page', async () => {
    (NAV_MODULE.getCurrentUrl as jest.Mock).mockResolvedValue(
      'https://start.telebank.co.il/apollo/core/templates/lobby/masterPage.html#/LOGIN_PAGE',
    );

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    INTEGRATION.assertFailure(result, ERRORS_MODULE.ScraperErrorTypes.InvalidPassword);
  });

  it('empty data: succeeds with 0 transactions', async () => {
    mockAccountsData([{ AccountID: '00-000-00000' }]);
    mockTransactions([], [], 0);

    const scraper = new DISCOUNT_MODULE.default(MOCK_HELPERS.createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    INTEGRATION.assertEmptyTxns(result);
  });
});
