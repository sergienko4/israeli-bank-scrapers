import { type Browser, type BrowserContext } from 'playwright';

import { launchWithEngine } from '../../Common/BrowserEngine';
import { clickButton, fillInput, waitUntilElementFound } from '../../Common/ElementsInteractions';
import { getCurrentUrl, waitForNavigation } from '../../Common/Navigation';
import { LOGIN_RESULTS } from '../../Scrapers/Base/BaseScraperWithBrowser';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import type { ScraperOptions } from '../../Scrapers/Base/Interface';
import { ScraperAuthenticationError } from '../../Scrapers/Base/ScraperAuthenticationError';
import {
  createMockBrowser,
  createMockContext,
  createMockPage,
  createMockScraperOptions,
} from '../MockPage';
import TestBrowserScraper, {
  createScraper,
  defaultLoginOptions,
} from './BaseScraperWithBrowserTestHelpers';

jest.mock('../../Common/BrowserEngine', () => ({
  launchWithEngine: jest.fn(),
  BrowserEngineType: {
    PlaywrightStealth: 'playwright-stealth',
    Rebrowser: 'rebrowser',
    Patchright: 'patchright',
  },
}));

jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../Common/Navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://bank.co.il/dashboard'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

const MOCK_PAGE: ReturnType<typeof createMockPage> = createMockPage();
const MOCK_CONTEXT: ReturnType<typeof createMockContext> = createMockContext(MOCK_PAGE);
const MOCK_BROWSER: ReturnType<typeof createMockBrowser> = createMockBrowser(MOCK_CONTEXT);
const TEST_CREDS = { userCode: 'test', password: 'test' };

beforeEach(() => {
  jest.clearAllMocks();
  (launchWithEngine as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const freshPage = createMockPage();
  const freshContext = createMockContext(freshPage);
  MOCK_BROWSER.newContext.mockResolvedValue(freshContext);
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/dashboard');
});

describe('initialize', () => {
  it('launches browser and creates context + page', async () => {
    await createScraper().scrape(TEST_CREDS);
    expect(launchWithEngine).toHaveBeenCalled();
    expect(MOCK_BROWSER.newContext).toHaveBeenCalled();
  });

  it('sets default timeout when provided in options', async () => {
    const page = createMockPage();
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper({ defaultTimeout: 60000 });
    await scraper.scrape(TEST_CREDS);
    expect(page.setDefaultTimeout).toHaveBeenCalledWith(60000);
  });

  it('calls preparePage hook when provided', async () => {
    const preparePage = jest.fn().mockResolvedValue(undefined);
    await createScraper({ preparePage }).scrape(TEST_CREDS);
    expect(preparePage).toHaveBeenCalled();
  });
});

describe('initializePage', () => {
  it('uses browserContext when provided', async () => {
    const page = createMockPage();
    const newPageMock = jest.fn().mockResolvedValue(page);
    const browserContext = { newPage: newPageMock } as unknown as BrowserContext;
    const scraper = new TestBrowserScraper(createMockScraperOptions({ browserContext }));
    await scraper.scrape(TEST_CREDS);
    expect(newPageMock).toHaveBeenCalled();
    expect(launchWithEngine).not.toHaveBeenCalled();
  });

  it('uses external browser and creates context', async () => {
    const page = createMockPage();
    const ctx = createMockContext(page);
    const newContextMock = jest.fn().mockResolvedValue(ctx);
    const browser = { newContext: newContextMock, close: jest.fn() } as unknown as Browser;
    const scraper = new TestBrowserScraper(createMockScraperOptions({ browser }));
    await scraper.scrape(TEST_CREDS);
    expect(newContextMock).toHaveBeenCalled();
    expect(launchWithEngine).not.toHaveBeenCalled();
  });

  it('skips browser close cleanup when skipCloseBrowser is true', async () => {
    const page = createMockPage();
    const ctx = createMockContext(page);
    const closeMock = jest.fn();
    const browser = {
      newContext: jest.fn().mockResolvedValue(ctx),
      close: closeMock,
    } as unknown as Browser;
    const scraper = new TestBrowserScraper(
      createMockScraperOptions({ browser, skipCloseBrowser: true }),
    );
    await scraper.scrape(TEST_CREDS);
    expect(closeMock).not.toHaveBeenCalled();
  });

  it('launches new browser with headless mode', async () => {
    await createScraper({ shouldShowBrowser: false }).scrape(TEST_CREDS);
    const headlessMatcher = expect.objectContaining({ headless: true }) as object;
    const anyEngineName = expect.any(String) as string;
    expect(launchWithEngine).toHaveBeenCalledWith(anyEngineName, headlessMatcher);
  });

  it('calls prepareBrowser hook when provided', async () => {
    const prepareBrowser = jest.fn().mockResolvedValue(undefined);
    await createScraper({ prepareBrowser }).scrape(TEST_CREDS);
    expect(prepareBrowser).toHaveBeenCalledWith(MOCK_BROWSER);
  });

  it('launches successfully without executablePath (uses Playwright bundled Chromium)', async () => {
    const result = await createScraper().scrape(TEST_CREDS);
    expect(result.success).toBe(true);
    const anyStr = expect.any(String) as string;
    const noExecPath = expect.not.objectContaining({ executablePath: anyStr }) as object;
    const anyEngineName = expect.any(String) as string;
    expect(launchWithEngine).toHaveBeenCalledWith(anyEngineName, noExecPath);
  });

  it('rejects custom executablePath to prevent system Chromium usage', async () => {
    const scraper = createScraper({
      executablePath: '/usr/bin/chromium',
    } as Partial<ScraperOptions>);
    const scrapePromise = scraper.scrape(TEST_CREDS);
    await expect(scrapePromise).rejects.toThrow('executablePath not supported');
  });
});

describe('navigateTo', () => {
  it('navigates to URL successfully', async () => {
    const page = createMockPage();
    page.goto.mockResolvedValue({
      /**
       * Mock ok() returning true for a successful navigation.
       *
       * @returns true indicating a successful response
       */
      ok: () => true,
      /**
       * Mock status() returning 200 for a successful navigation.
       *
       * @returns 200 HTTP status code
       */
      status: () => 200,
    });
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper();
    await scraper.scrape(TEST_CREDS);
    expect(page.goto).toHaveBeenCalledWith('https://bank.co.il/login', { waitUntil: 'load' });
  });

  it('accepts null response (hash navigation)', async () => {
    const page = createMockPage();
    page.goto.mockResolvedValue(null);
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper();
    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBeDefined();
  });

  it('retries on non-OK response when retries available', async () => {
    const page = createMockPage();
    page.goto
      .mockResolvedValueOnce({
        /**
         * Mock ok() returning false for a failed response.
         *
         * @returns false indicating a failed response
         */
        ok: () => false,
        /**
         * Mock status() returning 503 for a service unavailable response.
         *
         * @returns 503 HTTP status code
         */
        status: () => 503,
      })
      .mockResolvedValueOnce({
        /**
         * Mock ok() returning true for a successful retry.
         *
         * @returns true indicating a successful retry response
         */
        ok: () => true,
        /**
         * Mock status() returning 200 for a successful retry.
         *
         * @returns 200 HTTP status code for successful retry
         */
        status: () => 200,
      });
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper({ navigationRetryCount: 1 });
    await scraper.scrape(TEST_CREDS);
    expect(page.goto).toHaveBeenCalledTimes(2);
  });

  it('throws when retries exhausted', async () => {
    const page = createMockPage();
    page.goto.mockResolvedValue({
      /**
       * Mock ok() returning false for an error response.
       *
       * @returns false indicating a failed response
       */
      ok: () => false,
      /**
       * Mock status() returning 500 for a server error response.
       *
       * @returns 500 HTTP status code
       */
      status: () => 500,
    });
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper({ navigationRetryCount: 0 });
    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Failed to navigate');
  });
});

describe('fillInputs', () => {
  it('fills multiple input fields', async () => {
    const scraper = createScraper();
    await scraper.scrape(TEST_CREDS);
    const anyArg = expect.anything() as unknown;
    expect(fillInput).toHaveBeenCalledWith(anyArg, '#user', 'testuser');
    expect(fillInput).toHaveBeenCalledWith(anyArg, '#pass', 'testpass');
  });

  it('handles empty fields array', async () => {
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), fields: [] };
    await scraper.scrape(TEST_CREDS);
    expect(fillInput).not.toHaveBeenCalled();
  });
});

