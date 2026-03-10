import { jest } from '@jest/globals';

import type { IScrapedTransaction } from '../../Scrapers/Max/MaxScraper.js';

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
jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Debug factory.
   * @returns mock logger
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));
jest.unstable_mockModule('../../Common/Dates.js', () => ({
  default: jest.fn(() => [MOMENT('2024-06-01')]),
}));
jest.unstable_mockModule('../../Common/WellKnownLocators.js', () => {
  const s: Record<string, jest.Mock> = {
    first: jest.fn(),
    waitFor: jest.fn().mockResolvedValue(undefined),
    fill: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
    and: jest.fn(),
    getByPlaceholder: jest.fn(),
    getByRole: jest.fn(),
    locator: jest.fn(),
  };
  for (const k of ['first', 'and', 'getByPlaceholder', 'getByRole', 'locator'])
    s[k].mockReturnValue(s);
  const rv = jest.fn().mockReturnValue(s);
  return { wellKnownPlaceholder: rv, wellKnownSubmitButton: rv, findFormByField: rv };
});

const { default: MOMENT } = await import('moment');
const { buildContextOptions: BUILD_CONTEXT_OPTIONS } = await import('../../Common/Browser.js');
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { elementPresentOnPage: ELEMENT_PRESENT } =
  await import('../../Common/ElementsInteractions.js');
