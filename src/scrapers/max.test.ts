import { chromium } from 'playwright';
import moment from 'moment';
import { SHEKEL_CURRENCY, DOLLAR_CURRENCY } from '../constants';
import { fetchGetWithinPage } from '../helpers/fetch';
import { buildContextOptions } from '../helpers/browser';
import { filterOldTransactions, fixInstallments } from '../helpers/transactions';
import { elementPresentOnPage } from '../helpers/elements-interactions';
import { getCurrentUrl } from '../helpers/navigation';
import { createMockPage, createMockScraperOptions } from '../tests/mock-page';
import MaxScraper, { getMemo, type ScrapedTransaction } from './max';
import { ScraperErrorTypes } from './errors';
import { TransactionStatuses, TransactionTypes } from '../transactions';

jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));
jest.mock('../helpers/fetch', () => ({
  fetchGetWithinPage: jest.fn(),
}));
jest.mock('../helpers/browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../helpers/elements-interactions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
}));
jest.mock('../helpers/navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.max.co.il/homepage/personal'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  waitForRedirect: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../helpers/transactions', () => ({
  fixInstallments: jest.fn(<T>(txns: T[]) => txns),
  filterOldTransactions: jest.fn(<T>(txns: T[]) => txns),
  sortTransactionsByDate: jest.fn(<T>(txns: T[]) => txns),
  getRawTransaction: jest.fn((data: unknown) => data),
}));
jest.mock('../helpers/debug', () => ({ getDebug: () => jest.fn() }));
jest.mock('../helpers/dates', () => {
  return jest.fn(() => [moment('2024-06-01')]);
});

const mockContext = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { username: 'testuser', password: 'testpass' };

function mockCategories(): void {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    result: [{ id: 1, name: 'מזון' }],
  });
}

function mockTxnMonth(txns: ScrapedTransaction[] = []): void {
  (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce({
    result: { transactions: txns },
  });
}

function rawTxn(overrides: Partial<ScrapedTransaction> = {}): ScrapedTransaction {
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
  (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockContext.newPage.mockResolvedValue(createMockPage());
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://www.max.co.il/homepage/personal');
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

describe('getMemo', () => {
  type TransactionForMemoTest = Parameters<typeof getMemo>[0];
  test.each<[TransactionForMemoTest, string]>([
    [{ comments: '' }, ''],
    [{ comments: 'comment without funds' }, 'comment without funds'],
    [{ comments: '', fundsTransferReceiverOrTransfer: 'Daniel H' }, 'Daniel H'],
    [{ comments: '', fundsTransferReceiverOrTransfer: 'Daniel', fundsTransferComment: 'Foo bar' }, 'Daniel: Foo bar'],
    [
      { comments: 'tip', fundsTransferReceiverOrTransfer: 'Daniel', fundsTransferComment: 'Foo bar' },
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
    mockTxnMonth([rawTxn({ originalAmount: 250, actualPaymentAmount: '250', merchantName: 'רמי לוי' })]);

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('4580');

    const t = result.accounts![0].txns[0];
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

    const t = result.accounts![0].txns[0];
    expect(t.type).toBe(TransactionTypes.Installments);
    expect(t.installments).toEqual({ number: 3, total: 12 });
  });

  it('detects installments from planTypeId fallback', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ planName: 'unknown plan', planTypeId: 2, comments: 'תשלום 1 מתוך 6' })]);

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    const t = result.accounts![0].txns[0];
    expect(t.type).toBe(TransactionTypes.Installments);
  });

  it('marks pending transactions (paymentDate=null)', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ paymentDate: null })]);

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].status).toBe(TransactionStatuses.Pending);
  });

  it('maps currency IDs correctly', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ paymentCurrency: 840, originalCurrency: DOLLAR_CURRENCY })]);

    const scraper = new MaxScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].chargedCurrency).toBe(DOLLAR_CURRENCY);
  });

  it('handles empty month response', async () => {
    mockCategories();
    (fetchGetWithinPage as jest.Mock).mockResolvedValueOnce(null);

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

    expect(result.accounts![0].txns).toHaveLength(1);
  });

  it('calls fixInstallments when combineInstallments=false', async () => {
    mockCategories();
    mockTxnMonth([rawTxn()]);

    await new MaxScraper(createMockScraperOptions({ combineInstallments: false })).scrape(CREDS);
    expect(fixInstallments).toHaveBeenCalled();
  });

  it('skips fixInstallments when combineInstallments=true', async () => {
    mockCategories();
    mockTxnMonth([rawTxn()]);

    await new MaxScraper(createMockScraperOptions({ combineInstallments: true })).scrape(CREDS);
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

    const result = await new MaxScraper(createMockScraperOptions({ includeRawTransaction: true })).scrape(CREDS);
    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
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
    expect(result.accounts![0].txns[0].identifier).toBe('ARN123_2');
  });

  it('uses ARN alone when no installments', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ dealData: { arn: 'ARN456' } })]);

    const result = await new MaxScraper(createMockScraperOptions()).scrape(CREDS);
    expect(result.accounts![0].txns[0].identifier).toBe('ARN456');
  });

  it('groups transactions by card number', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ shortCardNumber: '1111' }), rawTxn({ shortCardNumber: '2222' })]);

    const result = await new MaxScraper(createMockScraperOptions()).scrape(CREDS);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts!.map(a => a.accountNumber).sort()).toEqual(['1111', '2222']);
  });

  it('assigns category from loaded categories', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ categoryId: 1 })]);

    const result = await new MaxScraper(createMockScraperOptions()).scrape(CREDS);
    expect(result.accounts![0].txns[0].category).toBe('מזון');
  });
});
