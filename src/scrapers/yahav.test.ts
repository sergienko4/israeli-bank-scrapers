import puppeteer from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import { elementPresentOnPage, pageEvalAll } from '../helpers/elements-interactions';
import { applyAntiDetection } from '../helpers/browser';
import { getCurrentUrl } from '../helpers/navigation';
import { createMockPage, createMockScraperOptions } from '../tests/mock-page';
import YahavScraper from './yahav';
import { ScraperErrorTypes } from './errors';
import { TransactionStatuses, TransactionTypes } from '../transactions';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));
jest.mock('../helpers/elements-interactions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  waitUntilElementDisappear: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEvalAll: jest.fn().mockResolvedValue([]),
}));
jest.mock('../helpers/navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/main/home'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../helpers/browser', () => ({
  applyAntiDetection: jest.fn().mockResolvedValue(undefined),
  isBotDetectionScript: jest.fn(() => false),
  interceptionPriorities: { abort: 1000, continue: 10 },
}));
jest.mock('../helpers/transactions', () => ({
  getRawTransaction: jest.fn((data: any) => data),
}));
jest.mock('../helpers/debug', () => ({ getDebug: () => jest.fn() }));

const mockBrowser = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { username: 'testuser', password: 'testpass', nationalID: '123456789' };

function createYahavPage() {
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
  (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockBrowser.newPage.mockResolvedValue(createYahavPage());
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
    expect(applyAntiDetection).toHaveBeenCalled();
  });

  it('returns InvalidPassword when dialog appears', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://login.yahav.co.il/login/');
    (elementPresentOnPage as jest.Mock).mockImplementation((_p: any, selector: string) => {
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
    (pageEvalAll as jest.Mock).mockResolvedValueOnce([{ id: '', innerDivs: ['0', '15/06/2025', '', 'Test', '', ''] }]);

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
