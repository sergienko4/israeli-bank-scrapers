import { buildContextOptions } from '../../Common/Browser';
import { launchCamoufox } from '../../Common/CamoufoxLauncher';
import { elementPresentOnPage, pageEvalAll } from '../../Common/ElementsInteractions';
import { getCurrentUrl } from '../../Common/Navigation';
import { SHEKEL_CURRENCY } from '../../Constants';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import YahavScraper from '../../Scrapers/Yahav/YahavScraper';
import { TransactionStatuses, TransactionTypes } from '../../Transactions';
import { createMockPage, createMockScraperOptions } from '../MockPage';

jest.mock('../../Common/CamoufoxLauncher', () => ({ launchCamoufox: jest.fn() }));
jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  waitUntilElementDisappear: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEvalAll: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../Common/Navigation', () => ({
  getCurrentUrl: jest
    .fn()
    .mockResolvedValue('https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/main/home'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../../Common/Transactions', () => ({
  getRawTransaction: jest.fn((data: unknown) => data),
}));
jest.mock('../../Common/Debug', () => ({
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

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
