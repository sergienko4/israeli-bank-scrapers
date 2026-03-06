import { launchWithEngine } from '../../Common/BrowserEngine';
import { getCurrentUrl } from '../../Common/Navigation';
import { ConcreteGenericScraper } from '../../Scrapers/Base/ConcreteGenericScraper';
import type { ScraperCredentials } from '../../Scrapers/Base/Interface';
import type { LoginConfig } from '../../Scrapers/Base/LoginConfig';
import {
  createMockBrowser,
  createMockContext,
  createMockPage,
  createMockScraperOptions,
} from '../MockPage';

jest.mock('../../Common/BrowserEngine', () => ({
  launchWithEngine: jest.fn(),
  BrowserEngineType: {
    PlaywrightStealth: 'playwright-stealth',
    Rebrowser: 'rebrowser',
    Patchright: 'patchright',
  },
}));

jest.mock('../../Common/Browser', () => ({
  buildContextOptions: jest.fn().mockReturnValue({}),
}));

jest.mock('../../Common/Navigation', () => ({
  getCurrentUrl: jest.fn().mockResolvedValue('https://bank.example.com/dashboard'),
  waitForNavigation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../Common/ElementsInteractions', () => ({
  clickButton: jest.fn().mockResolvedValue(undefined),
  fillInput: jest.fn().mockResolvedValue(undefined),
  waitUntilElementFound: jest.fn().mockResolvedValue(undefined),
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

jest.mock('../../Common/SelectorResolver', () => ({
  resolveFieldContext: jest.fn().mockResolvedValue({ selector: '#user', context: {} }),
  candidateToCss: jest.fn((c: { kind: string; value: string }) => c.value),
}));

jest.mock('../../Common/Waiting', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

const SUCCESS_URL = 'https://bank.example.com/dashboard';

/**
 * Creates a minimal LoginConfig for ConcreteGenericScraper unit tests.
 *
 * @param overrides - optional partial overrides for the login config
 * @returns a LoginConfig object for testing
 */
function makeLoginConfig(overrides: Partial<LoginConfig> = {}): LoginConfig {
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

let mockBrowser: ReturnType<typeof createMockBrowser>;
let mockContext: ReturnType<typeof createMockContext>;
let mockPage: ReturnType<typeof createMockPage>;

beforeEach(() => {
  jest.clearAllMocks();
  mockPage = createMockPage();
  mockContext = createMockContext(mockPage);
  mockBrowser = createMockBrowser(mockContext);
  (launchWithEngine as jest.Mock).mockResolvedValue(mockBrowser);
  (getCurrentUrl as jest.Mock).mockResolvedValue(SUCCESS_URL);
});

describe('ConcreteGenericScraper', () => {
  describe('fetchData', () => {
    it('returns success with empty accounts', async () => {
      const scraper = new ConcreteGenericScraper(createMockScraperOptions(), makeLoginConfig());
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
      expect(result.accounts).toEqual([]);
    });
  });

  describe('login via LoginConfig', () => {
    it('succeeds when navigated to success URL', async () => {
      const scraper = new ConcreteGenericScraper(createMockScraperOptions(), makeLoginConfig());
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });

    it('returns InvalidPassword when URL matches invalidPassword condition', async () => {
      (getCurrentUrl as jest.Mock).mockResolvedValue('https://bank.example.com/login?error=1');
      const scraper = new ConcreteGenericScraper(createMockScraperOptions(), makeLoginConfig());
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
      const scraper = new ConcreteGenericScraper(createMockScraperOptions(), config);
      const result = await scraper.scrape(CREDS);
      expect(result.success).toBe(true);
    });
  });

  describe('getLoginOptions', () => {
    it('includes loginUrl from config', async () => {
      const scraper = new ConcreteGenericScraper(createMockScraperOptions(), makeLoginConfig());
      await scraper.scrape(CREDS);
      const anyOpts = expect.anything() as unknown;
      expect(mockPage.goto).toHaveBeenCalledWith('https://bank.example.com/login', anyOpts);
    });

    it('uses preAction when provided', async () => {
      const preAction = jest.fn().mockResolvedValue(undefined);
      const config = makeLoginConfig({
        /**
         * Pre-action that invokes the spy and returns undefined.
         *
         * @returns a promise that resolves to undefined after invoking the spy
         */
        preAction: async () => {
          await preAction();
          return undefined;
        },
      });
      const scraper = new ConcreteGenericScraper(createMockScraperOptions(), config);
      await scraper.scrape(CREDS);
      expect(preAction).toHaveBeenCalled();
    });

    it('uses postAction when provided', async () => {
      const postAction = jest.fn().mockResolvedValue(undefined);
      const config = makeLoginConfig({
        /**
         * Post-action that invokes the spy after login.
         */
        postAction: async () => {
          await postAction();
        },
      });
      const scraper = new ConcreteGenericScraper(createMockScraperOptions(), config);
      await scraper.scrape(CREDS);
      expect(postAction).toHaveBeenCalled();
    });
  });
});
