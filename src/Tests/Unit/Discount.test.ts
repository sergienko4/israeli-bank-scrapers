import { buildContextOptions } from '../../Common/Browser';
import { launchWithEngine } from '../../Common/BrowserEngine';
import { waitUntilElementFound } from '../../Common/ElementsInteractions';
import { fetchGetWithinPage } from '../../Common/Fetch';
import { getCurrentUrl, waitForNavigation } from '../../Common/Navigation';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import DiscountScraper from '../../Scrapers/Discount/DiscountScraper';
import { TransactionStatuses, TransactionTypes } from '../../Transactions';
import { createMockPage, createMockScraperOptions } from '../MockPage';

jest.mock('../../Common/BrowserEngine', () => ({
  launchWithEngine: jest.fn(),
  getGlobalEngineChain: jest.fn().mockReturnValue(['playwright-stealth']),
  BrowserEngineType: {
    Camoufox: 'camoufox',
    PlaywrightStealth: 'playwright-stealth',
    Rebrowser: 'rebrowser',
    Patchright: 'patchright',
  },
}));
jest.mock('../../Common/Fetch', () => ({
  fetchGetWithinPage: jest.fn(),
}));
jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../../Common/Navigation', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest
    .fn()
    .mockResolvedValue('https://start.telebank.co.il/apollo/retail/#/MY_ACCOUNT_HOMEPAGE'),
}));
jest.mock('../../Common/ElementsInteractions', () => ({
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../Common/Transactions', () => ({
  getRawTransaction: jest.fn((data: unknown) => data),
}));
jest.mock('../../Common/Debug', () => ({
  /**
   * Returns a set of jest mock functions as a debug logger stub.
   *
   * @returns a mock debug logger with debug, info, warn, and error functions
   */
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

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
 * Sets up the fetchGetWithinPage mock to return account data for Discount tests.
 *
 * @param accounts - the accounts to include in the mock response
 */
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

/**
 * Sets up the fetchGetWithinPage mock to return transaction data for Discount tests.
 *
 * @param txns - completed transactions to include in the response
 * @param futureTxns - pending/future transactions to include
 * @param balance - the account balance to return
 */
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

/**
 * Creates a mock DiscountTxn for unit tests.
 *
 * @param overrides - optional field overrides for the mock transaction
 * @returns a DiscountTxn object for testing
 */
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
  (launchWithEngine as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const freshPage = createMockPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(freshPage);
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
    expect((result.accounts ?? [])[0].accountNumber).toBe('12-345-67890');

    const t = (result.accounts ?? [])[0].txns[0];
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
    expect((result.accounts ?? [])[0].accountNumber).toBe('111');
    expect((result.accounts ?? [])[1].accountNumber).toBe('222');
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
    expect((result.accounts ?? [])[0].txns).toHaveLength(0);
  });

  it('includes pending (future) transactions', async () => {
    mockAccountsData();
    mockTransactions(
      [txn({ OperationAmount: -100 })],
      [txn({ OperationAmount: -50, OperationDescriptionToDisplay: 'עתידי' })],
    );

    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns).toHaveLength(2);
    const pending = (result.accounts ?? [])[0].txns.find(
      t => t.status === TransactionStatuses.Pending,
    );
    expect(pending).toBeDefined();
    expect(pending?.description).toBe('עתידי');
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
    expect((result.accounts ?? [])[0].txns).toHaveLength(0);
  });

  it('includes rawTransaction when option is set', async () => {
    mockAccountsData();
    mockTransactions([txn()]);

    const scraper = new DiscountScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });

  it('includes account balance', async () => {
    mockAccountsData();
    mockTransactions([txn()], [], 12345);

    const scraper = new DiscountScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].balance).toBe(12345);
  });
});

describe('navigateOrErrorLabel', () => {
  it('calls waitForNavigation in postAction', async () => {
    mockAccountsData();
    mockTransactions([txn()]);

    const scraper = new DiscountScraper(createMockScraperOptions());
    await scraper.scrape(CREDS);

    expect(waitForNavigation).toHaveBeenCalled();
  });

  it('falls back to error element when navigation throws', async () => {
    (waitForNavigation as jest.Mock).mockRejectedValueOnce(new Error('nav timeout'));
    mockAccountsData();
    mockTransactions([txn()]);

    const scraper = new DiscountScraper(createMockScraperOptions());
    await scraper.scrape(CREDS);

    const anyArg = expect.anything() as unknown;
    expect(waitUntilElementFound).toHaveBeenCalledWith(anyArg, '#general-error', {
      visible: false,
      timeout: 100,
    });
  });
});
