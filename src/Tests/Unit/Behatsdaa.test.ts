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
  /**
   * Executes async actions sequentially, collecting results.
   * @param actions - Array of async factory functions.
   * @returns Array of resolved values.
   */
  runSerial: jest.fn().mockImplementation(<T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
    const seed = Promise.resolve([] as T[]);
    return actions.reduce(
      (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
      seed,
    );
  }),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  waitUntil: jest.fn().mockResolvedValue(undefined),
  raceTimeout: jest.fn().mockResolvedValue(undefined),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

jest.unstable_mockModule('../../Common/OtpHandler.js', () => ({
  handleOtpStep: jest.fn().mockResolvedValue(null),

  handleOtpCode: jest.fn().mockResolvedValue(undefined),

  handleOtpConfirm: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../Common/Transactions.js', () => ({
  getRawTransaction: jest.fn((data: Record<string, string>) => data),
}));

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns A mock debug logger object.
   */
  getDebug: (): Record<string, jest.Mock> => ({
    trace: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
  /**
   * Passthrough mock for bank context.
   * @param _b - Bank name (unused).
   * @param fn - Function to execute.
   * @returns fn result.
   */
  runWithBankContext: <T>(_b: string, fn: () => T): T => fn(),
}));

const BROWSER_MOD = await import('../../Common/Browser.js');
const CAMOUFOX_MOD = await import('../../Common/CamoufoxLauncher.js');
const FETCH_MOD = await import('../../Common/Fetch.js');
const NAVIGATION_MOD = await import('../../Common/Navigation.js');
const BEHATSDAA_MOD = await import('../../Scrapers/Behatsdaa/BehatsdaaScraper.js');
const TRANSACTIONS_MOD = await import('../../Transactions.js');
const MOCK_PAGE_MOD = await import('../MockPage.js');

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
 * Creates a Behatsdaa API variant with optional overrides.
 * @param overrides - Partial variant fields to override defaults.
 * @returns A complete Behatsdaa variant object.
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
 * Creates a mock page configured for Behatsdaa scraper tests.
 * @param token - The localStorage token value, defaults to 'mock-token'.
 * @returns A mock page with Behatsdaa-specific eval behavior.
 */
function createBehatsdaaPage(
  token = 'mock-token',
): ReturnType<typeof MOCK_PAGE_MOD.createMockPage> {
  const tokenValue = token === 'NO_TOKEN' ? null : token;
  return MOCK_PAGE_MOD.createMockPage({
    evaluate: jest.fn().mockResolvedValue(tokenValue),
    $: jest.fn().mockResolvedValue({ click: jest.fn().mockResolvedValue(undefined) }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (CAMOUFOX_MOD.launchCamoufox as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const behatsdaaPage = createBehatsdaaPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(behatsdaaPage);
  (NAVIGATION_MOD.getCurrentUrl as jest.Mock).mockResolvedValue('https://www.behatsdaa.org.il/');
});

describe('login', () => {
  it('succeeds with valid credentials', async () => {
    (FETCH_MOD.fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      data: { memberId: 'M001', variants: [] },
    });

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new BEHATSDAA_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(BROWSER_MOD.buildContextOptions).toHaveBeenCalled();
  });
});

describe('fetchData', () => {
  it('returns error when token not in localStorage', async () => {
    const nullTokenPage = createBehatsdaaPage('NO_TOKEN');
    MOCK_CONTEXT.newPage.mockResolvedValue(nullTokenPage);

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new BEHATSDAA_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('TokenNotFound');
  });

  it('returns error when API response has errorDescription', async () => {
    (FETCH_MOD.fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      errorDescription: 'Service unavailable',
    });

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new BEHATSDAA_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toBe('Service unavailable');
  });

  it('returns error when API response has no data', async () => {
    (FETCH_MOD.fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({});

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new BEHATSDAA_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('NoData');
  });

  it('converts variants to transactions', async () => {
    const giftVariant = variant({ customerPrice: 250, name: 'Gift Card', variantName: 'Premium' });
    (FETCH_MOD.fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      data: {
        memberId: 'M001',
        variants: [giftVariant],
      },
    });

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new BEHATSDAA_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    const firstAccount = result.accounts?.[0];
    expect(firstAccount?.accountNumber).toBe('M001');

    const txn = firstAccount?.txns[0];
    expect(txn?.originalAmount).toBe(-250);
    expect(txn?.originalCurrency).toBe('ILS');
    expect(txn?.status).toBe(TRANSACTIONS_MOD.TransactionStatuses.Completed);
    expect(txn?.type).toBe(TRANSACTIONS_MOD.TransactionTypes.Normal);
    expect(txn?.description).toBe('Gift Card');
    expect(txn?.memo).toBe('Premium');
  });

  it('includes rawTransaction when option set', async () => {
    (FETCH_MOD.fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      data: { memberId: 'M001', variants: [variant()] },
    });

    const options = MOCK_PAGE_MOD.createMockScraperOptions({ includeRawTransaction: true });
    const scraper = new BEHATSDAA_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns[0].rawTransaction).toBeDefined();
  });

  it('sends Bearer token in authorization header', async () => {
    (FETCH_MOD.fetchPostWithinPage as jest.Mock).mockResolvedValueOnce({
      data: { memberId: 'M001', variants: [] },
    });

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new BEHATSDAA_MOD.default(options);
    await scraper.scrape(CREDS);

    const fetchMock = FETCH_MOD.fetchPostWithinPage as jest.Mock;
    const callArgs = fetchMock.mock.calls[0] as [
      Record<string, string>,
      string,
      { extraHeaders: Record<string, string> },
    ];
    expect(callArgs[2].extraHeaders.authorization).toBe('Bearer mock-token');
  });
});
