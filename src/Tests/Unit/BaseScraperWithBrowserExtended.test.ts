import { jest } from '@jest/globals';
import { type Browser } from 'playwright';

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
const { fillInput: FILL_INPUT } = await import('../../Common/ElementsInteractions.js');
const { getCurrentUrl: GET_CURRENT_URL, waitForNavigation: WAIT_NAV } =
  await import('../../Common/Navigation.js');
const { ScraperProgressTypes: PROGRESS_TYPES } = await import('../../Definitions.js');
const { BaseScraperWithBrowser: BASE_SCRAPER_WITH_BROWSER, LOGIN_RESULTS } =
  await import('../../Scrapers/Base/BaseScraperWithBrowser.js');
const { ScraperErrorTypes: ERROR_TYPES } = await import('../../Scrapers/Base/Errors.js');
const { default: SCRAPER_ERROR } = await import('../../Scrapers/Base/ScraperError.js');
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
 * Test scraper for BaseScraperWithBrowser extended tests.
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

interface IProgressPayload {
  type: string;
}

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

describe('progress events', () => {
  it('emits Initializing and LoginSuccess on successful login', async () => {
    const events: string[] = [];
    const scraper = createScraper();
    scraper.onProgress(
      /**
       * Capture progress events.
       * @param _id - Event ID.
       * @param payload - Event payload with type.
       * @returns True to continue.
       */
      (_id: string, payload: IProgressPayload): boolean => {
        events.push(payload.type);
        return true;
      },
    );
    await scraper.scrape(TEST_CREDS);
    expect(events).toContain(PROGRESS_TYPES.Initializing);
    expect(events).toContain(PROGRESS_TYPES.LoginSuccess);
    expect(events).toContain(PROGRESS_TYPES.LoggingIn);
  });

  it('emits LoginFailed on invalid password', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://bank.co.il/login?error=1');
    const events: string[] = [];
    const scraper = createScraper();
    scraper.onProgress(
      /**
       * Capture progress events.
       * @param _id - Event ID.
       * @param payload - Event payload with type.
       * @returns True to continue.
       */
      (_id: string, payload: IProgressPayload): boolean => {
        events.push(payload.type);
        return true;
      },
    );
    await scraper.scrape(TEST_CREDS);
    expect(events).toContain(PROGRESS_TYPES.LoginFailed);
  });
});

describe('login extended', () => {
  it('detects login result via async function condition', async () => {
    (GET_CURRENT_URL as jest.Mock).mockResolvedValue('https://bank.co.il/otp');
    const scraper = createScraper();
    scraper.loginOpts = {
      ...defaultLoginOptions(),
      possibleResults: {
        [LOGIN_RESULTS.Success]: [
          /**
           * Async success check.
           * @returns True for success.
           */
          (): Promise<boolean> => Promise.resolve(true),
        ],
      },
    };
    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(true);
  });

  it('calls postAction when provided', async () => {
    const postAction = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), postAction };
    await scraper.scrape(TEST_CREDS);
    expect(postAction).toHaveBeenCalled();
  });
});

describe('screenshot on failure', () => {
  it('captures screenshot on failure when path configured', async () => {
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
    const opts = { storeFailureScreenShotPath: '/tmp/fail.png', navigationRetryCount: 0 };
    await createScraper(opts).scrape(TEST_CREDS);
    expect(page.screenshot).toHaveBeenCalledWith({ path: '/tmp/fail.png', fullPage: true });
  });

  it('skips screenshot on success', async () => {
    const page = CREATE_MOCK_PAGE();
    const ctx = CREATE_MOCK_CONTEXT(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    await createScraper({ storeFailureScreenShotPath: '/tmp/fail.png' }).scrape(TEST_CREDS);
    expect(page.screenshot).not.toHaveBeenCalled();
  });
});

describe('preparePage and prepareBrowser hooks', () => {
  it('calls preparePage hook when provided', async () => {
    const preparePage = jest.fn().mockResolvedValue(undefined);
    await createScraper({ preparePage }).scrape(TEST_CREDS);
    expect(preparePage).toHaveBeenCalled();
  });

  it('calls prepareBrowser hook when provided', async () => {
    const prepareBrowser = jest.fn().mockResolvedValue(undefined);
    await createScraper({ prepareBrowser }).scrape(TEST_CREDS);
    expect(prepareBrowser).toHaveBeenCalledWith(MOCK_BROWSER);
  });
});

describe('navigateTo extended', () => {
  it('navigates to login URL successfully', async () => {
    const page = CREATE_MOCK_PAGE();
    page.goto.mockResolvedValue({
      /**
       * OK response.
       * @returns True.
       */
      ok: (): boolean => true,
      /**
       * HTTP status.
       * @returns 200.
       */
      status: (): number => 200,
    });
    const ctx = CREATE_MOCK_CONTEXT(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    await createScraper().scrape(TEST_CREDS);
    expect(page.goto).toHaveBeenCalledWith('https://bank.co.il/login', { waitUntil: 'load' });
  });

  it('accepts null response (hash navigation)', async () => {
    const page = CREATE_MOCK_PAGE();
    page.goto.mockResolvedValue(null);
    const ctx = CREATE_MOCK_CONTEXT(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const result = await createScraper().scrape(TEST_CREDS);
    expect(result.success).toBeDefined();
  });
});

describe('fillInputs extended', () => {
  it('handles empty fields array', async () => {
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), fields: [] };
    await scraper.scrape(TEST_CREDS);
    expect(FILL_INPUT).not.toHaveBeenCalled();
  });
});

describe('login edge cases', () => {
  it('launches Camoufox successfully', async () => {
    const result = await createScraper().scrape(TEST_CREDS);
    expect(result.success).toBe(true);
    expect(LAUNCH_CAMOUFOX).toHaveBeenCalled();
  });

  it('returns general error when login throws', async () => {
    const scraper = createScraper();
    scraper.loginOpts = {
      ...defaultLoginOptions(),
      /** Simulate login failure. @returns Never — always throws. */
      checkReadiness: (): never => {
        throw new SCRAPER_ERROR('login failed unexpectedly');
      },
    };
    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ERROR_TYPES.Generic);
  });

  it('waits for navigation when no postAction', async () => {
    await createScraper().scrape(TEST_CREDS);
    expect(WAIT_NAV).toHaveBeenCalled();
  });
});

describe('skipCloseBrowser', () => {
  it('skips browser close when skipCloseBrowser is true', async () => {
    const page = CREATE_MOCK_PAGE();
    const ctx = CREATE_MOCK_CONTEXT(page);
    const closeFn = jest.fn();
    const browser = {
      newContext: jest.fn().mockResolvedValue(ctx),
      close: closeFn,
    } as unknown as Browser;
    const opts = { browser, skipCloseBrowser: true };
    await new TestBrowserScraper(CREATE_OPTS(opts)).scrape(TEST_CREDS);
    expect(closeFn).not.toHaveBeenCalled();
  });
});

describe('getLoginOptions base', () => {
  it('throws when base class version is called', () => {
    const instance = createScraper();
    const creds = { userCode: 'a', password: 'b' };
    const bound = BASE_SCRAPER_WITH_BROWSER.prototype.getLoginOptions.bind(instance);
    expect(() => bound(creds)).toThrow('getLoginOptions()');
  });
});