const { fetchGetWithinPage: FETCH_GET } = await import('../../Common/Fetch.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { filterOldTransactions: FILTER_OLD, fixInstallments: FIX_INSTALLMENTS } =
  await import('../../Common/Transactions.js');
const { DOLLAR_CURRENCY, SHEKEL_CURRENCY } = await import('../../Constants.js');
const { ScraperErrorTypes: ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: MAX_SCRAPER, getMemo: GET_MEMO } =
  await import('../../Scrapers/Max/MaxScraper.js');
const { TransactionStatuses: TX_STATUSES, TransactionTypes: TX_TYPES } =
  await import('../../Transactions.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');

const MOCK_CONTEXT = { newPage: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};
const CREDS = { username: 'testuser', password: 'testpass' };

/**
 * Mocks the categories API call.
 * @returns the fetch mock
 */
function mockCategories(): typeof FETCH_GET {
  (FETCH_GET as jest.Mock).mockResolvedValueOnce({ result: [{ id: 1, name: 'מזון' }] });
  return FETCH_GET;
}

/**
 * Mocks a single month of transaction data.
 * @param txns - transactions to include
 * @returns the fetch mock
 */
function mockTxnMonth(txns: IScrapedTransaction[] = []): typeof FETCH_GET {
  (FETCH_GET as jest.Mock).mockResolvedValueOnce({ result: { transactions: txns } });
  return FETCH_GET;
}

/**
 * Creates a raw Max transaction with sensible defaults.
 * @param overrides - fields to override
 * @returns a scraped transaction
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
  const page = CREATE_MOCK_PAGE({
    url: jest.fn().mockReturnValue('https://www.max.co.il/homepage/personal'),
    waitForURL: jest.fn().mockResolvedValue(undefined),
  });
  MOCK_CONTEXT.newPage.mockResolvedValue(page);
  MOCK_CONTEXT.close.mockResolvedValue(undefined);
  MOCK_BROWSER.newContext.mockResolvedValue(MOCK_CONTEXT);
  MOCK_BROWSER.close.mockResolvedValue(undefined);
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://www.max.co.il/homepage/personal');
  (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(false);
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
    mockTxnMonth([rawTxn()]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.success).toBe(true);
    expect(BUILD_CONTEXT_OPTIONS).toHaveBeenCalled();
  });

  it('returns InvalidPassword when error dialog appears', async () => {
    const loginPage = CREATE_MOCK_PAGE({
      url: jest.fn().mockReturnValue('https://www.max.co.il/login'),
      waitForURL: jest.fn().mockResolvedValue(undefined),
    });
    MOCK_CONTEXT.newPage.mockResolvedValue(loginPage);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://www.max.co.il/login');
    (ELEMENT_PRESENT as jest.Mock)
      .mockResolvedValueOnce(false) // #closePopup
      .mockResolvedValueOnce(true) // #popupWrongDetails
      .mockResolvedValueOnce(false); // #popupCardHoldersLoginError
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
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
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.ChangePassword);
  });
});

describe('fetchData', () => {
  it('fetches and converts normal transactions', async () => {
    mockCategories();
    mockTxnMonth([
      rawTxn({ originalAmount: 250, actualPaymentAmount: '250', merchantName: 'רמי לוי' }),
    ]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
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
    mockTxnMonth([rawTxn({ planName: 'תשלומים', comments: 'תשלום 3 מתוך 12' })]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.type).toBe(TX_TYPES.Installments);
    expect(result.accounts?.[0]?.txns[0]?.installments).toEqual({ number: 3, total: 12 });
  });

  it('detects installments from planTypeId fallback', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ planName: 'unknown plan', planTypeId: 2, comments: 'תשלום 1 מתוך 6' })]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.type).toBe(TX_TYPES.Installments);
  });

  it('marks pending transactions (paymentDate=null)', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ paymentDate: null })]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.status).toBe(TX_STATUSES.Pending);
  });

  it('maps currency IDs correctly', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ paymentCurrency: 840, originalCurrency: DOLLAR_CURRENCY })]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.chargedCurrency).toBe(DOLLAR_CURRENCY);
  });

  it('handles empty month response', async () => {
    mockCategories();
    (FETCH_GET as jest.Mock).mockResolvedValueOnce({ result: null });
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(0);
  });

  it('filters out summary rows without planName', async () => {
    mockCategories();
    mockTxnMonth([rawTxn(), rawTxn({ planName: '' })]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns).toHaveLength(1);
  });

  it('calls fixInstallments when shouldCombineInstallments=false', async () => {
    mockCategories();
    mockTxnMonth([rawTxn()]);
    await new MAX_SCRAPER(CREATE_OPTS({ shouldCombineInstallments: false })).scrape(CREDS);
    expect(FIX_INSTALLMENTS).toHaveBeenCalled();
  });

  it('skips fixInstallments when shouldCombineInstallments=true', async () => {
    mockCategories();
    mockTxnMonth([rawTxn()]);
    await new MAX_SCRAPER(CREATE_OPTS({ shouldCombineInstallments: true })).scrape(CREDS);
    expect(FIX_INSTALLMENTS).not.toHaveBeenCalled();
  });

  it('calls filterOldTransactions by default', async () => {
    mockCategories();
    mockTxnMonth([rawTxn()]);
    await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(FILTER_OLD).toHaveBeenCalled();
  });

  it('includes rawTransaction when option set', async () => {
    mockCategories();
    mockTxnMonth([rawTxn()]);
    const result = await new MAX_SCRAPER(CREATE_OPTS({ includeRawTransaction: true })).scrape(
      CREDS,
    );
    expect(result.accounts?.[0]?.txns[0]?.rawTransaction).toBeDefined();
  });

  it('builds identifier from ARN and installment number', async () => {
    mockCategories();
    mockTxnMonth([
      rawTxn({ planName: 'תשלומים', comments: 'תשלום 2 מתוך 5', dealData: { arn: 'ARN123' } }),
    ]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.identifier).toBe('ARN123_2');
  });

  it('uses ARN alone when no installments', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ dealData: { arn: 'ARN456' } })]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.identifier).toBe('ARN456');
  });

  it('groups transactions by card number', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ shortCardNumber: '1111' }), rawTxn({ shortCardNumber: '2222' })]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts?.map(a => a.accountNumber).sort()).toEqual(['1111', '2222']);
  });

  it('assigns category from loaded categories', async () => {
    mockCategories();
    mockTxnMonth([rawTxn({ categoryId: 1 })]);
    const result = await new MAX_SCRAPER(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.category).toBe('מזון');
  });
});
