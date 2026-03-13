import { jest } from '@jest/globals';

import { type ScraperOptions } from '../../Scrapers/Base/Interface.js';

/**
 * Create a mock that resolves with the given value.
 * @param v - resolved value
 * @returns jest mock that resolves with v
 */
const MOCK_RESOLVED = (v?: unknown): jest.Mock => jest.fn().mockResolvedValue(v);
/**
 * Create a mock logger.
 * @returns mock logger record
 */
const MOCK_LOGGER = (): Record<string, jest.Mock> => ({
  trace: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});
jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));
jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: MOCK_RESOLVED(),
  fillInput: MOCK_RESOLVED(),
  waitUntilElementFound: MOCK_RESOLVED(),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEvalAll: jest.fn().mockResolvedValue([]),
  pageEval: jest.fn().mockResolvedValue(null),
  capturePageText: jest.fn().mockResolvedValue(''),
}));
jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  waitForNavigation: MOCK_RESOLVED(),
  getCurrentUrl: jest.fn().mockResolvedValue('https://test.fibi.co.il/Resources/PortalNG/shell'),
  waitForNavigationAndDomLoad: MOCK_RESOLVED(),
  waitForRedirect: MOCK_RESOLVED(),
  waitForUrl: MOCK_RESOLVED(),
}));
jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  getRawTransaction: jest.fn((data: Record<string, number>): Record<string, number> => data),
}));
jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: MOCK_RESOLVED(),
  humanDelay: MOCK_RESOLVED(),
  runSerial: jest.fn(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const seed = Promise.resolve([] as T[]);
    return actions.reduce(
      (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
      seed,
    );
  }),
  waitUntil: MOCK_RESOLVED(),
  raceTimeout: MOCK_RESOLVED(),
  TimeoutError: Error,
  SECOND: 1000,
}));
jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: MOCK_LOGGER,
  /**
   * Pass-through bank context.
   * @param _b - bank name
   * @param fn - callback
   * @returns callback result
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));
jest.unstable_mockModule('../../Common/OtpHandler.js', () => ({
  handleOtpStep: jest.fn().mockResolvedValue(null),
  handleOtpCode: MOCK_RESOLVED(),
  handleOtpConfirm: MOCK_RESOLVED(),
}));
const { buildContextOptions: BUILD_CONTEXT_OPTIONS } = await import('../../Common/Browser.js');
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const {
  clickButton: CLICK_BUTTON,
  elementPresentOnPage: ELEMENT_PRESENT,
  pageEvalAll: PAGE_EVAL_ALL,
} = await import('../../Common/ElementsInteractions.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { SHEKEL_CURRENCY } = await import('../../Constants.js');
const { ScraperErrorTypes: SCRAPER_ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: BEINLEUMI_GROUP_BASE_SCRAPER } =
  await import('../../Scrapers/BaseBeinleumiGroup/BaseBeinleumiGroup.js');
const { beinleumiConfig: BEINLEUMI_CONFIG } =
  await import('../../Scrapers/BaseBeinleumiGroup/Config/BeinleumiLoginConfig.js');
const { TransactionStatuses: TX_STATUSES, TransactionTypes: TX_TYPES } =
  await import('../../Transactions.js');
const MOCK_PAGE_MOD = await import('../MockPage.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } = MOCK_PAGE_MOD;
/** Test subclass of the Beinleumi group base scraper. */
class TestBeinleumiScraper extends BEINLEUMI_GROUP_BASE_SCRAPER {
  public BASE_URL = 'https://test.fibi.co.il';
  public TRANSACTIONS_URL = 'https://test.fibi.co.il/transactions';
  /**
   * Construct test scraper.
   * @param options - scraper options
   */
  constructor(options: ScraperOptions) {
    const config = BEINLEUMI_CONFIG('https://www.fibi.co.il');
    super(options, config);
  }
}
const MOCK_CONTEXT = { newPage: jest.fn(), close: jest.fn().mockResolvedValue(undefined) };
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};
const CREDS = { username: 'testuser', password: 'testpass' };
/**
 * Create a mock page with account/balance locators.
 * @param overrides - mock overrides
 * @returns mock page
 */
