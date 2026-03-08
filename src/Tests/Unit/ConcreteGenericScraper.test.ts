import { jest } from '@jest/globals';

import type { ScraperCredentials } from '../../Scrapers/Base/Interface.js';
import type { LoginConfig } from '../../Scrapers/Base/LoginConfig.js';

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
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.unstable_mockModule('../../Common/SelectorResolver.js', () => ({
  resolveFieldWithCache: jest
    .fn()
    .mockResolvedValue({ isResolved: false, selector: '', context: {} }),
  resolveFieldContext: jest.fn().mockResolvedValue({ selector: '#user', context: {} }),
  candidateToCss: jest.fn((c: { kind: string; value: string }) => c.value),
  tryInContext: jest.fn().mockResolvedValue(null),
  extractCredentialKey: jest.fn((s: string) => s),
  toFirstCss: jest.fn(() => ''),
  resolveDashboardField: jest.fn().mockResolvedValue(null),
}));

jest.unstable_mockModule('../../Common/Waiting.js', () => ({
  sleep: jest.fn().mockResolvedValue(undefined),
  humanDelay: jest.fn().mockResolvedValue(undefined),
  runSerial: jest.fn(),
  TimeoutError: class TimeoutError extends Error {},
  SECOND: 1000,
}));

const { launchCamoufox } = await import('../../Common/CamoufoxLauncher.js');
const { getCurrentUrl } = await import('../../Common/Navigation.js');
const { ConcreteGenericScraper } = await import('../../Scrapers/Base/ConcreteGenericScraper.js');
const { createMockBrowser, createMockContext, createMockPage, createMockScraperOptions } =
  await import('../MockPage.js');

const SUCCESS_URL = 'https://bank.example.com/dashboard';

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
  (launchCamoufox as jest.Mock).mockResolvedValue(mockBrowser);
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
      expect(mockPage.goto).toHaveBeenCalledWith(
        'https://bank.example.com/login',
        expect.anything(),
      );
    });

    it('uses preAction when provided', async () => {
      const preAction = jest.fn().mockResolvedValue(undefined);
      const config = makeLoginConfig({
        preAction: async _page => {
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
