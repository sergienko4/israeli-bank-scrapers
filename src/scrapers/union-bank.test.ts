import { chromium } from 'playwright';
import { SHEKEL_CURRENCY } from '../constants';
import { elementPresentOnPage, pageEvalAll, dropdownElements } from '../helpers/elements-interactions';
import { buildContextOptions } from '../helpers/browser';
import { getCurrentUrl } from '../helpers/navigation';
import { createMockPage, createMockScraperOptions } from '../tests/mock-page';
import UnionBankScraper from './union-bank';
import { ScraperErrorTypes } from './errors';
import { TransactionStatuses, TransactionTypes } from '../transactions';

jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));
jest.mock('../helpers/elements-interactions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEvalAll: jest.fn().mockResolvedValue([]),
  dropdownSelect: jest.fn().mockResolvedValue(undefined),
  dropdownElements: jest.fn().mockResolvedValue([]),
}));
jest.mock('../helpers/navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://hb.unionbank.co.il/eBanking/Accounts/ExtendedActivity.aspx'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../helpers/browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../helpers/transactions', () => ({
  getRawTransaction: jest.fn((data: unknown) => data),
}));
jest.mock('../helpers/debug', () => ({ getDebug: () => jest.fn() }));

const mockContext = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newContext: jest.fn().mockResolvedValue(mockContext),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { username: 'testuser', password: 'testpass' };

function createUnionPage(): ReturnType<typeof createMockPage> {
  return createMockPage({
    $eval: jest.fn().mockImplementation((selector: string) => {
      if (selector.includes('option[selected')) return '123/456789';
      return undefined;
    }),
  });
}

function mockTransactionTable(headers: Array<{ text: string; index: number }>, rows: Array<{ id: string; innerTds: string[] }>): void {
  (pageEvalAll as jest.Mock).mockResolvedValueOnce(headers).mockResolvedValueOnce(rows);
}

const STANDARD_HEADERS = [
  { text: 'תאריך', index: 0 },
  { text: 'תיאור', index: 1 },
  { text: 'אסמכתא', index: 2 },
  { text: 'חובה', index: 3 },
  { text: 'זכות', index: 4 },
];

beforeEach(() => {
  jest.clearAllMocks();
  (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockContext.newPage.mockResolvedValue(createUnionPage());
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://hb.unionbank.co.il/eBanking/Accounts/ExtendedActivity.aspx');
  (elementPresentOnPage as jest.Mock).mockResolvedValue(false);
  (dropdownElements as jest.Mock).mockResolvedValue([{ name: 'Account 1', value: '123' }]);
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    // Mock pending table (empty) + completed table (empty)
    mockTransactionTable([], []);
    mockTransactionTable([], []);

    const scraper = new UnionBankScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });

  it('returns InvalidPassword for login page URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue(
      'https://hb.unionbank.co.il/InternalSite/CustomUpdate/leumi/LoginPage.ASP',
    );
    const scraper = new UnionBankScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions', async () => {
    // Pending table (empty)
    mockTransactionTable([], []);
    // Completed table with data
    mockTransactionTable(STANDARD_HEADERS, [{ id: '', innerTds: ['15/06/25', 'סופר שופ', '12345', '150.00', ''] }]);

    const scraper = new UnionBankScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('123_456789');

    const t = result.accounts![0].txns[0];
    expect(t.originalAmount).toBe(-150);
    expect(t.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(t.type).toBe(TransactionTypes.Normal);
    expect(t.status).toBe(TransactionStatuses.Completed);
    expect(t.description).toBe('סופר שופ');
    expect(t.identifier).toBe(12345);
  });

  it('calculates amount as credit minus debit', async () => {
    mockTransactionTable([], []);
    mockTransactionTable(STANDARD_HEADERS, [{ id: '', innerTds: ['15/06/25', 'Refund', '', '', '200.00'] }]);

    const scraper = new UnionBankScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].originalAmount).toBe(200);
  });

  it('handles NaN amounts gracefully', async () => {
    mockTransactionTable([], []);
    mockTransactionTable(STANDARD_HEADERS, [{ id: '', innerTds: ['15/06/25', 'Test', '', '', ''] }]);

    const scraper = new UnionBankScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].originalAmount).toBe(0);
  });

  it('handles expanded description rows', async () => {
    mockTransactionTable([], []);
    mockTransactionTable(STANDARD_HEADERS, [
      { id: '', innerTds: ['15/06/25', 'Payment', '100', '50.00', ''] },
      { id: 'rowAdded', innerTds: ['Extra details about payment'] },
    ]);

    const scraper = new UnionBankScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(1);
    expect(result.accounts![0].txns[0].description).toBe('Payment Extra details about payment');
  });

  it('handles no transactions in date range', async () => {
    (elementPresentOnPage as jest.Mock).mockImplementation((_p: unknown, selector: string) => {
      return selector === '.errInfo';
    });
    mockContext.newPage.mockResolvedValue(
      createMockPage({
        $eval: jest.fn().mockImplementation((selector: string) => {
          if (selector.includes('option[selected')) return '123/456789';
          if (selector === '.errInfo') return 'לא קיימות תנועות מתאימות על פי הסינון שהוגדר';
          return '';
        }),
      }),
    );

    const scraper = new UnionBankScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts![0].txns).toHaveLength(0);
  });

  it('handles pending transactions', async () => {
    mockTransactionTable(STANDARD_HEADERS, [{ id: '', innerTds: ['15/06/25', 'Pending item', '', '30.00', ''] }]);
    mockTransactionTable([], []);

    const scraper = new UnionBankScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    const pending = result.accounts![0].txns.find(t => t.status === TransactionStatuses.Pending);
    expect(pending).toBeDefined();
    expect(pending!.originalAmount).toBe(-30);
  });

  it('includes rawTransaction when option set', async () => {
    mockTransactionTable([], []);
    mockTransactionTable(STANDARD_HEADERS, [{ id: '', innerTds: ['15/06/25', 'Test', '100', '50.00', ''] }]);

    const scraper = new UnionBankScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });

  it('skips all-accounts option in dropdown', async () => {
    (dropdownElements as jest.Mock).mockResolvedValue([
      { name: 'All', value: '-1' },
      { name: 'Account 1', value: '123' },
    ]);
    mockTransactionTable([], []);
    mockTransactionTable([], []);

    const scraper = new UnionBankScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts).toHaveLength(1);
  });
});
