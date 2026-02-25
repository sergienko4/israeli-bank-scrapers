import puppeteer from 'puppeteer';
import { fetchPostWithinPage } from '../helpers/fetch';
import { applyAntiDetection } from '../helpers/browser';
import { getCurrentUrl } from '../helpers/navigation';
import { createMockPage, createMockScraperOptions } from '../tests/mock-page';
import BehatsdaaScraper from './behatsdaa';
import { TransactionStatuses, TransactionTypes } from '../transactions';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));
jest.mock('../helpers/fetch', () => ({ fetchPostWithinPage: jest.fn() }));
jest.mock('../helpers/browser', () => ({
  applyAntiDetection: jest.fn().mockResolvedValue(undefined),
  isBotDetectionScript: jest.fn(() => false),
  interceptionPriorities: { abort: 1000, continue: 10 },
}));
jest.mock('../helpers/navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.behatsdaa.org.il/'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../helpers/elements-interactions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../helpers/waiting', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));
jest.mock('../helpers/transactions', () => ({
  getRawTransaction: jest.fn((data: any) => data),
}));
jest.mock('../helpers/debug', () => ({ getDebug: () => jest.fn() }));

const mockBrowser = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { id: '123456789', password: 'pass123' };

function variant(overrides: any = {}): any {
  return {
    name: 'Test Product',
    variantName: 'Size L',
    customerPrice: 100,
    orderDate: '2025-06-15T10:00:00',
    tTransactionID: 'TXN-001',
    ...overrides,
  };
}

function createBehatsdaaPage(token: string | null = 'mock-token') {
  return createMockPage({
    evaluate: jest.fn().mockResolvedValue(token),
    $: jest.fn().mockResolvedValue({ click: jest.fn().mockResolvedValue(undefined) }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (puppeteer.launch as jest.Mock).mockResolvedValue(mockBrowser);
  mockBrowser.newPage.mockResolvedValue(createBehatsdaaPage());
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://www.behatsdaa.org.il/');
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      data: { memberId: 'M001', variants: [] },
    });

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(applyAntiDetection).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('returns error when token not in localStorage', async () => {
    mockBrowser.newPage.mockResolvedValue(createBehatsdaaPage(null));

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('TokenNotFound');
  });

  it('returns error when API response has errorDescription', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      errorDescription: 'Service unavailable',
    });

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Service unavailable');
  });

  it('returns error when API response has no data', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({});

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('NoData');
  });

  it('converts variants to transactions', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      data: {
        memberId: 'M001',
        variants: [variant({ customerPrice: 250, name: 'Gift Card', variantName: 'Premium' })],
      },
    });

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts![0].accountNumber).toBe('M001');

    const t = result.accounts![0].txns[0];
    expect(t.originalAmount).toBe(-250);
    expect(t.originalCurrency).toBe('ILS');
    expect(t.status).toBe(TransactionStatuses.Completed);
    expect(t.type).toBe(TransactionTypes.Normal);
    expect(t.description).toBe('Gift Card');
    expect(t.memo).toBe('Premium');
  });

  it('includes rawTransaction when option set', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      data: { memberId: 'M001', variants: [variant()] },
    });

    const scraper = new BehatsdaaScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect(result.accounts![0].txns[0].rawTransaction).toBeDefined();
  });

  it('sends Bearer token in authorization header', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      data: { memberId: 'M001', variants: [] },
    });

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    await scraper.scrape(CREDS);

    expect(fetchPostWithinPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ authorization: 'Bearer mock-token' }),
    );
  });
});
