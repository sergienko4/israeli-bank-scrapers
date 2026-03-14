import { jest } from '@jest/globals';
import { type Browser, type BrowserContext } from 'playwright-core';

import { type ILoginOptions } from '../../Scrapers/Base/BaseScraperWithBrowser.js';
import {
  type IScraperScrapingResult,
  type ScraperCredentials,
  type ScraperOptions,
} from '../../Scrapers/Base/Interface.js';

jest.unstable_mockModule(
  '../../Common/CamoufoxLauncher.js',
  /**
   * Mock CamoufoxLauncher.
   * @returns Mocked module.
   */
  () => ({ launchCamoufox: jest.fn() }),
);

jest.unstable_mockModule(
  '../../Common/ElementsInteractions.js',
  /**
   * Mock ElementsInteractions.
   * @returns Mocked module.
   */
  () => ({
    clickButton: jest.fn().mockResolvedValue(undefined),
    fillInput: jest.fn().mockResolvedValue(undefined),
    waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
    elementPresentOnPage: jest.fn().mockResolvedValue(false),
    capturePageText: jest.fn().mockResolvedValue(''),
  }),
);

jest.unstable_mockModule(
  '../../Common/Navigation.js',
  /**
   * Mock Navigation.
   * @returns Mocked module.
   */
  () => ({
    getCurrentUrl: jest.fn().mockResolvedValue('https://bank.co.il/dashboard'),
    waitForNavigation: jest.fn().mockResolvedValue(undefined),
    waitForNavigationAndDomLoad: jest.fn().mockResolvedValue(undefined),
    waitForRedirect: jest.fn().mockResolvedValue(undefined),
    waitForUrl: jest.fn().mockResolvedValue(undefined),
  }),
);

