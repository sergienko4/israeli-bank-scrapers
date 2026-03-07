import moment from 'moment';

import { buildContextOptions } from '../../Common/Browser';
import { launchWithEngine } from '../../Common/BrowserEngine';
import { elementPresentOnPage } from '../../Common/ElementsInteractions';
import { fetchGetWithinPage } from '../../Common/Fetch';
import { getCurrentUrl } from '../../Common/Navigation';
import { filterOldTransactions, fixInstallments } from '../../Common/Transactions';
import { DOLLAR_CURRENCY, SHEKEL_CURRENCY } from '../../Constants';
import type { IDoneResult } from '../../Interfaces/Common/StepResult';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import MaxScraper, { getMemo, type IScrapedTransaction } from '../../Scrapers/Max/MaxScraper';
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
jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../Common/Navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.max.co.il/homepage/personal'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../Common/Transactions', () => ({
  fixInstallments: jest.fn(<T>(txns: T[]) => txns),
  filterOldTransactions: jest.fn(<T>(txns: T[]) => txns),
  sortTransactionsByDate: jest.fn(<T>(txns: T[]) => txns),
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
jest.mock('../../Common/Dates', () => {
  return jest.fn(() => [moment('2024-06-01')]);
});

const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { username: 'testuser', password: 'testpass' };

/**
 * Sets up fetchGetWithinPage to return a mock Max categories response.
 *
 * @returns a resolved IDoneResult after mocks are configured
 */
function mockCategories(): IDoneResult {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    isFound: true,
    value: { result: [{ id: 1, name: 'מזון' }] },
  });
  return { done: true };
}

/**
 * Sets up fetchGetWithinPage to return a mock Max transaction month response.
 *
 * @param txns - the transactions to include in the mock response
 * @returns a resolved IDoneResult after mocks are configured
 */
function mockTxnMonth(txns: IScrapedTransaction[] = []): IDoneResult {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    isFound: true,
    value: { result: { transactions: txns } },
  });
  return { done: true };
}

/**
 * Creates a mock IScrapedTransaction for Max unit tests.
 *
 * @param overrides - optional field overrides for the mock transaction
 * @returns a IScrapedTransaction object for testing
 */
function rawTxn(overrides: Partial<IScrapedTransaction> = {}): IScrapedTransaction {
  return {
    shortCardNumber: '4580',
    paymentDate: '2024-06-15',
    purchaseDate: '2024-06-10',
    actualPaymentAmount: '100',
    paymentCurrency: 376,
    originalCurrency: SHEKEL_CURRENCY,
    originalAmount: 100,
    planName: 'רגילה',
    planTypeId: 5,
    comments: '',
    merchantName: 'סופר שופ',
    categoryId: 1,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (launchWithEngine as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const freshPage = createMockPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(freshPage);
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://www.max.co.il/homepage/personal');
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

describe('getMemo', () => {
  type TransactionForMemoTest = Parameters<typeof getMemo>[0];
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
    const memo = getMemo(transaction);
    expect(memo).toBe(expected);
  });
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    mockCategories();
    mockTxnMonth([rawTxn()]);
    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });

  it('returns InvalidPassword when error dialog appears', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://www.max.co.il/login');
    (elementPresentOnPage as jest.Mock)
      .mockResolvedValueOnce(false) // #closePopup check in preAction
      .mockResolvedValueOnce(false) // .login-link#private check in preAction
      .mockResolvedValueOnce(true) // #popupWrongDetails check (InvalidPassword)
      .mockResolvedValueOnce(false); // #popupCardHoldersLoginError check

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('returns ChangePassword for renewal URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://www.max.co.il/renew-password');
    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });
});

