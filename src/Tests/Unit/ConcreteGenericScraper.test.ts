import { jest } from '@jest/globals';

import type { ILoginConfig } from '../../Scrapers/Base/Config/LoginConfig.js';
import type { ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import { mockToXpathLiteral } from '../MockModuleFactories.js';

jest.unstable_mockModule('../../Common/CamoufoxLauncher.js', () => ({ launchCamoufox: jest.fn() }));

jest.unstable_mockModule('../../Common/Browser.js', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.unstable_mockModule('../../Common/Navigation.js', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://bank.example.com/dashboard'),
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

jest.unstable_mockModule('../../Common/Debug.js', () => ({
  /**
   * Creates a mock debug logger.
   * @returns mock debug logger with all methods stubbed.
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

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  resolveFieldWithCache: jest
    .fn()
    .mockResolvedValue({ isResolved: false, selector: '', context: {} }),
  resolveFieldContext: jest.fn().mockResolvedValue({ selector: '#user', context: {} }),
  candidateToCss: jest.fn((candidate: { kind: string; value: string }) => candidate.value),
  getWellKnownCandidates: jest.fn().mockReturnValue([]),
  tryInContext: jest.fn().mockResolvedValue(null),
  toXpathLiteral: mockToXpathLiteral,
  extractCredentialKey: jest.fn((selector: string) => selector),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn().mockImplementation(
    /**
     * Execute actions sequentially like the real runSerial.
     * @param actions - Array of async action factories.
     * @returns Array of action results.
     */
    <T>(actions: (() => Promise<T>)[]): Promise<T[]> => {
      const seed = Promise.resolve([] as T[]);
      return actions.reduce(
        (p: Promise<T[]>, act: () => Promise<T>) => p.then(async (r: T[]) => [...r, await act()]),
        seed,
      );
    },
  ),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

const LAUNCH_CAMOUFOX_MODULE = await import('../../Common/CamoufoxLauncher.js');
const NAV_MODULE = await import('../../Common/Navigation.js');
const SCRAPER_MODULE = await import('../../Scrapers/Base/ConcreteGenericScraper.js');
const MOCK_MODULE = await import('../MockPage.js');

const SUCCESS_URL = 'https://bank.example.com/dashboard';

/**
 * Creates a login config with sensible defaults and optional overrides.
 * @param overrides - partial config to merge with defaults.
 * @returns complete login config for tests.
 */
function makeLoginConfig(overrides: Partial<ILoginConfig> = {}): ILoginConfig {
  return {
    loginUrl: 'https://bank.example.com/login',
    fields: [
      { credentialKey: 'username', selectors: [{ kind: 'css', value: '#user' }] },
      { credentialKey: 'password', selectors: [{ kind: 'css', value: '#pass' }] },
    ],
    submit: { kind: 'css', value: '#submit' },
    possibleResults: {
      success: [SUCCESS_URL],
      invalidPassword: ['https://bank.example.com/login?error=1'],
    },
    ...overrides,
  };
}

const CREDS: ScraperCredentials = { username: 'testuser', password: 'testpass' };

let mockBrowser: ReturnType<typeof MOCK_MODULE.createMockBrowser>;
let mockContext: ReturnType<typeof MOCK_MODULE.createMockContext>;
let mockPage: ReturnType<typeof MOCK_MODULE.createMockPage>;

beforeEach(() => {
  jest.clearAllMocks();
  mockPage = MOCK_MODULE.createMockPage();
  mockContext = MOCK_MODULE.createMockContext(mockPage);
  mockBrowser = MOCK_MODULE.createMockBrowser(mockContext);
  (LAUNCH_CAMOUFOX_MODULE.launchCamoufox as jest.Mock).mockResolvedValue(mockBrowser);
  (NAV_MODULE.getCurrentUrl as jest.Mock).mockResolvedValue(SUCCESS_URL);
});

describe('ConcreteGenericScraper', () => {
  describe('fetchData', () => {
    it('returns success with empty accounts', async () => {
      const scraperOptions = MOCK_MODULE.createMockScraperOptions();
      const scraper = new SCRAPER_MODULE.ConcreteGenericScraper(scraperOptions, makeLoginConfig());
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
      expect(result.accounts).toEqual([]);
    });
  });

  describe('login via ILoginConfig', () => {
    it('succeeds when navigated to success URL', async () => {
      const scraperOptions = MOCK_MODULE.createMockScraperOptions();
      const scraper = new SCRAPER_MODULE.ConcreteGenericScraper(scraperOptions, makeLoginConfig());
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });

    it('returns InvalidPassword when URL matches invalidPassword condition', async () => {
      (NAV_MODULE.getCurrentUrl as jest.Mock).mockResolvedValue(
        'https://bank.example.com/login?error=1',
      );
      const scraperOptions = MOCK_MODULE.createMockScraperOptions();
      const scraper = new SCRAPER_MODULE.ConcreteGenericScraper(scraperOptions, makeLoginConfig());
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(false);
    });

    it('accepts array of submit candidates', async () => {
      const config = makeLoginConfig({
        submit: [
          { kind: 'css', value: '#submit' },
          { kind: 'ariaLabel', value: 'כניסה' },
        ],
      });
      const scraperOptions = MOCK_MODULE.createMockScraperOptions();
      const scraper = new SCRAPER_MODULE.ConcreteGenericScraper(scraperOptions, config);
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });
  });

  describe('getLoginOptions', () => {
    it('includes loginUrl from config', async () => {
      const scraperOptions = MOCK_MODULE.createMockScraperOptions();
      const scraper = new SCRAPER_MODULE.ConcreteGenericScraper(scraperOptions, makeLoginConfig());
      await scraper.scrape(CREDS);
      const anyArgMatcher: object = expect.anything() as object;
      expect(mockPage.goto).toHaveBeenCalledWith('https://bank.example.com/login', anyArgMatcher);
    });

    it('uses preAction when provided', async () => {
      const preAction = jest.fn().mockResolvedValue(undefined);
      /**
       * Stub preAction that delegates to spy.
       * @returns Resolved promise with no frame override.
       */
      const preActionFn = async (): Promise<undefined> => {
        await preAction();
        const [noFrame] = [] as undefined[];
        return noFrame;
      };
      const config = makeLoginConfig({ preAction: preActionFn });
      const scraperOptions = MOCK_MODULE.createMockScraperOptions();
      const scraper = new SCRAPER_MODULE.ConcreteGenericScraper(scraperOptions, config);
      await scraper.scrape(CREDS);
      expect(preAction).toHaveBeenCalled();
    });

    it('uses postAction when provided', async () => {
      const postAction = jest.fn().mockResolvedValue(undefined);
      /**
       * Stub postAction that delegates to spy.
       * @returns True when post-action completes.
       */
      const postActionFn = async (): Promise<void> => {
        await postAction();
      };
      const config = makeLoginConfig({ postAction: postActionFn });
      const scraperOptions = MOCK_MODULE.createMockScraperOptions();
      const scraper = new SCRAPER_MODULE.ConcreteGenericScraper(scraperOptions, config);
      await scraper.scrape(CREDS);
      expect(postAction).toHaveBeenCalled();
    });
  });
});
