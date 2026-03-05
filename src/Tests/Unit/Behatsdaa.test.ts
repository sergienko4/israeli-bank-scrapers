import { chromium } from 'playwright-extra';

import { buildContextOptions } from '../../Common/Browser';
import { fetchPostWithinPage } from '../../Common/Fetch';
import { getCurrentUrl } from '../../Common/Navigation';
import BehatsdaaScraper from '../../Scrapers/Behatsdaa/BehatsdaaScraper';
import { TransactionStatuses, TransactionTypes } from '../../Transactions';
import { createMockPage, createMockScraperOptions } from '../MockPage';

jest.mock('playwright-extra', () => ({ chromium: { launch: jest.fn(), use: jest.fn() } }));
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn());
jest.mock('../../Common/Fetch', () => ({ fetchPostWithinPage: jest.fn() }));
jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));
jest.mock('../../Common/Navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.behatsdaa.org.il/'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../Common/Waiting', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));
jest.mock('../../Common/OtpHandler', () => ({ handleOtpStep: jest.fn().mockResolvedValue(null) }));
jest.mock('../../Common/Transactions', () => ({
  getRawTransaction: jest.fn((data: unknown) => data),
}));
jest.mock('../../Common/Debug', () => ({
  getDebug: (): Record<string, jest.Mock> => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const MOCK_CONTEXT = {
  newPage: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};
const MOCK_BROWSER = {
  newContext: jest.fn().mockResolvedValue(MOCK_CONTEXT),
  close: jest.fn().mockResolvedValue(undefined),
};

const CREDS = { id: '123456789', password: 'pass123' };

interface BehatsdaaVariant {
  name: string;
  variantName: string;
  customerPrice: number;
  orderDate: string;
  tTransactionID: string;
}

function variant(overrides: Partial<BehatsdaaVariant> = {}): BehatsdaaVariant {
  return {
    name: 'Test Product',
    variantName: 'Size L',
    customerPrice: 100,
    orderDate: '2025-06-15T10:00:00',
    tTransactionID: 'TXN-001',
    ...overrides,
  };
}

function createBehatsdaaPage(
  token: string | null = 'mock-token',
): ReturnType<typeof createMockPage> {
  return createMockPage({
    evaluate: jest.fn().mockResolvedValue(token),
    $: jest.fn().mockResolvedValue({ click: jest.fn().mockResolvedValue(undefined) }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (chromium.launch as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  MOCK_CONTEXT.newPage.mockResolvedValue(createBehatsdaaPage());
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
    expect(buildContextOptions).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('returns error when token not in localStorage', async () => {
    MOCK_CONTEXT.newPage.mockResolvedValue(createBehatsdaaPage(null));

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
    expect((result.accounts ?? [])[0].accountNumber).toBe('M001');

    const t = (result.accounts ?? [])[0].txns[0];
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

    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });

  it('sends Bearer token in authorization header', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      data: { memberId: 'M001', variants: [] },
    });

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    await scraper.scrape(CREDS);

    const extraHeadersMatcher = { authorization: 'Bearer mock-token' };
    expect(fetchPostWithinPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String) as string,
      expect.objectContaining({
        extraHeaders: expect.objectContaining(extraHeadersMatcher) as Record<string, string>,
      }),
    );
  });
});