describe('fetchData', () => {
  it('fetches and converts normal transactions', async () => {
    mockCategories();
    mockTxnMonth([
      rawTxn({ originalAmount: 250, actualPaymentAmount: '250', merchantName: 'רמי לוי' }),
    ]);

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect((result.accounts ?? [])[0].accountNumber).toBe('4580');

    const t = (result.accounts ?? [])[0].txns[0];
    expect(t.originalAmount).toBe(-250);
    expect(t.description).toBe('רמי לוי');
    expect(t.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(t.chargedCurrency).toBe(SHEKEL_CURRENCY);
    expect(t.status).toBe(TransactionStatuses.Completed);
    expect(t.type).toBe(TransactionTypes.Normal);
  });

  it('detects installment transactions from planName', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ planName: 'תשלומים', comments: 'תשלום 3 מתוך 12' })]);

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    const t = (result.accounts ?? [])[0].txns[0];
    expect(t.type).toBe(TransactionTypes.Installments);
    expect(t.installments).toEqual({ number: 3, total: 12 });
  });

  it('detects installments from planTypeId fallback', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ planName: 'unknown plan', planTypeId: 2, comments: 'תשלום 1 מתוך 6' })]);

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    const t = (result.accounts ?? [])[0].txns[0];
    expect(t.type).toBe(TransactionTypes.Installments);
  });

  it('marks pending transactions (paymentDate=null)', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ paymentDate: null })]);

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].status).toBe(TransactionStatuses.Pending);
  });

  it('maps currency IDs correctly', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ paymentCurrency: 840, originalCurrency: DOLLAR_CURRENCY })]);

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].chargedCurrency).toBe(DOLLAR_CURRENCY);
  });

  it('handles empty month response', async () => {
    mockCategories();
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({ isFound: false });

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('filters out summary rows without planName', async () => {
    mockCategories();
    mockTxnMonth([rawTxn(), rawTxn({ planName: '' })]);

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns).toHaveLength(1);
  });

  it('calls fixInstallments when shouldCombineInstallments=false', async () => {
    mockCategories();
    mockTxnMonth([rawTxn()]);

    await new MaxScraper(createMockScraperOptions({ shouldCombineInstallments: false })).scrape(
      CREDS,
    );
    expect(fixInstallments).toHaveBeenCalled();
  });

  it('skips fixInstallments when shouldCombineInstallments=true', async () => {
    mockCategories();
    mockTxnMonth([rawTxn()]);

    await new MaxScraper(createMockScraperOptions({ shouldCombineInstallments: true })).scrape(
      CREDS,
    );
    expect(fixInstallments).not.toHaveBeenCalled();
  });

  it('calls filterOldTransactions by default', async () => {
    mockCategories();
    mockTxnMonth([rawTxn()]);

    await new MaxScraper(createMockScraperOptions()).scrape(CREDS);
    expect(filterOldTransactions).toHaveBeenCalled();
  });

  it('includes rawTransaction when option set', async () => {
    mockCategories();
    mockTxnMonth([rawTxn()]);

    const result = await new MaxScraper(
      createMockScraperOptions({ includeRawTransaction: true }),
    ).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });

  it('builds identifier from ARN and installment number', async () => {
    mockCategories();
    mockTxnMonth([
      rawTxn({
        planName: 'תשלומים',
        comments: 'תשלום 2 מתוך 5',
        dealData: { arn: 'ARN123' },
      }),
    ]);

    const result = await new MaxScraper(createMockScraperOptions()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].identifier).toBe('ARN123_2');
  });

  it('uses ARN alone when no installments', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ dealData: { arn: 'ARN456' } })]);

    const result = await new MaxScraper(createMockScraperOptions()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].identifier).toBe('ARN456');
  });

  it('groups transactions by card number', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ shortCardNumber: '1111' }), rawTxn({ shortCardNumber: '2222' })]);

    const result = await new MaxScraper(createMockScraperOptions()).scrape(CREDS);
    expect(result.accounts).toHaveLength(2);
    const accountNumbers = (result.accounts ?? []).map(a => a.accountNumber).sort();
    expect(accountNumbers).toEqual(['1111', '2222']);
  });

  it('assigns category from loaded categories', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ categoryId: 1 })]);

    const result = await new MaxScraper(createMockScraperOptions()).scrape(CREDS);
    expect((result.accounts ?? [])[0].txns[0].category).toBe('מזון');
  });
});

// maxHandleSecondLoginStep tests live in MaxLoginConfig.test.ts