jest.unstable_mockModule(
  '../../Common/Debug.js',
  /**
   * Mock Debug.
   * @returns Mocked module.
   */
  () => ({
    getDebug:
      /**
       * Debug factory.
       * @returns Mock logger.
       */
      (): Record<string, jest.Mock> => ({
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
  }),
);

jest.unstable_mockModule(
  '../../Common/Browser.js',
  /**
   * Mock Browser.
   * @returns Mocked module.
   */
  () => ({ buildContextOptions: jest.fn().mockReturnValue({}) }),
);

const { launchCamoufox: LAUNCH_CAMOUFOX } = await import('../../Common/CamoufoxLauncher.js');
const {
  clickButton: CLICK_BUTTON,
  fillInput: FILL_INPUT,
  waitUntilElementFound: WAIT_FOR_ELEMENT,
} = await import('../../Common/ElementsInteractions.js');
const { getCurrentUrl: GET_CURRENT_URL } = await import('../../Common/Navigation.js');
const { BaseScraperWithBrowser: BASE_SCRAPER_WITH_BROWSER, LOGIN_RESULTS } =
  await import('../../Scrapers/Base/BaseScraperWithBrowser.js');
const { ScraperErrorTypes: SCRAPER_ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const {
  createMockBrowser: CREATE_MOCK_BROWSER,
  createMockContext: CREATE_MOCK_CONTEXT,
  createMockPage: CREATE_MOCK_PAGE,
  createMockScraperOptions: CREATE_OPTS,
} = await import('../MockPage.js');

const MOCK_PAGE = CREATE_MOCK_PAGE();
const MOCK_CONTEXT = CREATE_MOCK_CONTEXT(MOCK_PAGE);
const MOCK_BROWSER = CREATE_MOCK_BROWSER(MOCK_CONTEXT);

/**
 * Build default login options for test scraper.
 * @returns Login options with test URLs.
 */
function defaultLoginOptions(): ILoginOptions {
  return {
    loginUrl: 'https://bank.co.il/login',
    fields: [
      { selector: '#user', value: 'testuser' },
      { selector: '#pass', value: 'testpass' },
    ],
    submitButtonSelector: '#submit',
    possibleResults: {
      [LOGIN_RESULTS.Success]: ['https://bank.co.il/dashboard'],
      [LOGIN_RESULTS.InvalidPassword]: ['https://bank.co.il/login?error=1'],
      [LOGIN_RESULTS.ChangePassword]: [/change-password/],
    },
  };
}

/**
 * Test scraper for BaseScraperWithBrowser tests.
 */
class TestBrowserScraper extends BASE_SCRAPER_WITH_BROWSER<ScraperCredentials> {
  public loginOpts: ILoginOptions = defaultLoginOptions();

  public fetchResult: IScraperScrapingResult = { success: true, accounts: [] };

  /**
   * Get test login options.
   * @returns Login options.
   */
  public getLoginOptions(): ILoginOptions {
    return this.loginOpts;
  }

  /**
   * Fetch test data.
   * @returns Scraping result.
   */
  public async fetchData(): Promise<IScraperScrapingResult> {
    return Promise.resolve(this.fetchResult);
  }
}

/**
 * Create a test scraper with optional overrides.
 * @param overrides - Scraper option overrides.
 * @returns Test scraper instance.
 */
function createScraper(overrides: Partial<ScraperOptions> = {}): TestBrowserScraper {
  return new TestBrowserScraper(CREATE_OPTS(overrides));
}

const TEST_CREDS = { userCode: 'test', password: 'test' };

beforeEach(
  /**
   * Clear mocks before each test.
   * @returns Test setup flag.
   */
  () => {
    jest.clearAllMocks();
    (LAUNCH_CAMOUFOX as jest.Mock).mockResolvedValue(MOCK_BROWSER);
    const freshPage = CREATE_MOCK_PAGE();
    const freshContext = CREATE_MOCK_CONTEXT(freshPage);
    MOCK_BROWSER.newContext.mockResolvedValue(freshContext);
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://bank.co.il/dashboard');
    return true;
  },
);

describe('initialize', () => {
  it('launches browser and creates context + page', async () => {
    await createScraper().scrape(TEST_CREDS);
    expect(LAUNCH_CAMOUFOX as jest.Mock).toHaveBeenCalled();
    expect(MOCK_BROWSER.newContext).toHaveBeenCalled();
  });

  it('sets default timeout when provided', async () => {
    const page = CREATE_MOCK_PAGE();
    const ctx = CREATE_MOCK_CONTEXT(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    await createScraper({ defaultTimeout: 60000 }).scrape(TEST_CREDS);
    expect(page.setDefaultTimeout).toHaveBeenCalledWith(60000);
  });
});

describe('initializePage', () => {
  it('uses browserContext when provided', async () => {
    const page = CREATE_MOCK_PAGE();
    const newPageFn = jest.fn().mockResolvedValue(page);
    const browserContext = { newPage: newPageFn } as unknown as BrowserContext;
    await new TestBrowserScraper(CREATE_OPTS({ browserContext })).scrape(TEST_CREDS);
    expect(newPageFn).toHaveBeenCalled();
    expect(LAUNCH_CAMOUFOX as jest.Mock).not.toHaveBeenCalled();
  });

  it('uses external browser and creates context', async () => {
    const page = CREATE_MOCK_PAGE();
    const ctx = CREATE_MOCK_CONTEXT(page);
    const newContextFn = jest.fn().mockResolvedValue(ctx);
    const browser = { newContext: newContextFn, close: jest.fn() } as unknown as Browser;
    await new TestBrowserScraper(CREATE_OPTS({ browser })).scrape(TEST_CREDS);
    expect(newContextFn).toHaveBeenCalled();
    expect(LAUNCH_CAMOUFOX as jest.Mock).not.toHaveBeenCalled();
  });

  it('launches new browser with headless mode', async () => {
    await createScraper({ shouldShowBrowser: false }).scrape(TEST_CREDS);
    expect(LAUNCH_CAMOUFOX).toHaveBeenCalledWith(true);
  });
});

describe('navigateTo', () => {
  it('retries on non-OK response', async () => {
    const page = CREATE_MOCK_PAGE();
    page.goto
      .mockResolvedValueOnce({
        ok:
          /**
           * Not OK.
           * @returns False.
           */
          (): boolean => false,
        status:
          /**
           * Status code.
           * @returns 503.
           */
          (): number => 503,
      })
      .mockResolvedValueOnce({
        ok:
          /**
           * OK.
           * @returns True.
           */
          (): boolean => true,
        status:
          /**
           * Status code.
           * @returns 200.
           */
          (): number => 200,
      });
    const ctx = CREATE_MOCK_CONTEXT(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    await createScraper({ navigationRetryCount: 1 }).scrape(TEST_CREDS);
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('fails when retries exhausted', async () => {
    const page = CREATE_MOCK_PAGE();
    page.goto.mockResolvedValue({
      ok:
        /**
         * Not OK.
         * @returns False.
         */
        (): boolean => false,
      status:
        /**
         * Status code.
         * @returns 500.
         */
        (): number => 500,
    });
    const ctx = CREATE_MOCK_CONTEXT(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const result = await createScraper({ navigationRetryCount: 0 }).scrape(TEST_CREDS);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('status code: 500');
  });
});

describe('fillInputs', () => {
  it('fills multiple input fields', async () => {
    await createScraper().scrape(TEST_CREDS);
    const anyArg = expect.anything() as ReturnType<typeof CREATE_MOCK_PAGE>;
    expect(FILL_INPUT).toHaveBeenCalledWith(anyArg, '#user', 'testuser');
    expect(FILL_INPUT).toHaveBeenCalledWith(anyArg, '#pass', 'testpass');
  });
});

describe('login', () => {
  it('completes successful login flow', async () => {
    const result = await createScraper().scrape(TEST_CREDS);
    expect(result.success).toBe(true);
  });

  it('clicks string submitButtonSelector', async () => {
    await createScraper().scrape(TEST_CREDS);
    const anyArg = expect.anything() as ReturnType<typeof CREATE_MOCK_PAGE>;
    expect(CLICK_BUTTON).toHaveBeenCalledWith(anyArg, '#submit');
  });

  it('detects invalid password from URL', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://bank.co.il/login?error=1');
    const result = await createScraper().scrape(TEST_CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(SCRAPER_ERROR_TYPES.InvalidPassword);
  });

  it('detects change password from regex match', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://bank.co.il/change-password');
    const result = await createScraper().scrape(TEST_CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(SCRAPER_ERROR_TYPES.ChangePassword);
  });

  it('returns unknown error when no URL matches', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://bank.co.il/unknown-page');
    const result = await createScraper().scrape(TEST_CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(SCRAPER_ERROR_TYPES.Generic);
  });

  it('calls function submitButtonSelector instead of clicking', async () => {
    const submitFn = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), submitButtonSelector: submitFn };
    await scraper.scrape(TEST_CREDS);
    expect(submitFn).toHaveBeenCalled();
    expect(CLICK_BUTTON).not.toHaveBeenCalled();
  });

  it('waits for submit button when no checkReadiness', async () => {
    await createScraper().scrape(TEST_CREDS);
    const anyArg = expect.anything() as ReturnType<typeof CREATE_MOCK_PAGE>;
    expect(WAIT_FOR_ELEMENT).toHaveBeenCalledWith(anyArg, '#submit');
  });

  it('calls checkReadiness when provided', async () => {
    const checkReadiness = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), checkReadiness };
    await scraper.scrape(TEST_CREDS);
    expect(checkReadiness).toHaveBeenCalled();
    expect(WAIT_FOR_ELEMENT).not.toHaveBeenCalled();
  });
});

describe('terminate', () => {
  it('executes cleanups after scrape', async () => {
    await createScraper().scrape(TEST_CREDS);
    expect(MOCK_BROWSER.close).toHaveBeenCalled();
  });
});