function createPageWithAccountFeatures(
  overrides: Record<string, jest.Mock> = {},
): ReturnType<typeof CREATE_MOCK_PAGE> {
  const { createMockLocator: createLoc } = MOCK_PAGE_MOD;
  const accountLoc = createLoc({ innerText: jest.fn().mockResolvedValue('12/345678') });
  const balanceLoc = createLoc({ innerText: jest.fn().mockResolvedValue('\u20AA5,000.00') });
  const noDataText =
    '\u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0\u05D5 \u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D1\u05E0\u05D5\u05E9\u05D0 \u05D4\u05DE\u05D1\u05D5\u05E7\u05E9';
  const noDataLoc = createLoc({ innerText: jest.fn().mockResolvedValue(noDataText) });
  return CREATE_MOCK_PAGE({
    $$eval: jest.fn().mockResolvedValue([]),
    evaluate: jest.fn().mockResolvedValue([]),
    frames: jest.fn().mockReturnValue([]),
    locator: jest.fn().mockImplementation((sel: string) => {
      if (sel.includes('חשבון')) return accountLoc;
      if (sel.includes('יתרה')) return balanceLoc;
      if (sel.includes('NO_DATA')) return noDataLoc;
      return createLoc();
    }),
    ...overrides,
  });
}
const COMPLETED_COLUMN_TYPES = [
  { colClass: 'date first', index: 0 },
  { colClass: 'reference wrap_normal', index: 1 },
  { colClass: 'details', index: 2 },
  { colClass: 'debit', index: 3 },
  { colClass: 'credit', index: 4 },
];
const PENDING_COLUMN_TYPES = [
  { colClass: 'first date', index: 0 },
  { colClass: 'details wrap_normal', index: 1 },
  { colClass: 'details', index: 2 },
  { colClass: 'debit', index: 3 },
  { colClass: 'credit', index: 4 },
];
/**
 * Configure PAGE_EVAL_ALL mocks for transaction rows.
 * @param rows - transaction row data
 * @returns true when mocks are configured
 */
function mockTransactionTable(rows: { innerTds: string[] }[]): boolean {
  (PAGE_EVAL_ALL as jest.Mock)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(COMPLETED_COLUMN_TYPES)
    .mockResolvedValueOnce(rows);
  return true;
}
beforeEach(() => {
  jest.clearAllMocks();
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const defaultPage = createPageWithAccountFeatures();
  MOCK_CONTEXT.newPage.mockResolvedValue(defaultPage);
  const shellUrl = 'https://test.fibi.co.il/Resources/PortalNG/shell';
  (GET_CURRENT_URL as jest.Mock).mockResolvedValue(shellUrl);
  (ELEMENT_PRESENT as jest.Mock).mockResolvedValue(false);
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    expect(result.success).toBe(true);
    expect(BUILD_CONTEXT_OPTIONS).toHaveBeenCalled();
    const page = (await MOCK_CONTEXT.newPage.mock.results[0].value) as ReturnType<
      typeof CREATE_MOCK_PAGE
    >;
    expect(page.waitForTimeout).toHaveBeenCalledWith(1000);
  });

  it('returns InvalidPassword for marketing URL', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue(
      'https://test.fibi.co.il/FibiMenu/Marketing/Private/Home',
    );
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(SCRAPER_ERROR_TYPES.InvalidPassword);
  });
});

