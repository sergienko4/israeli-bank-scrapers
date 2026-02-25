/* eslint-disable @typescript-eslint/unbound-method */
import puppeteer from 'puppeteer';
import { SHEKEL_CURRENCY } from '../constants';
import { elementPresentOnPage, pageEvalAll } from '../helpers/elements-interactions';
import { applyAntiDetection } from '../helpers/browser';
import { sleep } from '../helpers/waiting';
import { getCurrentUrl } from '../helpers/navigation';
import { createMockPage, createMockScraperOptions } from '../tests/mock-page';
import BeinleumiGroupBaseScraper from './base-beinleumi-group';
import { TransactionTypes } from '../transactions';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));
jest.mock('../helpers/elements-interactions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEvalAll: jest.fn().mockResolvedValue([]),
  pageEval: jest.fn().mockResolvedValue(null),
}));
jest.mock('../helpers/navigation', () => ({
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
  getCurrentUrl: jest.fn().mockResolvedValue('https://test.fibi.co.il/Resources/PortalNG/shell'),
}));
jest.mock('../helpers/browser', () => ({
  applyAntiDetection: jest.fn().mockResolvedValue(undefined),
  isBotDetectionScript: jest.fn(() => false),
  interceptionPriorities: { abort: 1000, continue: 10 },
}));
jest.mock('../helpers/transactions', () => ({
  getRawTransaction: jest.fn((data: any) => data),
}));
jest.mock('../helpers/waiting', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));
jest.mock('../helpers/debug', () => ({ getDebug: () => jest.fn() }));

class TestBeinleumiScraper extends BeinleumiGroupBaseScraper {
  BASE_URL = 'https://test.fibi.co.il';

  LOGIN_URL = 'https://test.fibi.co.il/login';

  TRANSACTIONS_URL = 'https://test.fibi.co.il/transactions';
}

const mockBrowser = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { username: 'testuser', password: 'testpass' };

function createPageWithAccountFeatures(overrides: Record<string, any> = {}) {
  return createMockPage({
    $eval: jest.fn().mockImplementation((selector: string) => {
      if (selector === 'div.fibi_account span.acc_num') return '12/345678';
      if (selector === '.main_balance') return '₪5,000.00';
      if (selector === '.NO_DATA') return 'לא נמצאו נתונים בנושא המבוקש';
      return undefined;
    }),
    $$eval: jest.fn().mockResolvedValue([]),
    evaluate: jest.fn().mockResolvedValue([]),
    frames: jest.fn().mockReturnValue([]),
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockBrowser.newPage.mockResolvedValue(createPageWithAccountFeatures());
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://test.fibi.co.il/Resources/PortalNG/shell');
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(true);
    expect(applyAntiDetection).toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('returns InvalidPassword for marketing URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://test.fibi.co.il/FibiMenu/Marketing/Private/Home');
    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    expect(result.success).toBe(false);
  });
});

describe('fetchData', () => {
  it('fetches transactions for single account (no dropdown)', async () => {
    // No accounts found in dropdown → uses current account
    (elementPresentOnPage as jest.Mock).mockResolvedValue(false);

    // Mock completed transactions table extraction
    (pageEvalAll as jest.Mock)
      .mockResolvedValueOnce([]) // column types for pending table
      .mockResolvedValueOnce([]) // pending table rows
      .mockResolvedValueOnce([
        // column types for completed table
        { colClass: 'date first', index: 0 },
        { colClass: 'reference wrap_normal', index: 1 },
        { colClass: 'details', index: 2 },
        { colClass: 'debit', index: 3 },
        { colClass: 'credit', index: 4 },
      ])
      .mockResolvedValueOnce([
        // completed table rows
        {
          innerTds: ['15/06/2024', 'סופר שופ', '12345', '₪150.00', ''],
        },
      ]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('12_345678');
  });

  it('converts transaction amounts correctly (credit - debit)', async () => {
    (elementPresentOnPage as jest.Mock).mockResolvedValue(false);

    (pageEvalAll as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { colClass: 'date first', index: 0 },
        { colClass: 'reference wrap_normal', index: 1 },
        { colClass: 'details', index: 2 },
        { colClass: 'debit', index: 3 },
        { colClass: 'credit', index: 4 },
      ])
      .mockResolvedValueOnce([{ innerTds: ['15/06/2024', 'Payment', '100', '₪200.00', '₪50.00'] }]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    const t = result.accounts![0].txns[0];
    expect(t.originalAmount).toBe(50 - 200);
    expect(t.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(t.type).toBe(TransactionTypes.Normal);
  });

  it('handles no transactions in date range', async () => {
    (elementPresentOnPage as jest.Mock).mockImplementation((_page: any, selector: string) => {
      return selector === '.NO_DATA';
    });

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts![0].txns).toHaveLength(0);
  });

  it('skips rows with empty date', async () => {
    (elementPresentOnPage as jest.Mock).mockResolvedValue(false);

    (pageEvalAll as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { colClass: 'date first', index: 0 },
        { colClass: 'reference wrap_normal', index: 1 },
        { colClass: 'details', index: 2 },
        { colClass: 'debit', index: 3 },
        { colClass: 'credit', index: 4 },
      ])
      .mockResolvedValueOnce([
        { innerTds: ['15/06/2024', 'Valid', '100', '₪100.00', ''] },
        { innerTds: ['', 'Invalid', '', '', ''] },
      ]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(1);
  });

  it('includes rawTransaction when option set', async () => {
    (elementPresentOnPage as jest.Mock).mockResolvedValue(false);

    (pageEvalAll as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { colClass: 'date first', index: 0 },
        { colClass: 'reference wrap_normal', index: 1 },
        { colClass: 'details', index: 2 },
        { colClass: 'debit', index: 3 },
        { colClass: 'credit', index: 4 },
      ])
      .mockResolvedValueOnce([{ innerTds: ['15/06/2024', 'Test', '100', '₪100.00', ''] }]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });

  it('parses reference number as integer', async () => {
    (elementPresentOnPage as jest.Mock).mockResolvedValue(false);

    (pageEvalAll as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { colClass: 'date first', index: 0 },
        { colClass: 'reference wrap_normal', index: 1 },
        { colClass: 'details', index: 2 },
        { colClass: 'debit', index: 3 },
        { colClass: 'credit', index: 4 },
      ])
      .mockResolvedValueOnce([{ innerTds: ['15/06/2024', 'Test', '12345', '₪100.00', ''] }]);

    const scraper = new TestBeinleumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].identifier).toBe(12345);
  });
});
