import { jest } from '@jest/globals';
jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule('../../Common/ElementsInteractions.js', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
  waitUntilElementDisappear: jest.fn().mockResolvedValue(undefined),
  elementPresentOnPage: jest.fn().mockResolvedValue(false),
  pageEvalAll: jest.fn().mockResolvedValue([]),

  capturePageText: jest.fn().mockResolvedValue(''),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest
    .fn()
    .mockResolvedValue('https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/main/home'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),

  waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),

  waitForRedirect: jest.fn().mockResolvedValue(undefined),

  waitForUrl: jest.fn().mockResolvedValue(undefined),
}));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
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
const ELEMENTS_MOD = await import('../../Common/ElementsInteractions.js');
const NAVIGATION_MOD = await import('../../Common/Navigation.js');
const CONSTANTS_MOD = await import('../../Constants.js');
const ERRORS_MOD = await import('../../Scrapers/Base/Errors.js');
const YAHAV_MOD = await import('../../Scrapers/Yahav/YahavScraper.js');
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

const CREDS = { username: 'testuser', password: 'testpass', nationalID: '123456789' };

/**
 * Build the first-element stub for a Yahav locator.
 * @returns inner element mock with standard stubs.
 */
function yahavFirstElement(): Record<string, jest.Mock> {
  return {
    innerText: jest.fn().mockResolvedValue('ACC-12345'),
    waitFor: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(1),
    evaluate: jest.fn().mockResolvedValue(undefined),
    getAttribute: jest.fn().mockResolvedValue(null),
  };
}

/**
 * Build a nested locator stub for Yahav tests.
 * @returns mock locator with first/count/locator/all.
 */
/**
 * Return the expected innerText for a date picker grid cell selector.
 * @param sel - The CSS selector for the grid cell.
 * @returns The text value to match during grid scanning.
 */
/**
 * Build a nested locator stub for Yahav tests.
 * @returns mock locator with first/count/locator/all.
 */
function yahavLocatorImpl(): Record<string, jest.Mock> {
  const firstEl = yahavFirstElement();
  const subLoc = {
    first: jest.fn().mockReturnValue({ click: jest.fn().mockResolvedValue(undefined) }),
  };
  return {
    first: jest.fn().mockReturnValue(firstEl),
    count: jest.fn().mockResolvedValue(1),
    locator: jest.fn().mockReturnValue(subLoc),
    all: jest.fn().mockResolvedValue([]),
  };
}

/**
 * Creates a mock page for Yahav scraper tests.
 * @returns A mock page with Yahav-specific stubs.
 */
function createYahavPage(): ReturnType<typeof MOCK_PAGE_MOD.createMockPage> {
  const textLoc = {
    first: jest.fn(),
    isVisible: jest.fn().mockResolvedValue(false),
    waitFor: jest.fn().mockResolvedValue(undefined),
    click: jest.fn().mockResolvedValue(undefined),
  };
  textLoc.first = jest.fn().mockReturnValue(textLoc);
  return MOCK_PAGE_MOD.createMockPage({
    locator: jest.fn().mockImplementation(yahavLocatorImpl),
    waitForSelector: jest.fn().mockResolvedValue(undefined),
    getByText: jest.fn().mockReturnValue(textLoc),
    getByRole: jest.fn().mockReturnValue(textLoc),
    waitForLoadState: jest.fn().mockResolvedValue(undefined),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (CAMOUFOX_MOD.launchCamoufox as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const yahavPage = createYahavPage();
  MOCK_CONTEXT.newPage.mockResolvedValue(yahavPage);
  (NAVIGATION_MOD.getCurrentUrl as jest.Mock).mockResolvedValue(
    'https://digital.yahav.co.il/BaNCSDigitalUI/app/index.html#/main/home',
  );
  (ELEMENTS_MOD.elementPresentOnPage as jest.Mock).mockResolvedValue(false);
});

describe('login', () => {
  it('succeeds with 3-field credentials', async () => {
    (ELEMENTS_MOD.pageEvalAll as jest.Mock).mockResolvedValue([]);

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new YAHAV_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(BROWSER_MOD.buildContextOptions).toHaveBeenCalled();
  });

  it('returns InvalidPassword when dialog appears', async () => {
    (NAVIGATION_MOD.getCurrentUrl as jest.Mock).mockResolvedValue(
      'https://login.yahav.co.il/login/',
    );
    (ELEMENTS_MOD.elementPresentOnPage as jest.Mock).mockImplementation(
      (_p: Record<string, string>, selector: string) => {
        return selector === '.ui-dialog-buttons';
      },
    );

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new YAHAV_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERRORS_MOD.ScraperErrorTypes.InvalidPassword);
  });
});

describe('fetchData', () => {
  it('fetches and converts transactions', async () => {
    (ELEMENTS_MOD.pageEvalAll as jest.Mock).mockResolvedValueOnce([
      { id: '', innerDivs: ['0', '15/06/2025', '12345', 'סופר שופ', '150.00', ''] },
    ]);

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new YAHAV_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    const firstAccount = result.accounts?.[0];
    expect(firstAccount?.accountNumber).toBe('ACC-12345');

    const txn = firstAccount?.txns[0];
    expect(txn?.originalAmount).toBe(-150);
    expect(txn?.originalCurrency).toBe(CONSTANTS_MOD.SHEKEL_CURRENCY);
    expect(txn?.type).toBe(TRANSACTIONS_MOD.TransactionTypes.Normal);
    expect(txn?.status).toBe(TRANSACTIONS_MOD.TransactionStatuses.Completed);
    expect(txn?.description).toBe('סופר שופ');
  });

  it('cleans reference field with regex', async () => {
    (ELEMENTS_MOD.pageEvalAll as jest.Mock).mockResolvedValueOnce([
      { id: '', innerDivs: ['0', '15/06/2025', 'REF-123-ABC', 'Test', '50.00', ''] },
    ]);

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new YAHAV_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns[0].identifier).toBe(123);
  });

  it('calculates credit minus debit', async () => {
    (ELEMENTS_MOD.pageEvalAll as jest.Mock).mockResolvedValueOnce([
      { id: '', innerDivs: ['0', '15/06/2025', '', 'Credit', '', '300.00'] },
    ]);

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new YAHAV_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns[0].originalAmount).toBe(300);
  });

  it('handles NaN amounts', async () => {
    (ELEMENTS_MOD.pageEvalAll as jest.Mock).mockResolvedValueOnce([
      { id: '', innerDivs: ['0', '15/06/2025', '', 'Test', '', ''] },
    ]);

    const options = MOCK_PAGE_MOD.createMockScraperOptions();
    const scraper = new YAHAV_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns[0].originalAmount).toBe(0);
  });

  it('includes rawTransaction when option set', async () => {
    (ELEMENTS_MOD.pageEvalAll as jest.Mock).mockResolvedValueOnce([
      { id: '', innerDivs: ['0', '15/06/2025', '100', 'Test', '50.00', ''] },
    ]);

    const options = MOCK_PAGE_MOD.createMockScraperOptions({ includeRawTransaction: true });
    const scraper = new YAHAV_MOD.default(options);
    const result = await scraper.scrape(CREDS);

    expect(result.accounts?.[0]?.txns[0].rawTransaction).toBeDefined();
  });
});
