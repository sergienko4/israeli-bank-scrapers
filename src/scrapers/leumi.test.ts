import { chromium } from 'playwright';
import { SHEKEL_CURRENCY } from '../constants';
import { pageEval } from '../helpers/elements-interactions';
import { buildContextOptions } from '../helpers/browser';
import { getCurrentUrl } from '../helpers/navigation';
import { createMockPage, createMockScraperOptions } from '../tests/mock-page';
import LeumiScraper from './leumi';
import { ScraperErrorTypes } from './errors';
import { TransactionStatuses, TransactionTypes } from '../transactions';

jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));
jest.mock('../helpers/elements-interactions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  pageEval: jest.fn().mockResolvedValue('https://hb2.bankleumi.co.il/login'),
  pageEvalAll: jest.fn().mockResolvedValue(''),
}));
jest.mock('../helpers/navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://hb2.bankleumi.co.il/ebanking/SO/SPA.aspx'),
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

function createLeumiResponse(overrides: Record<string, unknown> = {}): { json: jest.Mock } {
  return {
    json: jest.fn().mockResolvedValue({
      jsonResp: JSON.stringify({
        TodayTransactionsItems: [],
        HistoryTransactionsItems: [],
        ...overrides,
      }),
    }),
  };
}

function createLeumiPage(accountIds: string[] = ['123/456']): ReturnType<typeof createMockPage> {
  const mockResponse = createLeumiResponse({
    BalanceDisplay: '5000.00',
    HistoryTransactionsItems: [
      {
        DateUTC: '2025-06-15T00:00:00',
        Amount: -100,
        Description: 'Test Transaction',
        ReferenceNumberLong: 12345,
        AdditionalData: 'memo text',
      },
    ],
  });

  return createMockPage({
    evaluate: jest.fn().mockResolvedValue(accountIds),
    goto: jest.fn().mockResolvedValue({ ok: () => true, status: () => 200 }),
    waitForResponse: jest.fn().mockResolvedValue(mockResponse),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    $$: jest.fn().mockResolvedValue([{ click: jest.fn() }]),
    focus: jest.fn().mockResolvedValue(undefined),
    $: jest.fn().mockResolvedValue(null),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockContext.newPage.mockResolvedValue(createLeumiPage());
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://hb2.bankleumi.co.il/ebanking/SO/SPA.aspx');
  (pageEval as jest.Mock).mockResolvedValue('https://hb2.bankleumi.co.il/login');
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    const scraper = new LeumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);
    if (!result.success)
      console.log(
        'LEUMI FAILURE:',
        JSON.stringify({ errorType: result.errorType, errorMessage: result.errorMessage?.substring(0, 200) }),
      );

    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });

  it('returns ChangePassword for authenticate URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://hb2.bankleumi.co.il/authenticate');

    const scraper = new LeumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions', async () => {
    const scraper = new LeumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('123_456');

    const t = result.accounts![0].txns[0];
    expect(t.originalAmount).toBe(-100);
    expect(t.originalCurrency).toBe(SHEKEL_CURRENCY);
    expect(t.type).toBe(TransactionTypes.Normal);
    expect(t.status).toBe(TransactionStatuses.Completed);
    expect(t.description).toBe('Test Transaction');
    expect(t.memo).toBe('memo text');
    expect(t.identifier).toBe(12345);
  });

  it('separates pending and completed transactions', async () => {
    const mockResponse = {
      json: jest.fn().mockResolvedValue({
        jsonResp: JSON.stringify({
          TodayTransactionsItems: [
            { DateUTC: '2025-06-15T00:00:00', Amount: -50, Description: 'Pending', ReferenceNumberLong: 1 },
          ],
          HistoryTransactionsItems: [
            { DateUTC: '2025-06-14T00:00:00', Amount: -100, Description: 'Completed', ReferenceNumberLong: 2 },
          ],
        }),
      }),
    };

    const page = createLeumiPage();
    page.waitForResponse.mockResolvedValue(mockResponse);
    mockContext.newPage.mockResolvedValue(page);

    const scraper = new LeumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    const pending = result.accounts![0].txns.find(t => t.status === TransactionStatuses.Pending);
    const completed = result.accounts![0].txns.find(t => t.status === TransactionStatuses.Completed);
    expect(pending).toBeDefined();
    expect(completed).toBeDefined();
    expect(pending!.description).toBe('Pending');
    expect(completed!.description).toBe('Completed');
  });

  it('handles empty transaction arrays', async () => {
    const mockResponse = {
      json: jest.fn().mockResolvedValue({
        jsonResp: JSON.stringify({
          TodayTransactionsItems: null,
          HistoryTransactionsItems: [],
        }),
      }),
    };

    const page = createLeumiPage();
    page.waitForResponse.mockResolvedValue(mockResponse);
    mockContext.newPage.mockResolvedValue(page);

    const scraper = new LeumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns).toHaveLength(0);
  });

  it('throws on empty account IDs', async () => {
    const page = createLeumiPage();
    page.evaluate.mockResolvedValue([]);
    mockContext.newPage.mockResolvedValue(page);

    const scraper = new LeumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Failed to extract');
  });

  it('extracts balance from response', async () => {
    const scraper = new LeumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].balance).toBe(5000);
  });

  it('removes special characters from account ID', async () => {
    const page = createLeumiPage(['123&/456']);
    mockContext.newPage.mockResolvedValue(page);

    const scraper = new LeumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].accountNumber).toBe('123_456');
  });

  it('includes rawTransaction when option set', async () => {
    const scraper = new LeumiScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });

  it('handles multiple accounts with clicking', async () => {
    const page = createLeumiPage(['111/222', '333/444']);
    page.waitForResponse.mockResolvedValue(
      createLeumiResponse({
        HistoryTransactionsItems: [
          { DateUTC: '2025-06-15T00:00:00', Amount: -100, Description: 'Txn', ReferenceNumberLong: 1 },
        ],
        BalanceDisplay: '3000.00',
      }),
    );
    page.waitForSelector.mockResolvedValue(undefined);
    mockContext.newPage.mockResolvedValue(page);

    const scraper = new LeumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts![0].accountNumber).toBe('111_222');
    expect(result.accounts![1].accountNumber).toBe('333_444');
  });

  it('handles undefined balance gracefully', async () => {
    const page = createLeumiPage();
    page.waitForResponse.mockResolvedValue(createLeumiResponse());
    mockContext.newPage.mockResolvedValue(page);

    const scraper = new LeumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].balance).toBeUndefined();
  });

  it('uses empty string for missing description and memo', async () => {
    const page = createLeumiPage();
    page.waitForResponse.mockResolvedValue(
      createLeumiResponse({
        HistoryTransactionsItems: [{ DateUTC: '2025-06-15T00:00:00', Amount: -50 }],
        BalanceDisplay: '1000.00',
      }),
    );
    mockContext.newPage.mockResolvedValue(page);

    const scraper = new LeumiScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].description).toBe('');
    expect(result.accounts![0].txns[0].memo).toBe('');
  });
});
