import { buildContextOptions } from '../../Common/Browser';
import { launchWithEngine } from '../../Common/BrowserEngine';
import { fetchPostWithinPage } from '../../Common/Fetch';
import { getCurrentUrl } from '../../Common/Navigation';
import BehatsdaaScraper from '../../Scrapers/Behatsdaa/BehatsdaaScraper';
import { TransactionStatuses, TransactionTypes } from '../../Transactions';
import { createMockPage, createMockScraperOptions } from '../MockPage';

jest.mock('../../Common/BrowserEngine', () => ({
  launchWithEngine: jest.fn(),
  getGlobalEngineChain: jest.fn().mockReturnValue(['playwright-stealth']),
  BrowserEngineType: {
    Camoufox: 'camoufox',
    PlaywrightStealth: 'playwright-stealth',
    Rebrowser: 'rebrowser',
    Patchright: 'patchright',
  },
}));
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
jest.mock('../../Common/OtpHandler', () => ({
  handleOtpStep: jest.fn().mockResolvedValue({ isFound: false }),
}));
jest.mock('../../Common/Transactions', () => ({
  getRawTransaction: jest.fn((data: unknown) => data),
}));
jest.mock('../../Common/Debug', () => ({
  /**
   * Returns a set of jest mock functions as a debug logger stub.
   *
   * @returns a mock debug logger with debug, info, warn, and error functions
   */
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

interface IBehatsdaaVariant {
  name: string;
  variantName: string;
  customerPrice: number;
  orderDate: string;
  tTransactionID: string;
}

/**
 * Creates a mock IBehatsdaaVariant for unit tests.
 *
 * @param overrides - optional field overrides for the mock variant
 * @returns a IBehatsdaaVariant object for testing
 */
function variant(overrides: Partial<IBehatsdaaVariant> = {}): IBehatsdaaVariant {
  return {
    name: 'Test Product',
    variantName: 'Size L',
    customerPrice: 100,
    orderDate: '2025-06-15T10:00:00',
    tTransactionID: 'TXN-001',
    ...overrides,
  };
}

/**
 * Creates a mock page configured with a Behatsdaa user token.
 *
 * @param token - the mock token to return from localStorage.getItem evaluation
 * @returns a mock page configured for Behatsdaa tests
 */
function createBehatsdaaPage(token = 'mock-token'): ReturnType<typeof createMockPage> {
  return createMockPage({
    evaluate: jest.fn().mockResolvedValue(token),
    $: jest.fn().mockResolvedValue({ click: jest.fn().mockResolvedValue(undefined) }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (launchWithEngine as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const freshPage = createBehatsdaaPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(freshPage);
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://www.behatsdaa.org.il/');
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      isFound: true,
      value: { data: { memberId: 'M001', variants: [] } },
    });

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(buildContextOptions).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('returns error when token not in localStorage', async () => {
    const nullTokenPage = createBehatsdaaPage('');
    MOCK_CONTEXT.newPage.mockResolvedValue(nullTokenPage);

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('TokenNotFound');
  });

  it('returns error when API response has errorDescription', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      isFound: true,
      value: { errorDescription: 'Service unavailable' },
    });

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Service unavailable');
  });

  it('returns error when API response has no data', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({ isFound: true, value: {} });

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('NoData');
  });

  it('converts variants to transactions', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      isFound: true,
      value: {
        data: {
          memberId: 'M001',
          variants: [variant({ customerPrice: 250, name: 'Gift Card', variantName: 'Premium' })],
        },
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
      isFound: true,
      value: { data: { memberId: 'M001', variants: [variant()] } },
    });

    const scraper = new BehatsdaaScraper(createMockScraperOptions({ includeRawTransaction: true }));
    const result = await scraper.scrape(CREDS);

    expect((result.accounts ?? [])[0].txns[0].rawTransaction).toBeDefined();
  });

  it('sends Bearer token in authorization header', async () => {
    (fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      isFound: true,
      value: { data: { memberId: 'M001', variants: [] } },
    });

    const scraper = new BehatsdaaScraper(createMockScraperOptions());
    await scraper.scrape(CREDS);

    const anyArg = expect.anything() as unknown;
    const anyStr = expect.any(String) as string;
    const extraHeadersMatcher = { authorization: 'Bearer mock-token' };
    const headersMatcher = expect.objectContaining(extraHeadersMatcher) as Record<string, string>;
    const bodyMatcher = expect.objectContaining({ extraHeaders: headersMatcher }) as object;
    expect(fetchPostWithinPage).toHaveBeenCalledWith(anyArg, anyStr, bodyMatcher);
  });
});