describe('login', () => {
  it('returns general error when login throws', async () => {
    const scraper = createScraper();
    scraper.loginOpts = {
      ...defaultLoginOptions(),
      /**
       * Simulates a checkReadiness function that throws to test error handling.
       *
       * @returns never — always throws
       */
      checkReadiness: (): Promise<never> => {
        throw new ScraperAuthenticationError('test-bank', 'login failed unexpectedly');
      },
    };
    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });

  it('completes successful login flow', async () => {
    const scraper = createScraper();
    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(true);
  });

  it('calls checkReadiness when provided', async () => {
    const checkReadiness = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), checkReadiness };
    await scraper.scrape(TEST_CREDS);
    expect(checkReadiness).toHaveBeenCalled();
    expect(waitUntilElementFound).not.toHaveBeenCalled();
  });

  it('waits for submit button when no checkReadiness', async () => {
    const scraper = createScraper();
    await scraper.scrape(TEST_CREDS);
    const anyArg2 = expect.anything() as unknown;
    expect(waitUntilElementFound).toHaveBeenCalledWith(anyArg2, '#submit');
  });

  it('calls function submitButtonSelector instead of clicking', async () => {
    const submitFn = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), submitButtonSelector: submitFn };
    await scraper.scrape(TEST_CREDS);
    expect(submitFn).toHaveBeenCalled();
    expect(clickButton).not.toHaveBeenCalled();
  });

  it('clicks string submitButtonSelector', async () => {
    const scraper = createScraper();
    await scraper.scrape(TEST_CREDS);
    const anyArg3 = expect.anything() as unknown;
    expect(clickButton).toHaveBeenCalledWith(anyArg3, '#submit');
  });

  it('calls postAction when provided', async () => {
    const postAction = jest.fn().mockResolvedValue(undefined);
    const scraper = createScraper();
    scraper.loginOpts = { ...defaultLoginOptions(), postAction };
    await scraper.scrape(TEST_CREDS);
    expect(postAction).toHaveBeenCalled();
    expect(waitForNavigation).not.toHaveBeenCalled();
  });

  it('waits for navigation when no postAction', async () => {
    const scraper = createScraper();
    await scraper.scrape(TEST_CREDS);
    expect(waitForNavigation).toHaveBeenCalled();
  });

  it('detects invalid password from URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/login?error=1');
    const scraper = createScraper();
    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.InvalidPassword);
  });

  it('detects change password from regex match', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/change-password');
    const scraper = createScraper();
    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.ChangePassword);
  });

  it('returns unknown error when no URL matches', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/unknown-page');
    const scraper = createScraper();
    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });

  it('detects login result via async function condition', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/otp');
    const scraper = createScraper();
    scraper.loginOpts = {
      ...defaultLoginOptions(),
      possibleResults: {
        [LOGIN_RESULTS.Success]: [(): Promise<boolean> => Promise.resolve(true)],
      },
    };
    const result = await scraper.scrape(TEST_CREDS);
    expect(result.success).toBe(true);
  });
});
