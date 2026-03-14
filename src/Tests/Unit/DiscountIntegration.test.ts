import { jest } from '@jest/globals';

import {
  createBrowserMock,
  createCamoufoxMock,
  createDebugMock,
  createElementsMock,
  createFetchMock,
  createNavigationMock,
  createTransactionsMock,
} from '../MockModuleFactories.js';
import { DISCOUNT_LOGIN_PAGE_URL, DISCOUNT_SUCCESS_URL } from '../TestConstants.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', createCamoufoxMock);
jest.unstable_mockModule('../../Common/Fetch.js', createFetchMock);
jest.unstable_mockModule('../../Common/Browser.js', createBrowserMock);
jest.unstable_mockModule('../../Common/Navigation.js', () =>
  createNavigationMock(DISCOUNT_SUCCESS_URL),
);
jest.unstable_mockModule('../../Common/ElementsInteractions.js', createElementsMock);
jest.unstable_mockModule('../../Common/Transactions.js', createTransactionsMock);
jest.unstable_mockModule('../../Common/Debug.js', createDebugMock);

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
 * Build the user accounts API payload.
 * @param accounts - array of account objects with AccountID.
 * @returns payload matching Discount accounts API shape.
 */
function createUserAccountsPayload(accounts: { AccountID: string }[]): Record<string, object> {
  const defaultId = accounts[0]?.AccountID ?? '';
  const mapped = accounts.map(acct => ({ NewAccountInfo: acct }));
  return { UserAccountsData: { DefaultAccountNumber: defaultId, UserAccounts: mapped } };
}

/**
 * Mock the accounts data API response.
 * @param accounts - array of account objects with AccountID.
 * @returns true after mocking the response.
 */
function mockAccountsData(
  accounts: { AccountID: string }[] = [{ AccountID: '12-345-67890' }],
): boolean {
  const payload = createUserAccountsPayload(accounts);
  (FETCH_MODULE.fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(payload);
  return true;
}

/**
 * Build the inner transaction block for Discount API response.
 * @param txns - completed transactions.
 * @param futureTxns - pending/future transactions.
 * @param balance - account balance value.
 * @returns inner block matching CurrentAccountLastTransactions shape.
 */
function createTxnBlock(
  txns: IDiscountTxn[],
  futureTxns: IDiscountTxn[],
  balance: number,
): Record<string, object> {
  return {
    OperationEntry: txns,
    CurrentAccountInfo: { AccountBalance: balance },
    FutureTransactionsBlock: { FutureTransactionEntry: futureTxns },
  };
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
  return { CurrentAccountLastTransactions: createTxnBlock(txns, futureTxns, balance) };
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
    (NAV_MODULE.getCurrentUrl as jest.Mock).mockResolvedValue(DISCOUNT_LOGIN_PAGE_URL);

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
    const accounts = result.accounts ?? [];
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountNumber).toBe('00-000-00000');
  });
});