describe('fetchData', () => {
  it('fetches transactions for single account', async () => {
    mockTransactionTable([
      {
        innerTds: [
          '15/06/2024',
          '\u05E1\u05D5\u05E4\u05E8 \u05E9\u05D5\u05E4',
          '12345',
          '\u20AA150.00',
          '',
        ],
      },
    ]);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts?.[0]?.accountNumber).toBe('12_345678');
  });

  it('converts transaction amounts correctly', async () => {
    mockTransactionTable([
      { innerTds: ['15/06/2024', 'Payment', '100', '\u20AA200.00', '\u20AA50.00'] },
    ]);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    const txn = result.accounts?.[0]?.txns[0];
    expect(txn?.originalAmount).toBe(50 - 200);
    expect(txn?.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(txn?.type).toBe(TX_TYPES.Normal);
  });

  it('handles no transactions in date range', async () => {
    (ELEMENT_PRESENT as jest.Mock).mockImplementation(
      (_page: ReturnType<typeof CREATE_MOCK_PAGE>, selector: string): boolean =>
        selector === '.NO_DATA',
    );
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    expect(result.success).toBe(true);
    expect(result.accounts?.[0]?.txns).toHaveLength(0);
  });

  it('skips rows with empty date', async () => {
    mockTransactionTable([
      { innerTds: ['15/06/2024', 'Valid', '100', '\u20AA100.00', ''] },
      { innerTds: ['', 'Invalid', '', '', ''] },
    ]);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns).toHaveLength(1);
  });

  it('includes rawTransaction when option set', async () => {
    mockTransactionTable([{ innerTds: ['15/06/2024', 'Test', '100', '\u20AA100.00', ''] }]);
    const result = await new TestBeinleumiScraper(
      CREATE_OPTS({ includeRawTransaction: true }),
    ).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.rawTransaction).toBeDefined();
  });

  it('parses reference number as integer and undefined when empty', async () => {
    mockTransactionTable([
      { innerTds: ['15/06/2024', 'With Ref', '12345', '\u20AA100.00', ''] },
      { innerTds: ['16/06/2024', 'No Ref', '', '\u20AA50.00', ''] },
    ]);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns[0]?.identifier).toBe(12345);
    expect(result.accounts?.[0]?.txns[1]?.identifier).toBeUndefined();
  });

  it('extracts pending transactions with pending column layout', async () => {
    (PAGE_EVAL_ALL as jest.Mock)
      .mockResolvedValueOnce(PENDING_COLUMN_TYPES)
      .mockResolvedValueOnce([
        { innerTds: ['20/06/2024', 'Pending Purchase', '999', '\u20AA75.00', ''] },
      ])
      .mockResolvedValueOnce(COMPLETED_COLUMN_TYPES)
      .mockResolvedValueOnce([]);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    const firstTxn = result.accounts?.[0]?.txns[0];
    expect(result.accounts?.[0]?.txns).toHaveLength(1);
    expect(firstTxn?.status).toBe(TX_STATUSES.Pending);
    expect(firstTxn?.description).toBe('Pending Purchase');
    expect(firstTxn?.originalAmount).toBe(-75);
  });

  it('combines pending and completed transactions', async () => {
    (PAGE_EVAL_ALL as jest.Mock)
      .mockResolvedValueOnce(PENDING_COLUMN_TYPES)
      .mockResolvedValueOnce([{ innerTds: ['20/06/2024', 'Pending', '', '\u20AA50.00', ''] }])
      .mockResolvedValueOnce(COMPLETED_COLUMN_TYPES)
      .mockResolvedValueOnce([
        { innerTds: ['15/06/2024', 'Completed', '100', '\u20AA100.00', ''] },
      ]);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns).toHaveLength(2);
    const txns = result.accounts?.[0]?.txns ?? [];
    const pendingTxn = txns.find(txn => txn.status === TX_STATUSES.Pending);
    const completedTxn = txns.find(txn => txn.status === TX_STATUSES.Completed);
    expect(pendingTxn).toBeDefined();
    expect(completedTxn).toBeDefined();
  });

  it('paginates completed transactions when next page exists', async () => {
    (PAGE_EVAL_ALL as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(COMPLETED_COLUMN_TYPES)
      .mockResolvedValueOnce([{ innerTds: ['15/06/2024', 'Page1', '100', '\u20AA100.00', ''] }]);
    (ELEMENT_PRESENT as jest.Mock)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    (PAGE_EVAL_ALL as jest.Mock)
      .mockResolvedValueOnce(COMPLETED_COLUMN_TYPES)
      .mockResolvedValueOnce([{ innerTds: ['16/06/2024', 'Page2', '200', '\u20AA200.00', ''] }]);
    (ELEMENT_PRESENT as jest.Mock).mockResolvedValueOnce(false);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.txns).toHaveLength(2);
    expect(result.accounts?.[0]?.txns[0]?.description).toBe('Page1');
    expect(result.accounts?.[0]?.txns[1]?.description).toBe('Page2');
    const anyPage = expect.anything() as ReturnType<typeof CREATE_MOCK_PAGE>;
    const nextPageSel = expect.stringContaining('\u05D4\u05D1\u05D0') as string;
    expect(CLICK_BUTTON).toHaveBeenCalledWith(anyPage, nextPageSel);
  });

  it('retries iframe detection with waitForTimeout', async () => {
    mockTransactionTable([{ innerTds: ['15/06/2024', 'Test', '100', '\u20AA100.00', ''] }]);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    expect(result.success).toBe(true);
    const page = (await MOCK_CONTEXT.newPage.mock.results[0].value) as ReturnType<
      typeof CREATE_MOCK_PAGE
    >;
    expect(page.waitForTimeout).toHaveBeenCalledWith(2000);
  });

  it('extracts balance and handles commas in currency amounts', async () => {
    mockTransactionTable([
      { innerTds: ['15/06/2024', 'Big Purchase', '100', '\u20AA1,500.50', ''] },
    ]);
    const result = await new TestBeinleumiScraper(CREATE_OPTS()).scrape(CREDS);
    expect(result.accounts?.[0]?.balance).toBe(5000);
    expect(result.accounts?.[0]?.txns[0]?.originalAmount).toBe(-1500.5);
  });
});
