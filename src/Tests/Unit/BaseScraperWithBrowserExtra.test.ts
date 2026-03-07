import { launchWithEngine } from '../../Common/BrowserEngine';
import { getCurrentUrl } from '../../Common/Navigation';
import { ScraperProgressTypes } from '../../Definitions';
import { ScraperErrorTypes } from '../../Scrapers/Base/Errors';
import {
  createMockBrowser,
  createMockContext,
  createMockPage,
  createMockScraperOptions,
} from '../MockPage';
import BareScraperWithBrowser from './BareScraperWithBrowserHelper';
import { createScraper } from './BaseScraperWithBrowserTestHelpers';

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

const MOCK_BROWSER: ReturnType<typeof createMockBrowser> = createMockBrowser();

beforeEach(() => {
  jest.clearAllMocks();
  (launchWithEngine as jest.Mock).mockResolvedValue(MOCK_BROWSER);
  const freshPage = createMockPage();
  const freshContext = createMockContext(freshPage);
  MOCK_BROWSER.newContext.mockResolvedValue(freshContext);
  (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/dashboard');
});

describe('terminate', () => {
  it('skips screenshot on success', async () => {
    const page = createMockPage();
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper({ storeFailureScreenShotPath: '/tmp/fail.png' });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(page.screenshot).not.toHaveBeenCalled();
  });

  it('captures screenshot on failure when path configured', async () => {
    const page = createMockPage();
    page.goto.mockResolvedValue({
      /**
       * Mock ok() returning false for an error response.
       *
       * @returns false indicating a failed response
       */
      ok: () => false,
      /**
       * Mock status() returning 500 for a server error.
       *
       * @returns 500 HTTP status code
       */
      status: () => 500,
    });
    const ctx = createMockContext(page);
    MOCK_BROWSER.newContext.mockResolvedValue(ctx);
    const scraper = createScraper({
      storeFailureScreenShotPath: '/tmp/fail.png',
      navigationRetryCount: 0,
    });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(page.screenshot).toHaveBeenCalledWith({ path: '/tmp/fail.png', fullPage: true });
  });

  it('executes cleanups after scrape', async () => {
    const scraper = createScraper();
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(MOCK_BROWSER.close).toHaveBeenCalled();
  });
});

describe('progress events', () => {
  it('emits Initializing and LoginSuccess on successful login', async () => {
    const events: ScraperProgressTypes[] = [];
    const scraper = createScraper();
    scraper.onProgress((_id, payload) => {
      events.push(payload.type);
      return { done: true as const };
    });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(events).toContain(ScraperProgressTypes.Initializing);
    expect(events).toContain(ScraperProgressTypes.LoginSuccess);
    expect(events).toContain(ScraperProgressTypes.LoggingIn);
  });

  it('emits LoginFailed on invalid password', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/login?error=1');
    const events: ScraperProgressTypes[] = [];
    const scraper = createScraper();
    scraper.onProgress((_id, payload) => {
      events.push(payload.type);
      return { done: true as const };
    });
    await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(events).toContain(ScraperProgressTypes.LoginFailed);
  });
});

describe('getLoginOptions', () => {
  it('throws when not overridden', () => {
    const scraper = new BareScraperWithBrowser(createMockScraperOptions());
    expect(() => scraper.getLoginOptions({ userCode: 'a', password: 'b' })).toThrow(
      'getLoginOptions()',
    );
  });
});

describe('login errors', () => {
  it('returns generic error for unknown URL', async () => {
    (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.co.il/unknown-page');
    const scraper = createScraper();
    const result = await scraper.scrape({ userCode: 'test', password: 'test' });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });
});
