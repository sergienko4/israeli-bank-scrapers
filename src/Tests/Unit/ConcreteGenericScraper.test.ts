import { chromium } from 'playwright-extra';

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

jest.mock('playwright-extra', () => ({ chromium: { launch: jest.fn(), use: jest.fn() } }));
jest.mock('puppeteer-extra-plugin-stealth', () => jest.fn());

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
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
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
  (chromium.launch as jest.Mock).mockResolvedValue(mockBrowser);
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
