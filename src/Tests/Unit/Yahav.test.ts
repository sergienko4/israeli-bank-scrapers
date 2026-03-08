import { jest } from '@jest/globals';
jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  waitUntilElementDisappear: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEvalAll: jest.fn().mockResolvedValue([]),

  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest
    .fn()
    .mockResolvedValue('https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/main/home'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),

  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),

  waitForRedirect: jest.fn().mockResolvedValue(undefined),

  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  getRawTransaction: jest.fn((data: unknown) => data),
}));

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { buildContextOptions } = await import('../../Common/Browser.js');
const { launchCamoufox } = await import('../../Common/CamoufoxLauncher.js');
const { elementPresentOnPage, pageEvalAll } = await import('../../Common/ElementsInteractions.js');
const { getCurrentUrl } = await import('../../Common/Navigation.js');
const { SHEKEL_CURRENCY } = await import('../../Constants.js');
const { ScraperErrorTypes } = await import('../../Scrapers/Base/Errors.js');
const { default: YahavScraper } = await import('../../Scrapers/Yahav/YahavScraper.js');
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

const CREDS = { username: 'testuser', password: 'testpass', nationalID: '123456789' };

function createYahavPage(): ReturnType<typeof createMockPage> {
  return createMockPage({
    $eval: jest.fn().mockImplementation((selector: string) => {
      if (selector.includes('portfolio-value')) return 'ACC-12345';
      if (selector.includes('.pmu-years')) return '2025';
      if (selector.includes('.pmu-days')) return '1';
      return '';
    }),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (launchCamoufox as jest.Mock).mockResolvedValue(mockBrowser);
  mockContext.newPage.mockResolvedValue(createYahavPage());
  (getCurrentUrl as jest.Mock).mockResolvedValue(
    'https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/main/home',
  );
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

describe('login', () => {
  it('succeeds with 3-field credentials', async () => {
    (pageEvalAll as jest.Mock).mockResolvedValue([]);

    const scraper = new YahavScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });

  it('returns InvalidPassword when dialog appears', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://login.yahav.co.il/login/');
    (elementPresentOnPage as jest.Mock).mockImplementation((_p: unknown, selector: string) => {
      return selector === '.ui-dialog-buttons';
    });

    const scraper = new YahavScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions', async () => {
    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      { id: '', innerDivs: ['0', '15/06/2025', '12345', 'סופר שופ', '150.00', ''] },
    ]);

    const scraper = new YahavScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('ACC-12345');

    const t = result.accounts![0].txns[0];
    expect(t.originalAmount).toBe(-150);
    expect(t.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(t.type).toBe(TransactionTypes.Normal);
    expect(t.status).toBe(TransactionStatuses.Completed);
    expect(t.description).toBe('סופר שופ');
  });

  it('cleans reference field with regex', async () => {
    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      { id: '', innerDivs: ['0', '15/06/2025', 'REF-123-ABC', 'Test', '50.00', ''] },
    ]);

    const scraper = new YahavScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].identifier).toBe(123);
  });

  it('calculates credit minus debit', async () => {
    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      { id: '', innerDivs: ['0', '15/06/2025', '', 'Credit', '', '300.00'] },
    ]);

    const scraper = new YahavScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].originalAmount).toBe(300);
  });

  it('handles NaN amounts', async () => {
    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      { id: '', innerDivs: ['0', '15/06/2025', '', 'Test', '', ''] },
    ]);

    const scraper = new YahavScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].originalAmount).toBe(0);
  });

  it('includes rawTransaction when option set', async () => {
    (pageEvalAll as jest.Mock).mockResolvedValueOnce([
      { id: '', innerDivs: ['0', '15/06/2025', '100', 'Test', '50.00', ''] },
    ]);

    const scraper = new YahavScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });
});
