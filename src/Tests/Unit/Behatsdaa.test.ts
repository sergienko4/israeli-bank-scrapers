import { jest } from '@jest/globals';
jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule('../../Common/Fetch.js', () => ({ fetchPostWithinPage: jest.fn() }));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://www.behatsdaa.org.il/'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),

  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),

  waitForRedirect: jest.fn().mockResolvedValue(undefined),

  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),

  elementPresentOnPage: jest.fn().mockResolvedValue(false),

  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.unstable_mockModule('../../Common/OtpHandler.js', () => ({
  handleOtpStep: jest.fn().mockResolvedValue(null),

  handleOtpCode: jest.fn().mockResolvedValue(undefined),

  handleOtpConfirm: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  getRawTransaction: jest.fn((data: unknown) => data),
}));

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const { buildContextOptions } = await import('../../Common/Browser.js');
const { launchCamoufox } = await import('../../Common/CamoufoxLauncher.js');
const { fetchPostWithinPage } = await import('../../Common/Fetch.js');
const { getCurrentUrl } = await import('../../Common/Navigation.js');
const { default: BehatsdaaScraper } = await import('../../Scrapers/Behatsdaa/BehatsdaaScraper.js');
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
  (launchCamoufox as jest.Mock).mockResolvedValue(mockBrowser);
  mockContext.newPage.mockResolvedValue(createBehatsdaaPage());
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
    mockContext.newPage.mockResolvedValue(createBehatsdaaPage(null));

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
