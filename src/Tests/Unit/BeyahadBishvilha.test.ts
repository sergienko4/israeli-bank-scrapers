import { jest } from '@jest/globals';
jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  pageEval: jest.fn().mockResolvedValue(null),
  pageEvalAll: jest.fn().mockResolvedValue([]),

  elementPresentOnPage: jest.fn().mockResolvedValue(false),

  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.hist.org.il/'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),

  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),

  waitForRedirect: jest.fn().mockResolvedValue(undefined),

  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  filterOldTransactions: jest.fn(<T>(txns: T[]) => txns),
  getRawTransaction: jest.fn((data: Record<string, number>): Record<string, number> => data),
}));

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mock Debug module.
   * @returns mocked debug exports
   */
  () => ({
    getDebug:
      /**
       * Debug factory.
       * @returns mock logger
       */
      (): Record<string, jest.Mock> => ({
        trace: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
  }),
);

const { buildContextOptions: BUILD_CONTEXT_OPTIONS } = await import('../../Common/Browser.js');
const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const { pageEval: PAGE_EVAL, pageEvalAll: PAGE_EVAL_ALL } =
  await import('../../Common/ElementsInteractions.js');
const { filterOldTransactions: FILTER_OLD } = await import('../../Common/Transactions.js');
const { default: BEYAHAD_SCRAPER } =
  await import('../../Scrapers/BeyahadBishvilha/BeyahadBishvilhaScraper.js');
const { TransactionStatuses: TX_STATUSES, TransactionTypes: TX_TYPES } =
  await import('../../Transactions.js');
const { createMockPage: CREATE_MOCK_PAGE, createMockScraperOptions: CREATE_OPTS } =
  await import('../MockPage.js');

const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { id: '123456789', password: 'pass123' };

/**
 * Creates a mock page and attaches it to the mock context.
 * @returns the mock page instance
 */
function setupPage(): ReturnType<typeof CREATE_MOCK_PAGE> {
  const page = CREATE_MOCK_PAGE({
    $: jest.fn().mockResolvedValue({ click: jest.fn().mockResolvedValue(undefined) }),
  });
  MOCK_CONTEXT.newPage.mockResolvedValue(page);
  return page;
}

beforeEach(() => {
  jest.clearAllMocks();
  (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  setupPage();
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    (PAGE_EVAL as jest.Mock)
      .mockResolvedValueOnce('1234567890') // accountNumber
      .mockResolvedValueOnce('₪5,000.00'); // balance
    (PAGE_EVAL_ALL as jest.Mock).mockResolvedValueOnce([]);

    const scraper = new BEYAHAD_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(BUILD_CONTEXT_OPTIONS).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('extracts transactions from page', async () => {
    (PAGE_EVAL as jest.Mock)
      .mockResolvedValueOnce('מספר כרטיס 12345') // accountNumber
      .mockResolvedValueOnce('₪5,000.00'); // balance

    (PAGE_EVAL_ALL as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN001',
        description: 'סופר שופ',
        type: 'רכישה',
        chargedAmount: '₪150.00',
      },
    ]);

    const scraper = new BEYAHAD_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts?.[0]?.txns).toHaveLength(1);
    expect(result.accounts?.[0]?.txns[0]).toMatchObject({
      description: 'סופר שופ',
      originalAmount: 150,
      originalCurrency: 'ILS',
      status: TX_STATUSES.Completed,
      type: TX_TYPES.Normal,
      identifier: 'TXN001',
    });
  });

  it('parses dollar amounts', async () => {
    (PAGE_EVAL as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('$1,000.00');

    (PAGE_EVAL_ALL as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN002',
        description: 'Amazon',
        type: 'רכישה',
        chargedAmount: '$50.00',
      },
    ]);

    const scraper = new BEYAHAD_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns[0]?.originalCurrency).toBe('USD');
    expect(result.accounts?.[0]?.txns[0]?.originalAmount).toBe(50);
  });

  it('parses euro amounts', async () => {
    (PAGE_EVAL as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('€500.00');

    (PAGE_EVAL_ALL as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN003',
        description: 'Europe Shop',
        type: 'רכישה',
        chargedAmount: '€75.50',
      },
    ]);

    const scraper = new BEYAHAD_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns[0]?.originalCurrency).toBe('EUR');
    expect(result.accounts?.[0]?.txns[0]?.originalAmount).toBe(75.5);
  });

  it('parses space-separated currency format', async () => {
    (PAGE_EVAL as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('₪0');

    (PAGE_EVAL_ALL as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN004',
        description: 'GBP Payment',
        type: 'רכישה',
        chargedAmount: 'GBP 200.00',
      },
    ]);

    const scraper = new BEYAHAD_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns[0]?.originalCurrency).toBe('GBP');
    expect(result.accounts?.[0]?.txns[0]?.originalAmount).toBe(200);
  });

  it('filters null transactions from DOM extraction', async () => {
    (PAGE_EVAL as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('₪0');

    (PAGE_EVAL_ALL as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN001',
        description: 'Valid',
        type: 'רכישה',
        chargedAmount: '₪100.00',
      },
      false,
    ]);

    const scraper = new BEYAHAD_SCRAPER(CREATE_OPTS());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns).toHaveLength(1);
  });

  it('calls filterOldTransactions when enabled', async () => {
    (PAGE_EVAL as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('₪0');

    (PAGE_EVAL_ALL as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN001',
        description: 'Test',
        type: 'רכישה',
        chargedAmount: '₪100.00',
      },
    ]);

    const scraper = new BEYAHAD_SCRAPER(CREATE_OPTS());
    await scraper.scrape(CREDS);

    expect(FILTER_OLD).toHaveBeenCalled();
  });

  it('includes rawTransaction when option set', async () => {
    (PAGE_EVAL as jest.Mock).mockResolvedValueOnce('12345').mockResolvedValueOnce('₪0');

    (PAGE_EVAL_ALL as jest.Mock).mockResolvedValueOnce([
      {
        date: '15/06/24',
        identifier: 'TXN001',
        description: 'Test',
        type: 'רכישה',
        chargedAmount: '₪100.00',
      },
    ]);

    const opts = CREATE_OPTS({ includeRawTransaction: true });
    const scraper = new BEYAHAD_SCRAPER(opts);
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns[0]?.rawTransaction).toBeDefined();
  });
});
